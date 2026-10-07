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
export type ApiRequestResult = { status: number; statusText: string; url: string; contentType?: string; body: string; truncated?: boolean };

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
  if (typeof auth.secretRef !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(auth.secretRef)) throw new Error(`CRM service '${service}' has an invalid secret reference`);
  const secret = process.env[auth.secretRef];
  if (!secret) throw new Error(`Secret for CRM service '${service}' is not configured`);
  if (auth.type === "apiKey") {
    const header = auth.header?.trim() || DEFAULT_API_KEY_HEADER;
    if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) throw new Error(`CRM service '${service}' has an invalid API key header`);
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
  const body = scrub(new TextDecoder().decode(bytes.slice(0, API_RESPONSE_MAX_BYTES)), secret);
  return { status: response.status, statusText: response.statusText, url: scrub(url.toString(), secret), contentType: response.headers.get("content-type")?.slice(0, 256) || undefined, body, ...(truncated ? { truncated: true } : {}) };
}

export const API_SERVICES_ENV = SERVICES_ENV;
