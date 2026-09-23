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

export type InspectWaitFor = {
  selector: string;
  state: "visible" | "hidden" | "attached" | "detached";
  timeoutMs?: number;
};

export type InspectTarget =
  | { by: "css"; value: string }
  | { by: "id"; value: string }
  | { by: "role"; role: string; name?: string }
  | { by: "label"; value: string }
  | { by: "placeholder"; value: string }
  | { by: "text"; value: string }
  | { by: "testId"; value: string };

export type InspectAction =
  | {
      type: "click";
      target?: InspectTarget;
      selector?: string;
      waitFor?: InspectWaitFor;
    }
  | {
      type: "fill";
      target: InspectTarget;
      value: string;
      sensitive?: boolean;
      waitFor?: InspectWaitFor;
    }
  | {
      type: "select";
      target: InspectTarget;
      option: {
        value?: string;
        label?: string;
      };
      waitFor?: InspectWaitFor;
    }
  | {
      type: "check";
      target: InspectTarget;
      checked: boolean;
      waitFor?: InspectWaitFor;
    }
  | {
      type: "press";
      target: InspectTarget;
      key: string;
      waitFor?: InspectWaitFor;
    };

export type InspectInteractionResult = {
  type: InspectAction["type"];
  target?: InspectTarget;
  selector?: string;
  ok: boolean;
  matched: number;
  url?: string;
  changed?: boolean;
  valueLength?: number;
  checked?: boolean;
  key?: string;
  waitFor?: InspectWaitFor;
  error?: string;
};

export type InspectAssertion =
  | {
      type: "expectText";
      target: InspectTarget;
      text: string;
      exact?: boolean;
    }
  | {
      type: "expectVisible";
      target: InspectTarget;
    }
  | {
      type: "expectCount";
      target: InspectTarget;
      count: number;
    }
  | {
      type: "expectAttribute";
      target: InspectTarget;
      name: string;
      value?: string;
      present?: boolean;
    }
  | {
      type: "expectUrl";
      value: string;
      mode?: "exact" | "contains" | "startsWith";
    }
  | {
      type: "expectElementState";
      target: InspectTarget;
      state: "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked" | "expanded" | "collapsed";
    };

export type InspectAssertionResult = {
  type: InspectAssertion["type"];
  target?: InspectTarget;
  ok: boolean;
  matched?: number;
  actualCount?: number;
  attributePresent?: boolean;
  state?: InspectAssertion["state"];
  error?: string;
};

export type InspectElement = {
  kind: "button" | "link" | "input" | "select" | "textarea" | "checkbox" | "combobox" | "other";
  selector: string;
  role?: string;
  name?: string;
  visible: boolean;
  enabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
};

export type InspectScreenshot = {
  mimeType: "image/png";
  width: number;
  height: number;
};

export type InspectSuccess = {
  status: "success";
  traceId: string;
  pageId: PageId;
  durationMs: number;
  pageText: string;
  domSnapshot: string;
  interactions: InspectInteractionResult[];
  assertions: InspectAssertionResult[];
  assertionsPassed: boolean;
  elements: InspectElement[];
  screenshot?: InspectScreenshot;
  screenshotSuppressed?: "sensitive_action";
  console: ConsoleLog[];
  pageErrors: PageError[];
  requestFailures: RequestFailure[];
  securityEvents: SecurityEvent[];
  droppedEvents: number;
};

export type InspectBlocked = Omit<InspectSuccess, "status" | "pageText" | "domSnapshot" | "interactions" | "elements" | "screenshot" | "screenshotSuppressed"> & {
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
const MAX_ASSERTIONS = 8;
const MAX_ELEMENTS = 100;
const MAX_ACTION_VALUE_LENGTH = 4096;
const MAX_ACTION_KEY_LENGTH = 32;
const MAX_TARGET_TEXT_LENGTH = 512;
const MAX_ROLE_LENGTH = 64;
const MAX_ASSERTION_ATTRIBUTE_LENGTH = 64;
const ALLOWED_PRESS_KEYS = new Set([
  "Enter",
  "Escape",
  "Tab",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Space",
  "Backspace",
  "Delete",
]);

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

function isInspectWaitFor(value: unknown): value is InspectWaitFor {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.selector !== "string" || item.selector.length === 0 || item.selector.length > 512) return false;
  if (!(item.state === "visible" || item.state === "hidden" || item.state === "attached" || item.state === "detached")) return false;
  return item.timeoutMs === undefined || (isFiniteNonNegativeInteger(item.timeoutMs) && item.timeoutMs > 0 && item.timeoutMs <= 10_000);
}

export function isInspectTarget(value: unknown): value is InspectTarget {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.by !== "string") return false;

  switch (item.by) {
    case "css":
    case "id":
    case "label":
    case "placeholder":
    case "text":
    case "testId":
      return typeof item.value === "string" && item.value.length > 0 && item.value.length <= MAX_TARGET_TEXT_LENGTH;
    case "role":
      return (
        typeof item.role === "string" &&
        item.role.length > 0 &&
        item.role.length <= MAX_ROLE_LENGTH &&
        (item.name === undefined || (typeof item.name === "string" && item.name.length <= MAX_TARGET_TEXT_LENGTH))
      );
    default:
      return false;
  }
}

export function isInspectAssertion(value: unknown): value is InspectAssertion {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;

  switch (item.type) {
    case "expectText":
      return (
        isInspectTarget(item.target) &&
        typeof item.text === "string" &&
        item.text.length > 0 &&
        item.text.length <= MAX_ACTION_VALUE_LENGTH &&
        (item.exact === undefined || typeof item.exact === "boolean")
      );
    case "expectVisible":
      return isInspectTarget(item.target);
    case "expectCount":
      return (
        isInspectTarget(item.target) &&
        isFiniteNonNegativeInteger(item.count) &&
        item.count <= MAX_ELEMENTS
      );
    case "expectAttribute":
      return (
        isInspectTarget(item.target) &&
        typeof item.name === "string" &&
        /^[A-Za-z_:][A-Za-z0-9_.:-]{0,63}$/u.test(item.name) &&
        item.name.length <= MAX_ASSERTION_ATTRIBUTE_LENGTH &&
        (item.value === undefined || (typeof item.value === "string" && item.value.length <= MAX_ACTION_VALUE_LENGTH)) &&
        (item.present === undefined || typeof item.present === "boolean")
      );
    case "expectUrl":
      return (
        typeof item.value === "string" &&
        item.value.length > 0 &&
        item.value.length <= MAX_TARGET_TEXT_LENGTH &&
        (item.mode === undefined || item.mode === "exact" || item.mode === "contains" || item.mode === "startsWith")
      );
    case "expectElementState":
      return (
        isInspectTarget(item.target) &&
        ["visible", "hidden", "enabled", "disabled", "checked", "unchecked", "expanded", "collapsed"].includes(String(item.state))
      );
    default:
      return false;
  }
}

function isInspectAssertionResult(value: unknown): value is InspectAssertionResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (!["expectText", "expectVisible", "expectCount", "expectAttribute", "expectUrl", "expectElementState"].includes(String(item.type))) return false;
  if (item.target !== undefined && !isInspectTarget(item.target)) return false;
  if (typeof item.ok !== "boolean") return false;
  if ("matched" in item && item.matched !== undefined && (!isFiniteNonNegativeInteger(item.matched) || item.matched > MAX_ELEMENTS)) return false;
  if ("actualCount" in item && item.actualCount !== undefined && (!isFiniteNonNegativeInteger(item.actualCount) || item.actualCount > MAX_ELEMENTS)) return false;
  if ("attributePresent" in item && item.attributePresent !== undefined && typeof item.attributePresent !== "boolean") return false;
  if ("state" in item && item.state !== undefined && !["visible", "hidden", "enabled", "disabled", "checked", "unchecked", "expanded", "collapsed"].includes(String(item.state))) return false;
  if ("error" in item && item.error !== undefined && (typeof item.error !== "string" || item.error.length > 2048)) return false;
  return true;
}

export function isInspectAction(value: unknown): value is InspectAction {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;

  switch (item.type) {
    case "click": {
      const hasTarget = item.target !== undefined;
      const hasSelector = item.selector !== undefined;
      if (hasTarget === hasSelector) return false;
      if (hasTarget && !isInspectTarget(item.target)) return false;
      if (hasSelector && (typeof item.selector !== "string" || item.selector.length === 0 || item.selector.length > 512)) return false;
      return item.waitFor === undefined || isInspectWaitFor(item.waitFor);
    }
    case "fill":
      return (
        isInspectTarget(item.target) &&
        typeof item.value === "string" &&
        item.value.length <= MAX_ACTION_VALUE_LENGTH &&
        (item.sensitive === undefined || typeof item.sensitive === "boolean") &&
        (item.waitFor === undefined || isInspectWaitFor(item.waitFor))
      );
    case "select": {
      if (!isInspectTarget(item.target)) return false;
      if (!item.option || typeof item.option !== "object") return false;
      const option = item.option as Record<string, unknown>;
      const hasValue = option.value !== undefined;
      const hasLabel = option.label !== undefined;
      if (!hasValue && !hasLabel) return false;
      if (hasValue && (typeof option.value !== "string" || option.value.length > MAX_TARGET_TEXT_LENGTH)) return false;
      if (hasLabel && (typeof option.label !== "string" || option.label.length > MAX_TARGET_TEXT_LENGTH)) return false;
      return item.waitFor === undefined || isInspectWaitFor(item.waitFor);
    }
    case "check":
      return (
        isInspectTarget(item.target) &&
        typeof item.checked === "boolean" &&
        (item.waitFor === undefined || isInspectWaitFor(item.waitFor))
      );
    case "press":
      return (
        isInspectTarget(item.target) &&
        typeof item.key === "string" &&
        item.key.length > 0 &&
        item.key.length <= MAX_ACTION_KEY_LENGTH &&
        ALLOWED_PRESS_KEYS.has(item.key) &&
        (item.waitFor === undefined || isInspectWaitFor(item.waitFor))
      );
    default:
      return false;
  }
}

function isInspectInteractionResult(value: unknown): value is InspectInteractionResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (!["click", "fill", "select", "check", "press"].includes(String(item.type))) return false;
  if (item.target !== undefined && !isInspectTarget(item.target)) return false;
  if (item.selector !== undefined && (typeof item.selector !== "string" || item.selector.length === 0 || item.selector.length > 512)) return false;
  if (typeof item.ok !== "boolean") return false;
  if (!isFiniteNonNegativeInteger(item.matched)) return false;
  if ("url" in item && item.url !== undefined && typeof item.url !== "string") return false;
  if ("changed" in item && item.changed !== undefined && typeof item.changed !== "boolean") return false;
  if ("valueLength" in item && item.valueLength !== undefined && (!isFiniteNonNegativeInteger(item.valueLength) || item.valueLength > MAX_ACTION_VALUE_LENGTH)) return false;
  if ("checked" in item && item.checked !== undefined && typeof item.checked !== "boolean") return false;
  if ("key" in item && item.key !== undefined && (typeof item.key !== "string" || !ALLOWED_PRESS_KEYS.has(item.key))) return false;
  if ("waitFor" in item && item.waitFor !== undefined && !isInspectWaitFor(item.waitFor)) return false;
  if ("error" in item && item.error !== undefined && (typeof item.error !== "string" || item.error.length > 2048)) return false;
  return true;
}

function isInspectElement(value: unknown): value is InspectElement {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (![ "button", "link", "input", "select", "textarea", "checkbox", "combobox", "other" ].includes(String(item.kind))) return false;
  if (typeof item.selector !== "string" || item.selector.length === 0 || item.selector.length > 1024) return false;
  if (typeof item.visible !== "boolean") return false;
  for (const key of ["role", "name"]) {
    if (key in item && item[key] !== undefined && typeof item[key] !== "string") return false;
  }
  for (const key of ["enabled", "checked", "expanded"]) {
    if (key in item && item[key] !== undefined && typeof item[key] !== "boolean") return false;
  }
  return true;
}

function isInspectScreenshot(value: unknown): value is InspectScreenshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.mimeType === "image/png" &&
    isFiniteNonNegativeInteger(item.width) &&
    item.width > 0 &&
    item.width <= 4096 &&
    isFiniteNonNegativeInteger(item.height) &&
    item.height > 0 &&
    item.height <= 4096
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

function isCommonResultFields(value: Record<string, unknown>, requirePageText: boolean): boolean {
  if (!isPageId(value.pageId)) return false;
  if (!isFiniteNonNegativeInteger(value.durationMs)) return false;
  if (requirePageText && (typeof value.pageText !== "string" || value.pageText.length > MAX_PAGE_TEXT_LENGTH)) return false;
  if (requirePageText && (typeof value.domSnapshot !== "string" || value.domSnapshot.length > MAX_DOM_SNAPSHOT_LENGTH)) return false;
  if (requirePageText && (!Array.isArray(value.interactions) || !value.interactions.every(isInspectInteractionResult) || value.interactions.length > MAX_INTERACTIONS)) return false;
  if (requirePageText && (!Array.isArray(value.elements) || !value.elements.every(isInspectElement) || value.elements.length > MAX_ELEMENTS)) return false;
  if (requirePageText && (!Array.isArray(value.assertions) || !value.assertions.every(isInspectAssertionResult) || value.assertions.length > MAX_ASSERTIONS)) return false;
  if (requirePageText && typeof value.assertionsPassed !== "boolean") return false;
  if (requirePageText && value.screenshot !== undefined && !isInspectScreenshot(value.screenshot)) return false;
  if (requirePageText && value.screenshotSuppressed !== undefined && value.screenshotSuppressed !== "sensitive_action") return false;
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
