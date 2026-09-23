export const PAGE_IDS = ["dashboard", "billing_logs", "auth_logs", "custom"] as const;
export const CUSTOM_PAGE_ID = "custom" as const;
export type PageId = (typeof PAGE_IDS)[number];

export const BLOCK_REASONS = [
  "unknown_page",
  "external_origin",
  "external_redirect",
  "blocked_method",
  "blocked_websocket",
  "blocked_download",
  "unexpected_server_ip",
  "server_ip_unavailable",
  "non_https_scheme",
  "malformed_url",
  "url_credentials_not_allowed",
  "request_path_not_allowlisted",
  "request_query_not_allowlisted",
  "document_not_allowlisted",
  "popup_blocked",
  "service_worker_blocked",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export const ERROR_CODES = [
  "missing_credentials",
  "missing_child_model",
  "login_failed",
  "timeout",
  "aborted",
  "configuration_error",
  "browser_error",
  "child_protocol_error",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type SecurityEvent = {
  kind:
    | "blocked_request"
    | "blocked_navigation"
    | "blocked_websocket"
    | "unexpected_server_ip"
    | "server_ip_unavailable"
    | "popup"
    | "download"
    | "service_worker";
  method?: string;
  resourceType?: string;
  url?: string;
  reason: BlockReason;
  detail?: string;
};

export type ConsoleLog = {
  timestamp: string;
  type: string;
  text: string;
  truncated?: boolean;
};

export type PageError = {
  timestamp: string;
  text: string;
  truncated?: boolean;
};

export type RequestFailure = {
  timestamp: string;
  method: string;
  url: string;
  error: string;
  truncated?: boolean;
};

export type InspectInteractionResult = {
  type: "click";
  selector: string;
  ok: boolean;
  matched: number;
  url?: string;
  error?: string;
};

export type InspectSuccess = {
  status: "success";
  traceId: string;
  pageId: PageId;
  durationMs: number;
  pageText: string;
  domSnapshot: string;
  interactions: InspectInteractionResult[];
  console: ConsoleLog[];
  pageErrors: PageError[];
  requestFailures: RequestFailure[];
  securityEvents: SecurityEvent[];
  droppedEvents: number;
};

export type InspectBlocked = Omit<InspectSuccess, "status" | "pageText" | "domSnapshot" | "interactions"> & {
  status: "blocked";
  reason: BlockReason;
  pageText?: string;
};

export type InspectError = {
  status: "error";
  traceId: string;
  pageId?: PageId;
  durationMs: number;
  code: ErrorCode;
  message: string;
  securityEvents: SecurityEvent[];
};

export type InspectResult = InspectSuccess | InspectBlocked | InspectError;

export function isPageId(value: unknown): value is PageId {
  return typeof value === "string" && (PAGE_IDS as readonly string[]).includes(value);
}

/**
 * Normalizes a caller-supplied custom page path. Only relative paths on the CRM
 * app origin are accepted (no scheme/authority, no traversal, no fragments).
 * Returns the normalized path or undefined when invalid.
 */
export function normalizeCustomPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = value.trim();
  if (path.length === 0 || path.length > 512) return undefined;
  if (!path.startsWith("/")) return undefined;
  if (path.startsWith("//")) return undefined;
  if (path.includes("\\")) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(path)) return undefined;
  if (path.split("/").some((segment) => segment === "..")) return undefined;
  return path;
}

export function isBlockReason(value: unknown): value is BlockReason {
  return typeof value === "string" && (BLOCK_REASONS as readonly string[]).includes(value);
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value);
}

const MAX_TRACE_ID_LENGTH = 128;
const MAX_ERROR_MESSAGE_LENGTH = 2048;
const MAX_LOG_TEXT_LENGTH = 8192;
const MAX_PAGE_TEXT_LENGTH = 65536;
const MAX_DOM_SNAPSHOT_LENGTH = 65536;
const MAX_INTERACTIONS = 8;

function isBoundedString(value: unknown, maxLen: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLen;
}

function isSecurityEvent(value: unknown): value is SecurityEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  const kinds = [
    "blocked_request",
    "blocked_navigation",
    "blocked_websocket",
    "unexpected_server_ip",
    "server_ip_unavailable",
    "popup",
    "download",
    "service_worker",
  ];
  if (!kinds.includes(String(event.kind))) return false;
  if (!isBlockReason(event.reason)) return false;
  for (const key of ["method", "resourceType", "url", "detail"]) {
    if (key in event && event[key] !== undefined && typeof event[key] !== "string") return false;
  }
  return true;
}

function isConsoleLog(value: unknown): value is ConsoleLog {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.timestamp === "string" &&
    typeof item.type === "string" &&
    typeof item.text === "string" &&
    (!("truncated" in item) || typeof item.truncated === "boolean")
  );
}

function isPageError(value: unknown): value is PageError {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.timestamp === "string" &&
    typeof item.text === "string" &&
    (!("truncated" in item) || typeof item.truncated === "boolean")
  );
}

function isInspectInteractionResult(value: unknown): value is InspectInteractionResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.type !== "click") return false;
  if (typeof item.selector !== "string" || item.selector.length === 0 || item.selector.length > 512) return false;
  if (typeof item.ok !== "boolean") return false;
  if (!isFiniteNonNegativeInteger(item.matched)) return false;
  if ("url" in item && item.url !== undefined && typeof item.url !== "string") return false;
  if ("error" in item && item.error !== undefined && (typeof item.error !== "string" || item.error.length > 2048)) return false;
  return true;
}

function isRequestFailure(value: unknown): value is RequestFailure {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.timestamp === "string" &&
    typeof item.method === "string" &&
    typeof item.url === "string" &&
    typeof item.error === "string" &&
    (!("truncated" in item) || typeof item.truncated === "boolean")
  );
}

function isCommonResultFields(value: Record<string, unknown>, requirePageText: boolean): boolean {
  if (!isPageId(value.pageId)) return false;
  if (!isFiniteNonNegativeInteger(value.durationMs)) return false;
  if (requirePageText && (typeof value.pageText !== "string" || value.pageText.length > MAX_PAGE_TEXT_LENGTH)) return false;
  if (requirePageText && (typeof value.domSnapshot !== "string" || value.domSnapshot.length > MAX_DOM_SNAPSHOT_LENGTH)) return false;
  if (requirePageText && (!Array.isArray(value.interactions) || !value.interactions.every(isInspectInteractionResult) || value.interactions.length > MAX_INTERACTIONS)) return false;
  if (!requirePageText && value.pageText !== undefined && (typeof value.pageText !== "string" || value.pageText.length > MAX_PAGE_TEXT_LENGTH)) return false;
  if (!Array.isArray(value.console) || !value.console.every(isConsoleLog)) return false;
  if (!Array.isArray(value.pageErrors) || !value.pageErrors.every(isPageError)) return false;
  if (!Array.isArray(value.requestFailures) || !value.requestFailures.every(isRequestFailure)) return false;
  if (!Array.isArray(value.securityEvents) || !value.securityEvents.every(isSecurityEvent)) return false;
  if (!isFiniteNonNegativeInteger(value.droppedEvents)) return false;
  if (value.console.length > 100 || value.pageErrors.length > 50 || value.requestFailures.length > 50 || value.securityEvents.length > 20) return false;
  return true;
}

export function isInspectResult(value: unknown): value is InspectResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;

  if (result.status === "success") return isCommonResultFields(result, true);
  if (result.status === "blocked") return isCommonResultFields(result, false) && isBlockReason(result.reason);

  if (result.status === "error") {
    if (typeof result.traceId !== "string" || !isBoundedString(result.traceId, MAX_TRACE_ID_LENGTH)) return false;
    if (!(result.pageId === undefined || isPageId(result.pageId))) return false;
    if (!isFiniteNonNegativeInteger(result.durationMs)) return false;
    if (!isErrorCode(result.code)) return false;
    if (typeof result.message !== "string" || !isBoundedString(result.message, MAX_ERROR_MESSAGE_LENGTH)) return false;
    return Array.isArray(result.securityEvents) && result.securityEvents.every(isSecurityEvent);
  }

  return false;
}

export function asInspectResult(value: unknown): InspectResult {
  if (!isInspectResult(value)) throw new Error("Child returned an invalid inspect_crm_page result");
  return value;
}
