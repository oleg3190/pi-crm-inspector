import { Type } from "typebox";

export const ApiRequestParametersSchema = Type.Object({
  method: Type.Union([
    Type.Literal("GET"),
    Type.Literal("POST"),
    Type.Literal("PUT"),
    Type.Literal("PATCH"),
    Type.Literal("DELETE"),
  ]),
  path: Type.String({
    minLength: 1,
    maxLength: 2048,
    description: "Relative API path, for example /v1/customers?limit=20. Absolute URLs are not allowed.",
  }),
  body: Type.Optional(Type.String({
    maxLength: 65_536,
    description: "Optional request body. Usually JSON.",
  })),
});

export const API_RESPONSE_MAX_BYTES = 256 * 1024;

const SECRET_ENV = "PI_CRM_API_KEY";
const BASE_URL_ENV = "PI_CRM_API_BASE_URL";
const HEADER_ENV = "PI_CRM_API_KEY_HEADER";
const DEFAULT_HEADER = "X-API-Key";

export type ApiRequestInput = {
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
};

function configuredApiUrl(path: string): URL {
  const base = process.env[BASE_URL_ENV]?.trim();
  if (!base) throw new Error(`${BASE_URL_ENV} is not configured`);

  const apiKey = process.env[SECRET_ENV];
  if (!apiKey) throw new Error(`${SECRET_ENV} is not configured`);

  const baseUrl = new URL(base);
  if (baseUrl.protocol !== "https:") {
    throw new Error(`${BASE_URL_ENV} must use https`);
  }
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("API path must be relative and start with /");
  }

  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new Error("API path must stay on the configured API origin");
  }
  return url;
}

function scrub(value: string, secret: string): string {
  if (!secret) return value;
  return value.split(secret).join("[REDACTED]");
}

export async function executeApiRequest(input: ApiRequestInput): Promise<ApiRequestResult> {
  const url = configuredApiUrl(input.path);
  const secret = process.env[SECRET_ENV] ?? "";
  const header = process.env[HEADER_ENV]?.trim() || DEFAULT_HEADER;

  if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) {
    throw new Error(`${HEADER_ENV} contains an invalid header name`);
  }

  const response = await fetch(url, {
    method: input.method,
    headers: {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.1",
      [header]: secret,
      ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body,
    redirect: "error",
  });

  const bytes = new Uint8Array(await response.arrayBuffer());
  const truncated = bytes.byteLength > API_RESPONSE_MAX_BYTES;
  const bounded = bytes.slice(0, API_RESPONSE_MAX_BYTES);
  const body = scrub(new TextDecoder().decode(bounded), secret);

  return {
    status: response.status,
    statusText: response.statusText,
    url: url.toString(),
    contentType: response.headers.get("content-type")?.slice(0, 256) || undefined,
    body,
    ...(truncated ? { truncated: true } : {}),
  };
}

export const API_SECRET_ENV = SECRET_ENV;
export const API_BASE_URL_ENV = BASE_URL_ENV;
export const API_KEY_HEADER_ENV = HEADER_ENV;
