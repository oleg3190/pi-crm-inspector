import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeApiTraffic } from "../inspector/api-analyzer.ts";
import { isInspectResult } from "../shared/protocol.ts";

function request(overrides = {}) {
  return {
    id: "req-1",
    timestamp: "2026-10-13T12:00:00.000Z",
    method: "GET",
    url: "https://crm.example.test/api/items",
    resourceType: "fetch",
    status: 200,
    statusText: "OK",
    durationMs: 100,
    responseContentType: "application/json",
    responseBody: '{"data":[{"id":1,"name":"sample"}]}',
    failed: false,
    ...overrides,
  };
}

test("API analyzer groups numeric path IDs and summarizes status/latency", () => {
  const result = analyzeApiTraffic([
    request({ id: "a", url: "https://crm.example.test/api/items/123?token=secret", status: 200, durationMs: 100 }),
    request({ id: "b", url: "https://crm.example.test/api/items/456?token=other", status: 503, statusText: "Unavailable", durationMs: 4000, failed: true }),
  ]);

  assert.equal(result.analyzedRequests, 2);
  assert.equal(result.endpointCount, 1);
  assert.equal(result.endpoints[0]?.endpoint, "https://crm.example.test/api/items/:id");
  assert.equal(result.endpoints[0]?.requestCount, 2);
  assert.equal(result.endpoints[0]?.successCount, 1);
  assert.equal(result.endpoints[0]?.failedCount, 1);
  assert.deepEqual(result.endpoints[0]?.statuses, [200, 503]);
  assert.equal(result.endpoints[0]?.avgDurationMs, 2050);
  assert(result.findings.some((item) => item.kind === "http_error" && item.severity === "error"));
  assert(result.findings.some((item) => item.kind === "slow_response"));
  assert.equal(JSON.stringify(result).includes("?token=secret"), false);
});

test("API analyzer detects observed JSON field type differences without exposing values", () => {
  const result = analyzeApiTraffic([
    request({ id: "a", responseBody: '{"data":{"amount":15}}' }),
    request({ id: "b", responseBody: '{"data":{"amount":"15"}}' }),
  ]);
  const endpoint = result.endpoints[0];
  assert(endpoint?.schemaFields.some((field) => field.path === "$.data.amount" && field.types.includes("number") && field.types.includes("string")));
  assert(result.findings.some((item) => item.kind === "schema_type_inconsistency"));
  assert.equal(JSON.stringify(result).includes('"amount":15'), false);
});

test("API analyzer detects transport errors and only low-confidence UI co-occurrence", () => {
  const result = analyzeApiTraffic([
    request({ id: "network", status: undefined, statusText: undefined, responseBody: undefined, responseContentType: undefined, failed: true, error: "net::ERR_FAILED" }),
    request({ id: "server", status: 500, failed: true, responseBody: '{"error":"private text"}' }),
  ], {
    interactions: [{ ok: false }],
    assertions: [{ ok: false }],
  });

  assert(result.findings.some((item) => item.kind === "network_failure"));
  const correlation = result.findings.find((item) => item.kind === "ui_api_correlation");
  assert(correlation);
  assert.equal(correlation.confidence, "low");
  assert(correlation.evidence.some((item) => item.includes("not proof of causation")));
  assert.equal(JSON.stringify(result).includes("private text"), false);
});

test("API analyzer distinguishes empty and error-shaped JSON success responses", () => {
  const result = analyzeApiTraffic([
    request({ id: "empty", responseBody: "[]", responseContentType: "application/json" }),
    request({ id: "payload-error", responseBody: '{"success":false,"error":"hidden"}', responseContentType: "application/json" }),
  ]);
  assert(result.findings.some((item) => item.kind === "empty_success_payload" && item.severity === "info" && item.confidence === "low"));
  assert(result.findings.some((item) => item.kind === "error_payload"));
  assert.equal(JSON.stringify(result).includes("hidden"), false);
});

test("API analyzer ignores truncated bodies for schema/JSON parse warnings", () => {
  const result = analyzeApiTraffic([
    request({ responseBody: '{"data":[', responseBodyTruncated: true }),
  ]);
  assert.equal(result.findings.some((item) => item.kind === "invalid_json"), false);
  assert.equal(result.endpoints[0]?.schemaTruncated, true);
});

test("inspection result protocol validates bounded API analysis and rejects malformed findings", () => {
  const base = {
    status: "success",
    traceId: "trace",
    pageId: "dashboard",
    durationMs: 10,
    pageText: "",
    domSnapshot: "",
    interactions: [],
    assertions: [],
    assertionsPassed: true,
    elements: [],
    console: [],
    pageErrors: [],
    requestFailures: [],
    networkRequests: [],
    securityEvents: [],
    droppedEvents: 0,
    diagnosticsSummary: { actionCount: 0, actionsPassed: 0, assertionCount: 0, assertionsPassed: 0, failedAssertions: 0, networkRequests: 0, failedNetworkRequests: 0, consoleErrors: 0, pageErrors: 0, checkpoints: 0 },
  };
  const apiAnalysis = analyzeApiTraffic([request()]);
  assert.equal(isInspectResult({ ...base, apiAnalysis }), true);
  assert.equal(isInspectResult({ ...base, apiAnalysis: { ...apiAnalysis, findings: [{ id: "bad" }] } }), false);
});
