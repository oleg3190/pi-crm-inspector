import { createHmac } from "node:crypto";
import { Type } from "typebox";

export const ApiRequestParametersSchema = Type.Object({
  service: Type.String({ minLength: 1, maxLength: 64, description: "Configured CRM service name." }),
  method: Type.Union([Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("PATCH"), Type.Literal("DELETE")]),
  path: Type.String({ minLength: 1, maxLength: 2048, description: "Relative API path. Absolute URLs are not allowed." }),
  body: Type.Optional(Type.String({ maxLength: 65_536, description: "Optional request body. Usually JSON." })),
});

export const API_RESPONSE_MAX_BYTES = 256 * 1024;
const SERVICES_ENV = "PI_CRM_API_SERVICES_JSON";
const DEFAULT_API_KEY_HEADER = "X-API-Key";
const SECRET_REF_RE = /^[A-Z][A-Z0-9_]{0,127}$/;
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/;
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
export type ApiRequestResult = {
  status: number;
  statusText: string;
  url: string;
  contentType?: string;
  body: string;
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

  constructor(secret: string, service: string) {
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
      return `https://example.invalid/${this.hex("url", value, 16)}`;
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
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = this.anonymize(item);
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
  const authHeader = auth.type === "bearer"
    ? { Authorization: `Bearer ${secret}` }
    : { [(auth.header?.trim() || DEFAULT_API_KEY_HEADER)]: `${auth.prefix ?? ""}${secret}` };

  const response = await fetch(url, {
    method: input.method,
    headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.1", ...authHeader, ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: input.body,
    redirect: "error",
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const truncated = bytes.byteLength > API_RESPONSE_MAX_BYTES;
  const rawBody = new TextDecoder().decode(bytes.slice(0, API_RESPONSE_MAX_BYTES));
  const contentType = response.headers.get("content-type")?.slice(0, 256) || undefined;
  const body = anonymizeResponseBody(rawBody, contentType, secret, input.service);
  return {
    status: response.status,
    statusText: response.statusText,
    url: scrub(url.toString(), secret),
    contentType,
    body,
    ...(truncated ? { truncated: true } : {}),
    anonymized: true,
  };
}

export const API_SERVICES_ENV = SERVICES_ENV;
