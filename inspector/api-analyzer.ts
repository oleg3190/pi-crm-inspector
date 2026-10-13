import type {
  InspectAssertionResult,
  InspectInteractionResult,
  InspectNetworkRequest,
} from "../shared/protocol.ts";

export type ApiFindingKind =
  | "http_error"
  | "network_failure"
  | "slow_response"
  | "invalid_json"
  | "error_payload"
  | "empty_success_payload"
  | "schema_type_inconsistency"
  | "ui_api_correlation";

export type ApiFinding = {
  id: string;
  kind: ApiFindingKind;
  severity: "info" | "warning" | "error";
  confidence: "low" | "medium" | "high";
  title: string;
  endpoint?: string;
  evidence: string[];
  requestIds: string[];
};

export type ApiSchemaField = {
  path: string;
  types: string[];
  nullable: boolean;
};

export type ApiEndpointAnalysis = {
  endpoint: string;
  method: string;
  requestCount: number;
  successCount: number;
  failedCount: number;
  statuses: number[];
  avgDurationMs?: number;
  maxDurationMs?: number;
  contentTypes: string[];
  schemaFields: ApiSchemaField[];
  schemaTruncated?: boolean;
};

export type ApiAnalysis = {
  analyzedRequests: number;
  endpointCount: number;
  endpoints: ApiEndpointAnalysis[];
  findings: ApiFinding[];
  omittedEndpointCount?: number;
  omittedFindingCount?: number;
  slowResponseThresholdMs: number;
};

type UiContext = {
  interactions?: readonly Pick<InspectInteractionResult, "ok">[];
  assertions?: readonly Pick<InspectAssertionResult, "ok">[];
};

type RequestGroup = {
  endpoint: string;
  method: string;
  requests: InspectNetworkRequest[];
};

const SLOW_RESPONSE_MS = 3_000;
const MAX_ENDPOINTS = 40;
const MAX_FINDINGS = 40;
const MAX_SCHEMA_FIELDS = 32;
const MAX_SCHEMA_DEPTH = 6;
const MAX_SCHEMA_NODES = 500;
const MAX_EVIDENCE = 4;
const MAX_REQUEST_IDS = 10;

function normalizedEndpoint(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname
      .split("/")
      .map((segment) => {
        if (!segment) return segment;
        if (/^\d+$/u.test(segment)) return ":id";
        if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment)) return ":id";
        if (/^[0-9a-f]{16,}$/iu.test(segment)) return ":id";
        return segment;
      })
      .join("/")
      .replace(/\/$/u, "") || "/";
    return url.origin + path;
  } catch {
    return "[invalid-url]";
  }
}

function endpointKey(request: InspectNetworkRequest): string {
  return request.method.toUpperCase() + " " + normalizedEndpoint(request.url);
}

function isFailed(request: InspectNetworkRequest): boolean {
  return request.failed === true
    || request.error !== undefined
    || (request.status !== undefined && request.status >= 400);
}

function isSuccessful(request: InspectNetworkRequest): boolean {
  return request.status !== undefined && request.status >= 200 && request.status < 400;
}

function safeContentType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.split(";", 1)[0]?.trim().toLowerCase().slice(0, 100) || undefined;
}

function responseJson(request: InspectNetworkRequest): unknown | undefined {
  if (!request.responseBody || request.responseBodyTruncated) return undefined;
  if (!safeContentType(request.responseContentType)?.includes("json")) return undefined;
  try {
    return JSON.parse(request.responseBody) as unknown;
  } catch {
    return undefined;
  }
}

function hasErrorPayload(value: unknown, depth = 0): boolean {
  if (depth > 5 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.slice(0, 10).some((item) => hasErrorPayload(item, depth + 1));
  const object = value as Record<string, unknown>;
  if (object.success === false) return true;
  for (const [key, child] of Object.entries(object)) {
    if (/^(?:error|errors)$/iu.test(key)) {
      if (child !== null && child !== undefined && child !== false && child !== "" &&
        (!Array.isArray(child) || child.length > 0) &&
        (typeof child !== "object" || Array.isArray(child) || Object.keys(child as object).length > 0)) {
        return true;
      }
    }
    if (child && typeof child === "object" && hasErrorPayload(child, depth + 1)) return true;
  }
  return false;
}

function isEmptyPayload(value: unknown): boolean {
  return value === null
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

type MutableSchemaField = { types: Set<string>; nullable: boolean };

function collectSchema(
  value: unknown,
  path: string,
  fields: Map<string, MutableSchemaField>,
  depth: number,
  state: { nodes: number },
): void {
  if (depth > MAX_SCHEMA_DEPTH || state.nodes >= MAX_SCHEMA_NODES) return;
  state.nodes++;
  const type = jsonType(value);
  if (type === "null") {
    const current = fields.get(path) ?? { types: new Set<string>(), nullable: false };
    current.nullable = true;
    fields.set(path, current);
    return;
  }

  const current = fields.get(path) ?? { types: new Set<string>(), nullable: false };
  current.types.add(type);
  fields.set(path, current);

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) collectSchema(item, path + "[*]", fields, depth + 1, state);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, MAX_SCHEMA_FIELDS)) {
      const childPath = path === "$" ? "$." + key : path + "." + key;
      collectSchema(child, childPath, fields, depth + 1, state);
    }
  }
}

function deriveSchema(requests: readonly InspectNetworkRequest[]): {
  fields: ApiSchemaField[];
  truncated: boolean;
  inconsistent: ApiSchemaField[];
} {
  const merged = new Map<string, MutableSchemaField>();
  let parsedResponses = 0;
  let truncated = false;
  for (const request of requests) {
    if (request.responseBodyTruncated) {
      truncated = true;
      continue;
    }
    const parsed = responseJson(request);
    if (parsed === undefined) continue;
    parsedResponses++;
    collectSchema(parsed, "$", merged, 0, { nodes: 0 });
    if (merged.size > MAX_SCHEMA_FIELDS) truncated = true;
  }
  const fields = [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_SCHEMA_FIELDS)
    .map(([path, field]) => ({ path, types: [...field.types].sort(), nullable: field.nullable }));
  if (merged.size > MAX_SCHEMA_FIELDS || requests.some((request) => request.responseBodyTruncated)) truncated = true;
  const inconsistent = parsedResponses > 1 ? fields.filter((field) => field.types.length > 1) : [];
  return { fields, truncated, inconsistent };
}

function durationStats(requests: readonly InspectNetworkRequest[]): { avg?: number; max?: number } {
  const values = requests
    .map((request) => request.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (values.length === 0) return {};
  return {
    avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    max: Math.max(...values),
  };
}

function finding(
  kind: ApiFindingKind,
  severity: ApiFinding["severity"],
  confidence: ApiFinding["confidence"],
  title: string,
  requests: readonly InspectNetworkRequest[],
  endpoint?: string,
  evidence: string[] = [],
): ApiFinding {
  return {
    id: "",
    kind,
    severity,
    confidence,
    title,
    ...(endpoint ? { endpoint } : {}),
    evidence: evidence.slice(0, MAX_EVIDENCE),
    requestIds: requests.slice(0, MAX_REQUEST_IDS).map((request) => request.id),
  };
}

export function analyzeApiTraffic(
  requests: readonly InspectNetworkRequest[],
  uiContext: UiContext = {},
): ApiAnalysis {
  const groups = new Map<string, RequestGroup>();
  for (const request of requests) {
    const endpoint = normalizedEndpoint(request.url);
    const method = request.method.toUpperCase();
    const key = method + " " + endpoint;
    const group = groups.get(key) ?? { endpoint, method, requests: [] };
    group.requests.push(request);
    groups.set(key, group);
  }

  const endpointSummaries: ApiEndpointAnalysis[] = [];
  const findings: ApiFinding[] = [];

  for (const group of groups.values()) {
    const failedRequests = group.requests.filter(isFailed);
    const statusValues = [...new Set(group.requests.flatMap((request) =>
      request.status === undefined ? [] : [request.status],
    ))].sort((a, b) => a - b);
    const contentTypes = [...new Set(group.requests
      .map((request) => safeContentType(request.responseContentType))
      .filter((value): value is string => value !== undefined))].sort();
    const stats = durationStats(group.requests);
    const schema = deriveSchema(group.requests);
    endpointSummaries.push({
      endpoint: group.endpoint,
      method: group.method,
      requestCount: group.requests.length,
      successCount: group.requests.filter(isSuccessful).length,
      failedCount: failedRequests.length,
      statuses: statusValues,
      ...(stats.avg === undefined ? {} : { avgDurationMs: stats.avg }),
      ...(stats.max === undefined ? {} : { maxDurationMs: stats.max }),
      contentTypes,
      schemaFields: schema.fields,
      ...(schema.truncated ? { schemaTruncated: true } : {}),
    });

    const serverErrors = failedRequests.filter((request) => (request.status ?? 0) >= 500);
    const clientErrors = failedRequests.filter((request) => request.status !== undefined && request.status >= 400 && request.status < 500);
    const transportErrors = failedRequests.filter((request) => request.status === undefined);
    if (serverErrors.length > 0 || clientErrors.length > 0) {
      const sample = serverErrors.length > 0 ? serverErrors : clientErrors;
      const statuses = [...new Set(sample.map((request) => request.status).filter((value): value is number => value !== undefined))].sort((a, b) => a - b);
      findings.push(finding(
        "http_error",
        serverErrors.length > 0 ? "error" : "warning",
        "high",
        serverErrors.length > 0 ? "Endpoint returned HTTP server errors" : "Endpoint returned HTTP client errors",
        sample,
        group.endpoint,
        [
          "method: " + group.method,
          "HTTP status codes: " + statuses.join(", "),
          "failed responses: " + sample.length,
        ],
      ));
    }
    if (transportErrors.length > 0) {
      findings.push(finding(
        "network_failure", "warning", "high", "Request failed without an HTTP response",
        transportErrors, group.endpoint,
        [
          "method: " + group.method,
          "failed requests: " + transportErrors.length,
          ...transportErrors.slice(0, 2).map((request) => "browser error: " + (request.error || "unknown")),
        ],
      ));
    }

    const slowRequests = group.requests.filter((request) => request.durationMs !== undefined && request.durationMs > SLOW_RESPONSE_MS);
    if (slowRequests.length > 0) {
      findings.push(finding(
        "slow_response", "warning", "medium", "Endpoint response exceeded the latency threshold",
        slowRequests, group.endpoint,
        [
          "threshold: " + SLOW_RESPONSE_MS + " ms",
          "slow requests: " + slowRequests.length,
          "maximum observed: " + Math.max(...slowRequests.map((request) => request.durationMs ?? 0)) + " ms",
        ],
      ));
    }

    const malformedJson = group.requests.filter((request) =>
      isSuccessful(request)
      && safeContentType(request.responseContentType)?.includes("json")
      && !!request.responseBody
      && !request.responseBodyTruncated
      && responseJson(request) === undefined
      && request.responseBody !== "[response body unavailable]",
    );
    if (malformedJson.length > 0) {
      findings.push(finding(
        "invalid_json", "warning", "high", "Successful response declared JSON but body could not be parsed",
        malformedJson, group.endpoint,
        ["responses that failed JSON parsing: " + malformedJson.length],
      ));
    }

    const errorPayloads = group.requests.filter((request) => {
      if (!isSuccessful(request)) return false;
      const parsed = responseJson(request);
      return parsed !== undefined && hasErrorPayload(parsed);
    });
    if (errorPayloads.length > 0) {
      findings.push(finding(
        "error_payload", "warning", "high", "Successful HTTP response contains an error-shaped JSON payload",
        errorPayloads, group.endpoint,
        [
          "HTTP status was in the success range",
          "payload contains an error/errors field or success=false",
          "matching responses: " + errorPayloads.length,
        ],
      ));
    }

    const emptyPayloads = group.requests.filter((request) => {
      if (!isSuccessful(request) || !safeContentType(request.responseContentType)?.includes("json")) return false;
      const parsed = responseJson(request);
      return parsed !== undefined && isEmptyPayload(parsed);
    });
    if (emptyPayloads.length > 0) {
      findings.push(finding(
        "empty_success_payload", "info", "low", "Endpoint returned an empty JSON payload",
        emptyPayloads, group.endpoint,
        [
          "HTTP status was in the success range",
          "empty values observed: [], {}, or null",
          "empty responses can be valid; compare with the page's expected state",
        ],
      ));
    }

    if (schema.inconsistent.length > 0) {
      findings.push(finding(
        "schema_type_inconsistency", "warning", "medium", "JSON field types vary across responses",
        group.requests.filter((request) => responseJson(request) !== undefined),
        group.endpoint,
        schema.inconsistent.slice(0, 3).map((field) => field.path + ": " + field.types.join(" | ")),
      ));
    }
  }

  const failedInteractions = uiContext.interactions?.filter((item) => !item.ok).length ?? 0;
  const failedAssertions = uiContext.assertions?.filter((item) => !item.ok).length ?? 0;
  const failedApi = requests.filter(isFailed);
  if (failedApi.length > 0 && (failedInteractions > 0 || failedAssertions > 0)) {
    findings.push(finding(
      "ui_api_correlation",
      "info",
      "low",
      "UI failures and API failures occurred in the same inspection",
      failedApi,
      undefined,
      [
        "failed API requests: " + failedApi.length,
        "failed UI interactions: " + failedInteractions,
        "failed assertions: " + failedAssertions,
        "co-occurrence is a diagnostic lead, not proof of causation",
      ],
    ));
  }

  endpointSummaries.sort((a, b) => b.requestCount - a.requestCount || a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method));
  findings.forEach((item, index) => { item.id = "api-finding-" + String(index + 1); });
  findings.sort((a, b) => {
    const rank = (severity: ApiFinding["severity"]) => severity === "error" ? 0 : severity === "warning" ? 1 : 2;
    return rank(a.severity) - rank(b.severity) || a.id.localeCompare(b.id);
  });

  return {
    analyzedRequests: requests.length,
    endpointCount: groups.size,
    endpoints: endpointSummaries.slice(0, MAX_ENDPOINTS),
    findings: findings.slice(0, MAX_FINDINGS),
    ...(groups.size > MAX_ENDPOINTS ? { omittedEndpointCount: groups.size - MAX_ENDPOINTS } : {}),
    ...(findings.length > MAX_FINDINGS ? { omittedFindingCount: findings.length - MAX_FINDINGS } : {}),
    slowResponseThresholdMs: SLOW_RESPONSE_MS,
  };
}
