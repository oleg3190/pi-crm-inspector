import { isIP } from "node:net";
import type { Request } from "playwright";
import { CRM_POLICY, type BlockReason } from "./policy.ts";
import type { QueryPolicy, PageConfig } from "./policy.ts";
import type { SecurityEvent } from "../shared/protocol.ts";

export type { SecurityEvent };

export type RequestPhase = "login" | "authenticated";

export type RequestDecision =
  | { allowed: true }
  | { allowed: false; reason: BlockReason };

function trustedOriginConfig(origin: string, trustedOrigins = CRM_POLICY.trustedOrigins) {
  try {
    const normalized = normalizedOrigin(origin);
    return trustedOrigins.find((item) => normalizedOrigin(item.origin) === normalized);
  } catch {
    return undefined;
  }
}

export function isTrustedOrigin(origin: string, trustedOrigins = CRM_POLICY.trustedOrigins): boolean {
  return trustedOriginConfig(origin, trustedOrigins) !== undefined;
}

export function getPinnedIpForOrigin(origin: string, trustedOrigins = CRM_POLICY.trustedOrigins): string | undefined {
  return trustedOriginConfig(origin, trustedOrigins)?.pinnedIp;
}

const FORBIDDEN_GENERIC_WILDCARDS = new Set(["/*", "/**"]);

export function normalizedOrigin(value: string): string {
  const u = new URL(value);
  if (u.username || u.password) throw new Error("Origin must not contain credentials");
  if (u.protocol !== "https:") throw new Error("CRM origin must use HTTPS");
  if (u.pathname !== "/" || u.search || u.hash) {
    throw new Error("CRM origin must be a bare HTTPS origin without path/query/hash");
  }
  return u.origin;
}

export function normalizedPathname(value: string): string {
  if (!value.startsWith("/")) throw new Error(`Path rule must start with '/': ${value}`);
  const u = new URL(value, "https://placeholder.invalid");
  if (u.origin !== "https://placeholder.invalid") throw new Error(`Invalid path rule: ${value}`);
  if (u.search || u.hash) throw new Error(`Path rule must not contain query/hash: ${value}`);
  return u.pathname || "/";
}

export function validatePathRule(rule: string): void {
  const normalizedRule = normalizedPathname(rule);
  if (FORBIDDEN_GENERIC_WILDCARDS.has(normalizedRule)) {
    throw new Error(`Overly broad request path rule is forbidden: ${rule}`);
  }
  if (normalizedRule.endsWith("/**")) {
    const prefix = normalizedRule.slice(0, -3).replace(/\/$/, "");
    if (prefix.split("/").filter(Boolean).length < 1) {
      throw new Error(`Overly broad request path rule is forbidden: ${rule}`);
    }
  }
}

export function validateQueryPolicy(query: QueryPolicy): void {
  for (const key of query.allowedKeys) {
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
      throw new Error(`Invalid query key: ${key}`);
    }
  }
}

function matchesPathRule(pathname: string, rule: string): boolean {
  const normalizedPath = normalizedPathname(pathname);
  const normalizedRule = normalizedPathname(rule);

  if (normalizedRule.endsWith("/**")) {
    const prefix = normalizedRule.slice(0, -3).replace(/\/$/, "");
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  return normalizedPath === normalizedRule;
}

export function isAllowedPath(pathname: string, allowedPathRules: readonly string[]): boolean {
  try {
    return allowedPathRules.some((rule) => matchesPathRule(pathname, rule));
  } catch {
    return false;
  }
}

export function isAllowedQuery(
  search: string,
  query: QueryPolicy,
  maxChars = CRM_POLICY.limits.maxUrlQueryChars,
): boolean {
  if (search.length > maxChars) return false;
  if (!search) return true;

  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (!query.allowedKeys.includes(key)) return false;
  }
  return true;
}

export function sanitizedUrl(value: string): string {
  try {
    const u = new URL(value);
    u.username = "";
    u.password = "";
    if (u.search) u.search = "?[redacted]";
    u.hash = "";
    return u.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function isAllowedDocumentUrl(url: string, allowedDocuments: readonly string[]): boolean {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:") return false;
    if (target.username || target.password) return false;

    return allowedDocuments.some((candidate) => {
      const allowed = new URL(candidate);
      if (allowed.username || allowed.password) return false;
      return (
        target.origin === allowed.origin &&
        target.pathname === allowed.pathname &&
        target.search === allowed.search
      );
    });
  } catch {
    return false;
  }
}

export function isAllowedRequest(
  request: Request,
  pageConfig: PageConfig,
  phase: RequestPhase,
): RequestDecision {
  let u: URL;
  try {
    u = new URL(request.url());
  } catch {
    return { allowed: false, reason: "malformed_url" };
  }

  if (u.protocol !== "https:") return { allowed: false, reason: "non_https_scheme" };
  if (u.username || u.password) return { allowed: false, reason: "url_credentials_not_allowed" };
  if (!isTrustedOrigin(u.origin)) return { allowed: false, reason: "external_origin" };
  if (!isAllowedPath(u.pathname, pageConfig.allowedRequestPaths)) {
    return { allowed: false, reason: "request_path_not_allowlisted" };
  }

  const method = request.method().toUpperCase();
  const login = new URL(CRM_POLICY.login.url);
  const isLoginEndpoint = u.origin === login.origin && u.pathname === login.pathname;
  const isLoginPost = CRM_POLICY.allowLoginPost && phase === "login" && method === "POST" && isLoginEndpoint;

  if (isLoginPost) {
    return isAllowedQuery(u.search, CRM_POLICY.login.query)
      ? { allowed: true }
      : { allowed: false, reason: "request_query_not_allowlisted" };
  }

  if (!isAllowedQuery(u.search, isLoginEndpoint ? CRM_POLICY.login.query : pageConfig.query)) {
    return { allowed: false, reason: "request_query_not_allowlisted" };
  }
  if (!CRM_POLICY.allowOnlyReadMethods.includes(method)) {
    return { allowed: false, reason: "blocked_method" };
  }

  if (request.resourceType() === "document" && !isAllowedDocumentUrl(u.href, pageConfig.allowedDocuments)) {
    return { allowed: false, reason: "document_not_allowlisted" };
  }

  return { allowed: true };
}

export function validatePinnedIp(ip: string): void {
  if (isIP(ip) === 0) throw new Error(`CRM_POLICY.pinnedIp is not a valid IP address: ${ip}`);
}

export function validatePageConfig(pageConfig: PageConfig): void {
  if (!pageConfig.url.startsWith("https://")) throw new Error(`Page URL must use HTTPS: ${pageConfig.url}`);
  const pageUrl = new URL(pageConfig.url);
  if (pageUrl.username || pageUrl.password) throw new Error(`Page URL cannot contain credentials: ${pageConfig.url}`);
  if (!isTrustedOrigin(pageUrl.origin)) throw new Error(`Page URL origin is not trusted: ${pageUrl.origin}`);

  for (const document of pageConfig.allowedDocuments) {
    const parsed = new URL(document);
    if (parsed.protocol !== "https:") throw new Error(`Document allowlist must use HTTPS: ${document}`);
    if (parsed.username || parsed.password) throw new Error(`Document allowlist cannot contain credentials: ${document}`);
    if (parsed.search.includes("*")) throw new Error(`Document query wildcards are forbidden: ${document}`);
    if (!isTrustedOrigin(parsed.origin)) throw new Error(`Document origin is not trusted: ${parsed.origin}`);
  }
  for (const rule of pageConfig.allowedRequestPaths) validatePathRule(rule);
  validateQueryPolicy(pageConfig.query);
}

export function scrubSecrets(text: string, secrets: readonly string[]): string {
  let value = text;

  for (const secret of secrets) {
    if (secret.length > 0) value = value.split(secret).join("[REDACTED]");
  }

  // Decode common HTML entities to catch encoded secrets
  const decoded = value
    .replace(/&#61;/gi, "=")
    .replace(/&#x3d;/gi, "=")
    .replace(/&#91;/gi, "[")
    .replace(/&#93;/gi, "]")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  value = value.replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]");
  value = value.replace(
    /(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*(['"]?)[^,'"\s}]+\2/gi,
    "$1=[REDACTED]",
  );
  // Also catch HTML-encoded key=value patterns
  value = value.replace(
    /(password|passwd|secret|token|api[_-]?key|authorization)\s*(?:&#61;|&#x3d;|&#=:)\s*(['"]?)[^,'"\s}]+\2/gi,
    "$1=[REDACTED]",
  );
  // Redact URLs with query params containing potential secrets
  value = value.replace(/https?:\/\/[^\s]+/gi, (candidate) => sanitizedUrl(candidate));
  // Clean up any HTML entity encoded URLs that might have slipped through
  value = value.replace(/https?:\/\/[^\s]+&#[^\s]+/gi, () => "[REDACTED_URL]");

  return value;
}

export function truncateLog(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, Math.max(0, maxChars - 12))}\n[truncated]`,
    truncated: true,
  };
}
