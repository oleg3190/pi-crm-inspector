import { createHmac, randomUUID } from "node:crypto";
import { Type } from "typebox";

export const ApiRequestParametersSchema = Type.Object({
  service: Type.String({ minLength: 1, maxLength: 64, description: "Configured CRM service name." }),
  method: Type.Union([Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("PATCH"), Type.Literal("DELETE")]),
  path: Type.String({ minLength: 1, maxLength: 2048, description: "Relative API path. Absolute URLs are not allowed." }),
  body: Type.Optional(Type.String({ maxLength: 65_536, description: "Optional request body. Usually JSON." })),
});

export const ApiFindFieldsParametersSchema = Type.Object({
  responseId: Type.String({ minLength: 1, maxLength: 128 }),
  query: Type.String({ minLength: 1, maxLength: 128 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

export const ApiExtractParametersSchema = Type.Object({
  responseId: Type.String({ minLength: 1, maxLength: 128 }),
  paths: Type.Array(Type.String({ minLength: 2, maxLength: 512 }), { minItems: 1, maxItems: 32 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

export const API_RESPONSE_MAX_BYTES = 256 * 1024;
export const API_RESPONSE_INLINE_MAX_BYTES = 16 * 1024;
const API_RESPONSE_STORE_MAX = 64;
const API_RESPONSE_TTL_MS = 10 * 60 * 1000;
const API_EXTRACT_MAX_BYTES = 32 * 1024;
const SERVICES_ENV = "PI_CRM_API_SERVICES_JSON";
const DEFAULT_API_KEY_HEADER = "X-API-Key";
const SECRET_REF_RE = /^[A-Z][A-Z0-9_]{0,127}$/;
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/;
const API_URL_TOKEN_PREFIX = "/__pi_crm_url/";
const API_URL_TOKEN_MAX = 2048;

type ApiUrlToken = { service: string; url: string };

class ApiUrlTokenStore {
  private readonly tokens = new Map<string, ApiUrlToken>();

  put(service: string, url: string): string {
    let token = "";
    do token = randomUUID().replaceAll("-", ""); while (this.tokens.has(token));
    this.tokens.set(token, { service, url });
    while (this.tokens.size > API_URL_TOKEN_MAX) {
      this.tokens.delete(this.tokens.keys().next().value as string);
    }
    return token;
  }

  get(service: string, token: string): string | undefined {
    const entry = this.tokens.get(token);
    if (!entry || entry.service !== service) return undefined;
    return entry.url;
  }
}

const apiUrlTokens = new ApiUrlTokenStore();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9 .()_-]{6,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.\d{1,9})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})?)?$/;

type ApiKeyAuth = { type: "apiKey"; header?: string; prefix?: string; secretRef: string };
type BearerAuth = { type: "bearer"; secretRef: string };
type ServiceConfig = { baseUrl: string; auth: ApiKeyAuth | BearerAuth };
type ServiceRegistry = Record<string, ServiceConfig>;

export type ApiRequestInput = {
  service: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: string;
};

export type ApiField = {
  path: string;
  name: string;
  type: "string" | "number" | "boolean" | "null" | "object" | "array";
  example?: string | number | boolean | null;
};

type StoredApiResponse = {
  service: string;
  expiresAt: number;
  value: unknown;
  schema: ApiField[];
  rootType: ApiField["type"];
  truncated: boolean;
};

const apiResponses = new Map<string, StoredApiResponse>();

function valueType(value: unknown): ApiField["type"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

function buildApiSchema(value: unknown, path = "$", fields: ApiField[] = []): ApiField[] {
  const type = valueType(value);
  if (path !== "$") {
    const name = path.split(".").pop()?.replace(/\[\*\]$/, "") || path;
    if (!fields.some((field) => field.path === path)) {
      const primitive = type === "string" || type === "number" || type === "boolean" || type === "null";
      fields.push({ path, name, type, ...(primitive ? { example: value as string | number | boolean | null } : {}) });
    }
  }
  if (value === null || typeof value !== "object") return fields;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) buildApiSchema(item, path + "[*]", fields);
    return fields;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    buildApiSchema(item, path === "$" ? "$." + key : path + "." + key, fields);
  }
  return fields;
}

function cleanupApiResponses(): void {
  const now = Date.now();
  for (const [id, entry] of apiResponses) if (entry.expiresAt <= now) apiResponses.delete(id);
}

function storeApiResponse(service: string, value: unknown, schema: ApiField[], rootType: ApiField["type"], truncated: boolean): string {
  cleanupApiResponses();
  const id = "resp_" + randomUUID().replaceAll("-", "");
  apiResponses.set(id, { service, expiresAt: Date.now() + API_RESPONSE_TTL_MS, value, schema, rootType, truncated });
  while (apiResponses.size > API_RESPONSE_STORE_MAX) apiResponses.delete(apiResponses.keys().next().value as string);
  return id;
}

function getApiResponse(service: string, responseId: string): StoredApiResponse {
  cleanupApiResponses();
  const entry = apiResponses.get(responseId);
  if (!entry || entry.service !== service) throw new Error("Unknown or expired API response handle");
  return entry;
}

function findApiFields(entry: StoredApiResponse, query: string, limit: number): ApiField[] {
  const terms = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  return entry.schema
    .map((field) => {
      const name = field.name.toLowerCase();
      const path = field.path.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (name === term ? 5 : name.includes(term) ? 3 : path.includes(term) ? 1 : 0), 0);
      return { field, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.field.path.length - b.field.path.length)
    .slice(0, limit)
    .map((item) => item.field);
}

function parseApiPath(path: string): Array<string | number | "*"> {
  if (!/^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[(?:\d+|\*)\])*$/.test(path)) throw new Error("Unsupported response path: " + path);
  const parts: Array<string | number | "*"> = [];
  const re = /\.([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+|\*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) parts.push(match[1] ?? (match[2] === "*" ? "*" : Number(match[2])));
  return parts;
}

function selectApiPath(value: unknown, parts: Array<string | number | "*">): unknown[] {
  let current = [value];
  for (const part of parts) {
    const next: unknown[] = [];
    for (const item of current) {
      if (part === "*") {
        if (Array.isArray(item)) next.push(...item);
      } else if (typeof part === "number") {
        if (Array.isArray(item) && item[part] !== undefined) next.push(item[part]);
      } else if (item && typeof item === "object" && !Array.isArray(item)) {
        const child = (item as Record<string, unknown>)[part];
        if (child !== undefined) next.push(child);
      }
    }
    current = next;
  }
  return current;
}

export function findApiResponseFields(service: string, responseId: string, query: string, limit = 10) {
  const entry = getApiResponse(service, responseId);
  return { responseId, matches: findApiFields(entry, query, limit), truncated: entry.truncated };
}

export function extractApiResponse(service: string, responseId: string, paths: string[], limit = 100) {
  const entry = getApiResponse(service, responseId);
  const rows = new Map<number, Record<string, unknown>>();
  for (const path of paths) {
    const values = selectApiPath(entry.value, parseApiPath(path));
    values.slice(0, limit).forEach((value, index) => {
      const row = rows.get(index) ?? {};
      row[path] = value;
      rows.set(index, row);
    });
  }
  const items = [...rows.values()];
  while (items.length > 1 && Buffer.byteLength(JSON.stringify(items), "utf8") > API_EXTRACT_MAX_BYTES) items.pop();
  return { responseId, items, returned: items.length, truncated: entry.truncated || items.length < limit };
}

export type ApiRequestResult = {
  status: number;
  statusText: string;
  url: string;
  contentType?: string;
  body?: string;
  responseId?: string;
  schema?: { type: ApiField["type"]; fields: ApiField[]; truncated?: boolean };
  truncated?: boolean;
  anonymized: true;
};

function parseRegistry(): ServiceRegistry {
  const raw = process.env[SERVICES_ENV]?.trim();
  if (!raw) throw new Error(`${SERVICES_ENV} is not configured`);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${SERVICES_ENV} contains invalid JSON`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${SERVICES_ENV} must be a JSON object`);
  return parsed as ServiceRegistry;
}

function resolveService(service: string): { config: ServiceConfig; secret: string } {
  const config = parseRegistry()[service];
  if (!config || typeof config !== "object" || typeof config.baseUrl !== "string" || !config.auth) {
    throw new Error(`Unknown or invalid CRM service: ${service}`);
  }
  let baseUrl: URL;
  try { baseUrl = new URL(config.baseUrl); } catch { throw new Error(`CRM service '${service}' has an invalid base URL`); }
  if (baseUrl.protocol !== "https:") throw new Error(`CRM service '${service}' must use https`);
  const auth = config.auth;
  if (auth.type !== "apiKey" && auth.type !== "bearer") throw new Error(`CRM service '${service}' has unsupported authentication`);
  if (typeof auth.secretRef !== "string" || !SECRET_REF_RE.test(auth.secretRef)) throw new Error(`CRM service '${service}' has an invalid secret reference`);
  const secret = process.env[auth.secretRef];
  if (!secret) throw new Error(`Secret for CRM service '${service}' is not configured`);
  if (auth.type === "apiKey") {
    const header = auth.header?.trim() || DEFAULT_API_KEY_HEADER;
    if (!HEADER_RE.test(header)) throw new Error(`CRM service '${service}' has an invalid API key header`);
    if (auth.prefix !== undefined && typeof auth.prefix !== "string") throw new Error(`CRM service '${service}' has an invalid API key prefix`);
  }
  return { config, secret };
}

function configuredApiUrl(service: string, path: string, config: ServiceConfig): URL {
  let baseUrl: URL;
  try { baseUrl = new URL(config.baseUrl); } catch { throw new Error(`CRM service '${service}' has an invalid base URL`); }
  const tokenMatch = path.match(/^(?:https:\/\/example\.invalid)?\/__pi_crm_url\/([a-f0-9]{32})$/i);
  if (tokenMatch) {
    const resolved = apiUrlTokens.get(service, tokenMatch[1]);
    if (!resolved) throw new Error("Unknown or expired anonymized API URL");
    const resolvedUrl = new URL(resolved);
    if (resolvedUrl.origin !== baseUrl.origin) throw new Error("Anonymized API URL must stay on the configured service origin");
    return resolvedUrl;
  }
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("API path must be relative and start with /");
  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl.origin) throw new Error("API path must stay on the configured service origin");
  return url;
}

function scrub(value: string, secret: string): string {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

class TypeAnonymizer {
  private readonly key: Buffer;
  private readonly service: string;

  constructor(secret: string, service: string) {
    this.service = service;
    this.key = createHmac("sha256", secret).update(`pi-crm-inspector/anonymization/${service}`).digest();
  }

  private digest(type: string, value: string): Buffer {
    return createHmac("sha256", this.key).update(type).update("\0").update(value).digest();
  }

  private hex(type: string, value: string, length = 10): string {
    return this.digest(type, value).toString("hex").slice(0, length);
  }

  private bytes(type: string, value: string): Buffer {
    return this.digest(type, value);
  }

  private integer(value: number, original: string): number {
    const d = this.bytes("integer", original);
    const magnitude = Number(d.readUInt32BE(0) % 900_000) + 100;
    return value < 0 ? -magnitude : magnitude;
  }

  private number(value: number, original: string): number {
    const d = this.bytes("number", original);
    const magnitude = (d.readUInt32BE(0) % 9_000_000) / 100;
    return value < 0 ? -magnitude : magnitude;
  }

  private string(value: string): string {
    if (EMAIL_RE.test(value)) return `user-${this.hex("email", value, 8)}@example.invalid`;
    if (PHONE_RE.test(value)) {
      const digits = value.replace(/\D/g, "");
      const prefix = value.trim().startsWith("+") ? "+" : "";
      const d = this.bytes("phone", value);
      let out = "";
      for (let i = 0; i < Math.max(7, Math.min(digits.length, 15)); i++) out += String(d[i % d.length] % 10);
      return prefix + out;
    }
    if (UUID_RE.test(value)) {
      const h = this.hex("uuid", value, 32);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    }
    if (ISO_DATE_RE.test(value)) {
      const d = this.bytes("date", value);
      const year = 2000 + (d[0] % 31);
      const month = String((d[1] % 12) + 1).padStart(2, "0");
      const day = String((d[2] % 28) + 1).padStart(2, "0");
      if (value.length === 10) return `${year}-${month}-${day}`;
      const hour = String(d[3] % 24).padStart(2, "0");
      const minute = String(d[4] % 60).padStart(2, "0");
      const second = String(d[5] % 60).padStart(2, "0");
      return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    }
    if (/^https?:\/\//i.test(value)) {
      return `https://example.invalid${API_URL_TOKEN_PREFIX}${apiUrlTokens.put(this.service, value)}`;
    }
    if (value.length === 0) return "";
    const d = this.bytes("string", value);
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let out = "";
    for (let i = 0; i < value.length; i++) out += alphabet[d[i % d.length] % alphabet.length];
    return out;
  }

  anonymize(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return this.string(value);
    if (typeof value === "boolean") return this.bytes("boolean", String(value))[0] % 2 === 0;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return 0;
      return Number.isInteger(value) ? this.integer(value, String(value)) : this.number(value, String(value));
    }
    if (Array.isArray(value)) return value.map((item) => this.anonymize(item));
    if (typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        // Preserve identifiers, booleans, and fields whose name contains "status".
        const preserve = /^(?:id|ids|.*(?:_id|Id|Ids|_ids))$/i.test(key) || typeof item === "boolean" || /status/i.test(key);
        result[key] = preserve ? item : this.anonymize(item);
      }
      return result;
    }
    return this.string(String(value));
  }

  json(text: string): string {
    try {
      return JSON.stringify(this.anonymize(JSON.parse(text)));
    } catch {
      return this.string(text);
    }
  }
}

function anonymizeResponseBody(body: string, contentType: string | undefined, secret: string, service: string): string {
  const scrubbed = scrub(body, secret);
  const anonymizer = new TypeAnonymizer(secret, service);
  if (contentType?.toLowerCase().includes("json")) return anonymizer.json(scrubbed);
  if (/^\s*[\[{]/.test(scrubbed)) return anonymizer.json(scrubbed);
  return anonymizer.anonymize(scrubbed) as string;
}

export async function executeApiRequest(input: ApiRequestInput): Promise<ApiRequestResult> {
  const { config, secret } = resolveService(input.service);
  const url = configuredApiUrl(input.service, input.path, config);
  const auth = config.auth;
  const authHeader: HeadersInit = auth.type === "bearer"
    ? { Authorization: `Bearer ${secret}` }
    : { [(auth.header?.trim() || DEFAULT_API_KEY_HEADER)]: `${auth.prefix ?? ""}${secret}` };
  const headers: HeadersInit = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.1",
    ...authHeader,
    ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}),
  };

  const response = await fetch(url, {
    method: input.method,
    headers,
    body: input.body,
    redirect: "error",
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const truncated = bytes.byteLength > API_RESPONSE_MAX_BYTES;
  const rawBody = new TextDecoder().decode(bytes.slice(0, API_RESPONSE_MAX_BYTES));
  const contentType = response.headers.get("content-type")?.slice(0, 256) || undefined;
  const body = anonymizeResponseBody(rawBody, contentType, secret, input.service);
  const anonymizer = new TypeAnonymizer(secret, input.service);
  const safeUrlValue = anonymizer.anonymize(url.toString()) as string;
  const isJson = contentType?.toLowerCase().includes("json") || /^\s*[\[{]/.test(body);
  if (isJson) {
    try {
      const parsed = JSON.parse(body) as unknown;
      const fields = buildApiSchema(parsed).slice(0, 512);
      const responseId = storeApiResponse(input.service, parsed, fields, valueType(parsed), truncated);
      return {
        status: response.status,
        statusText: response.statusText,
        url: safeUrlValue,
        contentType,
        responseId,
        schema: { type: valueType(parsed), fields, ...(truncated ? { truncated: true } : {}) },
        ...(Buffer.byteLength(body, "utf8") <= API_RESPONSE_INLINE_MAX_BYTES ? { body } : {}),
        ...(truncated ? { truncated: true } : {}),
        anonymized: true,
      };
    } catch {
      // Fall through to bounded plain-text response.
    }
  }
  return {
    status: response.status,
    statusText: response.statusText,
    url: safeUrlValue,
    contentType,
    body: Buffer.byteLength(body, "utf8") <= API_RESPONSE_INLINE_MAX_BYTES ? body : undefined,
    ...(truncated ? { truncated: true } : {}),
    anonymized: true,
  };
}

export const API_SERVICES_ENV = SERVICES_ENV;
