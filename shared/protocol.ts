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
  "authentication_expired",
  "concurrency_limit",
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

export type InspectTargetMatch = "exact" | "contains";
export type InspectScopeTarget =
  | { by: "css"; value: string }
  | { by: "id"; value: string }
  | { by: "role"; role: string; name?: string; match?: InspectTargetMatch }
  | { by: "label"; value: string; match?: InspectTargetMatch }
  | { by: "placeholder"; value: string; match?: InspectTargetMatch }
  | { by: "text"; value: string; match?: InspectTargetMatch }
  | { by: "testId"; value: string };

export type InspectTarget =
  | { by: "css"; value: string }
  | { by: "id"; value: string }
  | { by: "role"; role: string; name?: string; match?: InspectTargetMatch; scope?: InspectScopeTarget }
  | { by: "label"; value: string; match?: InspectTargetMatch; scope?: InspectScopeTarget }
  | { by: "placeholder"; value: string; match?: InspectTargetMatch; scope?: InspectScopeTarget }
  | { by: "text"; value: string; match?: InspectTargetMatch; scope?: InspectScopeTarget }
  | { by: "testId"; value: string };

export type InspectWaitFor = {
  selector: string;
  state: "visible" | "hidden" | "attached" | "detached";
  timeoutMs?: number;
};

export type InspectGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

export type InspectAssertion =
  | { type: "expectText"; target: InspectTarget; text: string; exact?: boolean }
  | { type: "expectVisible"; target: InspectTarget }
  | { type: "expectCount"; target: InspectTarget; count: number }
  | { type: "expectAttribute"; target: InspectTarget; name: string; value?: string; present?: boolean }
  | { type: "expectUrl"; value: string; mode?: "exact" | "contains" | "startsWith" }
  | { type: "expectElementState"; target: InspectTarget; state: "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked" | "expanded" | "collapsed" }
  | { type: "expectStyle"; target: InspectTarget; property: string; value: string; mode?: "exact" | "contains" | "startsWith" }
  | {
      type: "expectGeometry";
      target: InspectTarget;
      width?: { min?: number; max?: number; exact?: number };
      height?: { min?: number; max?: number; exact?: number };
      x?: { min?: number; max?: number };
      y?: { min?: number; max?: number };
      visible?: boolean;
    };

export type InspectAction =
  | { type: "click"; target?: InspectTarget; selector?: string; waitFor?: InspectWaitFor; assertions?: InspectAssertion[] }
  | { type: "fill"; target: InspectTarget; value: string; sensitive?: boolean; waitFor?: InspectWaitFor; assertions?: InspectAssertion[] }
  | { type: "select"; target: InspectTarget; option: { value?: string; label?: string }; waitFor?: InspectWaitFor; assertions?: InspectAssertion[] }
  | { type: "check"; target: InspectTarget; checked: boolean; waitFor?: InspectWaitFor; assertions?: InspectAssertion[] }
  | { type: "press"; target: InspectTarget; key: string; waitFor?: InspectWaitFor; assertions?: InspectAssertion[] }
  | { type: "wait"; durationMs: number; assertions?: InspectAssertion[] };

export type InspectCheckpoint = {
  actionIndex: number;
  actionType: InspectAction["type"];
  pageUrl: string;
  assertions: InspectAssertionResult[];
  assertionsPassed: boolean;
  pageText?: string;
  domSnapshot?: string;
  networkRequestIds?: string[];
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
  requestedMs?: number;
  elapsedMs?: number;
  waitFor?: InspectWaitFor;
  assertions?: InspectAssertionResult[];
  assertionsPassed?: boolean;
  checkpoint?: InspectCheckpoint;
  error?: string;
};

export type InspectAssertionResult = {
  type: InspectAssertion["type"];
  target?: InspectTarget;
  ok: boolean;
  matched?: number;
  actualCount?: number;
  attributePresent?: boolean;
  actualText?: string;
  actualUrl?: string;
  actualValue?: string | null;
  expectedValue?: string;
  property?: string;
  actualStyle?: string;
  expectedStyle?: string;
  actualGeometry?: InspectGeometry;
  expectedGeometry?: Record<string, unknown>;
  state?: "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked" | "expanded" | "collapsed";
  error?: string;
};

export type InspectNetworkRequest = {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  requestBody?: string;
  requestBodyTruncated?: boolean;
  responseBody?: string;
  responseBodyTruncated?: boolean;
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
  assertions: InspectAssertionResult[];
  assertionsPassed: boolean;
  elements: InspectElement[];
  screenshot?: InspectScreenshot;
  screenshotSuppressed?: "sensitive_action";
  console: ConsoleLog[];
  pageErrors: PageError[];
  requestFailures: RequestFailure[];
  networkRequests: InspectNetworkRequest[];
  checkpoints?: InspectCheckpoint[];
  droppedEvents: number;
};

export type InspectBlocked = Omit<InspectSuccess, "status" | "pageText" | "domSnapshot" | "interactions" | "assertions" | "assertionsPassed" | "elements" | "screenshot" | "screenshotSuppressed" | "networkRequests" | "checkpoints"> & {
  status: "blocked";
  networkRequests: InspectNetworkRequest[];
  checkpoints?: InspectCheckpoint[];
  pageText?: string;
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
const MAX_PAGE_TEXT_LENGTH = 65_536;
const MAX_DOM_SNAPSHOT_LENGTH = 65_536;
const MAX_INTERACTIONS = 12;
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
  const item=value as Record<string,unknown>;
  if(typeof item.selector!=="string" || item.selector.length===0 || item.selector.length>512) return false;
  if(!["visible","hidden","attached","detached"].includes(String(item.state))) return false;
  return item.timeoutMs===undefined || (isFiniteNonNegativeInteger(item.timeoutMs) && item.timeoutMs>0 && item.timeoutMs<=60_000);
}

function isScopeTarget(value: unknown): value is InspectScopeTarget {
  if(!value || typeof value!=="object") return false;
  const item=value as Record<string,unknown>;
  if(typeof item.by!=="string") return false;
  if(item.match!==undefined && item.match!=="exact" && item.match!=="contains") return false;
  switch(item.by){
    case "css":
    case "id":
    case "testId":
      return typeof item.value==="string" && item.value.length>0 && item.value.length<=512 && item.match===undefined;
    case "role":
      return typeof item.role==="string" && item.role.length>0 && item.role.length<=64 &&
        (item.name===undefined || (typeof item.name==="string" && item.name.length<=512));
    case "label":
    case "placeholder":
    case "text":
      return typeof item.value==="string" && item.value.length>0 && item.value.length<=512;
    default: return false;
  }
}

export function isInspectTarget(value: unknown, depth=0): value is InspectTarget {
  if(!value || typeof value!=="object") return false;
  const item=value as Record<string,unknown>;
  if(typeof item.by!=="string") return false;
  if(depth>0 && item.scope!==undefined) return false;
  if(item.match!==undefined && item.match!=="exact" && item.match!=="contains") return false;
  if(item.scope!==undefined && !isScopeTarget(item.scope)) return false;
  switch(item.by){
    case "css":
    case "id":
    case "testId":
      return typeof item.value==="string" && item.value.length>0 && item.value.length<=512 && item.match===undefined && item.scope===undefined;
    case "role":
      return typeof item.role==="string" && item.role.length>0 && item.role.length<=64 &&
        (item.name===undefined || (typeof item.name==="string" && item.name.length<=512));
    case "label":
    case "placeholder":
    case "text":
      return typeof item.value==="string" && item.value.length>0 && item.value.length<=512;
    default: return false;
  }
}

function isInspectAssertionResult(value: unknown): value is InspectAssertionResult {
  if(!value || typeof value!=="object") return false;
  const item=value as Record<string,unknown>;
  if(!["expectText","expectVisible","expectCount","expectAttribute","expectUrl","expectElementState","expectStyle","expectGeometry"].includes(String(item.type))) return false;
  if(typeof item.ok!=="boolean") return false;
  if(item.target!==undefined && !isInspectTarget(item.target)) return false;
  if(item.matched!==undefined && (!isFiniteNonNegativeInteger(item.matched) || item.matched>100)) return false;
  if(item.actualCount!==undefined && (!isFiniteNonNegativeInteger(item.actualCount) || item.actualCount>100)) return false;
  if(item.attributePresent!==undefined && typeof item.attributePresent!=="boolean") return false;
  for(const key of ["actualText","actualUrl","expectedValue","property","actualStyle","expectedStyle","error"]){
    if(item[key]!==undefined && typeof item[key]!=="string") return false;
  }
  if(item.actualValue!==undefined && item.actualValue!==null && typeof item.actualValue!=="string") return false;
  if(item.actualGeometry!==undefined){
    const g=item.actualGeometry as Record<string,unknown>;
    if(!g || !["x","y","width","height"].every(k=>typeof g[k]==="number" && Number.isFinite(g[k])) || typeof g.visible!=="boolean") return false;
  }
  if(item.state!==undefined && !["visible","hidden","enabled","disabled","checked","unchecked","expanded","collapsed"].includes(String(item.state))) return false;
  return true;
}

export function isInspectAssertion(value: unknown): value is InspectAssertion {
  if(!value || typeof value!=="object") return false;
  const item=value as Record<string,unknown>;
  switch(item.type){
    case "expectText":
      return isInspectTarget(item.target) && typeof item.text==="string" && item.text.length>0 && item.text.length<=4096 && (item.exact===undefined || typeof item.exact==="boolean");
    case "expectVisible": return isInspectTarget(item.target);
    case "expectCount": return isInspectTarget(item.target) && isFiniteNonNegativeInteger(item.count) && item.count<=100;
    case "expectAttribute":
      return isInspectTarget(item.target) && typeof item.name==="string" && /^[A-Za-z_:][A-Za-z0-9_.:-]{0,63}$/u.test(item.name) &&
        (item.value===undefined || (typeof item.value==="string" && item.value.length<=4096)) &&
        (item.present===undefined || typeof item.present==="boolean");
    case "expectUrl":
      return typeof item.value==="string" && item.value.length>0 && item.value.length<=512 &&
        (item.mode===undefined || ["exact","contains","startsWith"].includes(String(item.mode)));
    case "expectElementState":
      return isInspectTarget(item.target) && ["visible","hidden","enabled","disabled","checked","unchecked","expanded","collapsed"].includes(String(item.state));
    case "expectStyle":
      return isInspectTarget(item.target) && typeof item.property==="string" && /^[A-Za-z-]+$/u.test(item.property) && item.property.length<=128 &&
        typeof item.value==="string" && item.value.length<=1024 &&
        (item.mode===undefined || ["exact","contains","startsWith"].includes(String(item.mode)));
    case "expectGeometry": {
      if(!isInspectTarget(item.target)) return false;
      if(item.visible!==undefined && typeof item.visible!=="boolean") return false;
      for(const key of ["width","height","x","y"]){
        if(item[key]===undefined) continue;
        if(!item[key] || typeof item[key]!=="object") return false;
        const spec=item[key] as Record<string,unknown>;
        for(const bound of ["min","max","exact"]){
          if(spec[bound]===undefined) continue;
          if(typeof spec[bound]!=="number" || !Number.isFinite(spec[bound])) return false;
          if((key==="width" || key==="height") && (spec[bound] < 0 || spec[bound] > 4096)) return false;
          if((key==="x" || key==="y") && (spec[bound] < -100000 || spec[bound] > 100000)) return false;
        }
      }
      return true;
    }
    default: return false;
  }
}

export function isInspectAction(value: unknown): value is InspectAction {
  if(!value || typeof value!=="object") return false;
  const item=value as Record<string,unknown>;
  if(item.assertions!==undefined && (!Array.isArray(item.assertions) || item.assertions.length>8 || !item.assertions.every(isInspectAssertion))) return false;
  switch(item.type){
    case "click": {
      const hasTarget=item.target!==undefined, hasSelector=item.selector!==undefined;
      if(hasTarget===hasSelector) return false;
      if(hasTarget && !isInspectTarget(item.target)) return false;
      if(hasSelector && (typeof item.selector!=="string" || item.selector.length===0 || item.selector.length>512)) return false;
      return item.waitFor===undefined || isInspectWaitFor(item.waitFor);
    }
    case "fill":
      return isInspectTarget(item.target) && typeof item.value==="string" && item.value.length<=4096 &&
        (item.sensitive===undefined || typeof item.sensitive==="boolean") &&
        (item.waitFor===undefined || isInspectWaitFor(item.waitFor));
    case "select": {
      if(!isInspectTarget(item.target) || !item.option || typeof item.option!=="object") return false;
      const option=item.option as Record<string,unknown>;
      const hasValue=option.value!==undefined, hasLabel=option.label!==undefined;
      return (hasValue||hasLabel) &&
        (!hasValue || (typeof option.value==="string" && option.value.length>0 && option.value.length<=512)) &&
        (!hasLabel || (typeof option.label==="string" && option.label.length>0 && option.label.length<=512)) &&
        (item.waitFor===undefined || isInspectWaitFor(item.waitFor));
    }
    case "check":
      return isInspectTarget(item.target) && typeof item.checked==="boolean" && (item.waitFor===undefined || isInspectWaitFor(item.waitFor));
    case "press":
      return isInspectTarget(item.target) && typeof item.key==="string" && ALLOWED_PRESS_KEYS.has(item.key) && (item.waitFor===undefined || isInspectWaitFor(item.waitFor));
    case "wait":
      return isFiniteNonNegativeInteger(item.durationMs) && item.durationMs>0 && item.durationMs<=60_000;
    default: return false;
  }
}

function isInspectInteractionResult(value: unknown): value is InspectInteractionResult {
  if(!value || typeof value!=="object") return false;
  const item=value as Record<string,unknown>;
  if(!["click","fill","select","check","press","wait"].includes(String(item.type)) || typeof item.ok!=="boolean" || !isFiniteNonNegativeInteger(item.matched)) return false;
  if(item.target!==undefined && !isInspectTarget(item.target)) return false;
  if(item.selector!==undefined && (typeof item.selector!=="string" || item.selector.length===0 || item.selector.length>512)) return false;
  if(item.waitFor!==undefined && !isInspectWaitFor(item.waitFor)) return false;
  if(item.requestedMs!==undefined && (!isFiniteNonNegativeInteger(item.requestedMs) || item.requestedMs>60_000)) return false;
  if(item.elapsedMs!==undefined && !isFiniteNonNegativeInteger(item.elapsedMs)) return false;
  if(item.assertions!==undefined && (!Array.isArray(item.assertions) || item.assertions.length>8 || !item.assertions.every(isInspectAssertionResult))) return false;
  if(item.assertionsPassed!==undefined && typeof item.assertionsPassed!=="boolean") return false;
  if(item.checkpoint!==undefined && (!item.checkpoint || typeof item.checkpoint!=="object")) return false;
  if(item.error!==undefined && (typeof item.error!=="string" || item.error.length>2048)) return false;
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

function isInspectNetworkRequest(value: unknown): value is InspectNetworkRequest {
  if(!value || typeof value!=="object") return false;
  const item=value as Record<string,unknown>;
  if(typeof item.id!=="string" || item.id.length===0 || item.id.length>128) return false;
  if(typeof item.timestamp!=="string" || typeof item.method!=="string" || typeof item.url!=="string") return false;
  if(item.resourceType!==undefined && typeof item.resourceType!=="string") return false;
  if(item.status!==undefined && (!Number.isInteger(item.status) || item.status<0 || item.status>999)) return false;
  if(item.statusText!==undefined && typeof item.statusText!=="string") return false;
  if(item.durationMs!==undefined && !isFiniteNonNegativeInteger(item.durationMs)) return false;
  for(const key of ["requestBody","responseBody","error"]){ if(item[key]!==undefined && typeof item[key]!=="string") return false; }
  if(item.requestBodyTruncated!==undefined && typeof item.requestBodyTruncated!=="boolean") return false;
  if(item.responseBodyTruncated!==undefined && typeof item.responseBodyTruncated!=="boolean") return false;
  return true;
}

function isCommonResultFields(value: Record<string, unknown>, requirePageText: boolean): boolean {
  if(!isPageId(value.pageId) || !isFiniteNonNegativeInteger(value.durationMs)) return false;
  if(requirePageText && (typeof value.pageText!=="string" || value.pageText.length>65_536)) return false;
  if(requirePageText && (typeof value.domSnapshot!=="string" || value.domSnapshot.length>65_536)) return false;
  if(requirePageText && (!Array.isArray(value.interactions) || value.interactions.length>12 || !value.interactions.every(isInspectInteractionResult))) return false;
  if(requirePageText && (!Array.isArray(value.elements) || value.elements.length>100 || !value.elements.every(isInspectElement))) return false;
  if(requirePageText && (!Array.isArray(value.assertions) || value.assertions.length>32 || !value.assertions.every(isInspectAssertionResult))) return false;
  if(requirePageText && typeof value.assertionsPassed!=="boolean") return false;
  if(requirePageText && value.screenshot!==undefined && !isInspectScreenshot(value.screenshot)) return false;
  if(requirePageText && value.screenshotSuppressed!==undefined && value.screenshotSuppressed!=="sensitive_action") return false;
  if(!Array.isArray(value.console) || !value.console.every(isConsoleLog)) return false;
  if(!Array.isArray(value.pageErrors) || !value.pageErrors.every(isPageError)) return false;
  if(!Array.isArray(value.requestFailures) || !value.requestFailures.every(isRequestFailure)) return false;
  if(!Array.isArray(value.networkRequests) || value.networkRequests.length>100 || !value.networkRequests.every(isInspectNetworkRequest)) return false;
  if(value.checkpoints!==undefined && (!Array.isArray(value.checkpoints) || value.checkpoints.length>12)) return false;
  if(!Array.isArray(value.securityEvents) || !value.securityEvents.every(isSecurityEvent)) return false;
  if(!isFiniteNonNegativeInteger(value.droppedEvents)) return false;
  return true;
}

export function isInspectResult(value: unknown): value is InspectResult {
  if(!value || typeof value!=="object") return false;
  const result=value as Record<string,unknown>;
  if(result.status==="success") return isCommonResultFields(result,true);
  if(result.status==="blocked") return isCommonResultFields(result,false) && isBlockReason(result.reason);
  if(result.status==="error"){
    if(typeof result.traceId!=="string" || result.traceId.length===0 || result.traceId.length>128) return false;
    if(result.pageId!==undefined && !isPageId(result.pageId)) return false;
    if(!isFiniteNonNegativeInteger(result.durationMs) || !isErrorCode(result.code)) return false;
    if(typeof result.message!=="string" || result.message.length===0 || result.message.length>2048) return false;
    if (!Array.isArray(result.securityEvents) || !result.securityEvents.every(isSecurityEvent)) return false;
    return result.networkRequests === undefined || (Array.isArray(result.networkRequests) && result.networkRequests.length <= 100 && result.networkRequests.every(isInspectNetworkRequest));
  }
  return false;
}

export function asInspectResult(value: unknown): InspectResult {
  if (!isInspectResult(value)) throw new Error("Child returned an invalid inspect_crm_page result");
  return value;
}
