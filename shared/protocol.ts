export const PAGE_IDS = ["dashboard", "billing_logs", "auth_logs"] as const;
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

export type InspectSuccess = {
  status: "success";
  traceId: string;
  pageId: PageId;
  durationMs: number;
  console: ConsoleLog[];
  pageErrors: PageError[];
  requestFailures: RequestFailure[];
  securityEvents: SecurityEvent[];
  droppedEvents: number;
};

export type InspectBlocked = Omit<InspectSuccess, "status"> & {
  status: "blocked";
  reason: BlockReason;
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

export function isBlockReason(value: unknown): value is BlockReason {
  return typeof value === "string" && (BLOCK_REASONS as readonly string[]).includes(value);
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value);
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

function isCommonResultFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.traceId === "string" && value.traceId.length > 0 &&
    isPageId(value.pageId) &&
    isFiniteNonNegativeInteger(value.durationMs) &&
    Array.isArray(value.console) && value.console.every(isConsoleLog) &&
    Array.isArray(value.pageErrors) && value.pageErrors.every(isPageError) &&
    Array.isArray(value.requestFailures) && value.requestFailures.every(isRequestFailure) &&
    Array.isArray(value.securityEvents) && value.securityEvents.every(isSecurityEvent) &&
    isFiniteNonNegativeInteger(value.droppedEvents)
  );
}

export function isInspectResult(value: unknown): value is InspectResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;

  if (result.status === "success") return isCommonResultFields(result);
  if (result.status === "blocked") return isCommonResultFields(result) && isBlockReason(result.reason);

  if (result.status === "error") {
    if (typeof result.traceId !== "string" || result.traceId.length === 0) return false;
    if (!(result.pageId === undefined || isPageId(result.pageId))) return false;
    if (!isFiniteNonNegativeInteger(result.durationMs)) return false;
    if (!isErrorCode(result.code)) return false;
    if (typeof result.message !== "string") return false;
    return Array.isArray(result.securityEvents) && result.securityEvents.every(isSecurityEvent);
  }

  return false;
}

export function asInspectResult(value: unknown): InspectResult {
  if (!isInspectResult(value)) throw new Error("Child returned an invalid inspect_crm_page result");
  return value;
}
