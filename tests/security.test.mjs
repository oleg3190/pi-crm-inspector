import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_IDS, isInspectResult, asInspectResult } from "../shared/protocol.ts";
import { CRM_POLICY, getPageConfig } from "../inspector/policy.ts";
import { isAllowedPath, isAllowedQuery, normalizedOrigin, scrubSecrets, validatePathRule, validateQueryPolicy } from "../inspector/security.ts";

test("fixed origin is strict HTTPS origin", () => {
  assert.equal(normalizedOrigin(CRM_POLICY.origin), CRM_POLICY.origin);
  assert.throws(() => normalizedOrigin("http://crm.example.internal"));
  assert.throws(() => normalizedOrigin("https://crm.example.internal/path"));
});

test("root wildcard rules are rejected", () => {
  assert.throws(() => validatePathRule("/**"));
  assert.throws(() => validatePathRule("/*"));
  assert.doesNotThrow(() => validatePathRule("/api/logs/**"));
});

test("query allowlist is deny-by-default", () => {
  assert.doesNotThrow(() => validateQueryPolicy({ allowedKeys: ["page", "sort_by"] }));
  assert.throws(() => validateQueryPolicy({ allowedKeys: ["page=1"] }));
  assert.equal(isAllowedQuery("", { allowedKeys: [] }), true);
  assert.equal(isAllowedQuery("?page=1", { allowedKeys: [] }), false);
  assert.equal(isAllowedQuery("?page=1", { allowedKeys: ["page"] }), true);
});

test("secrets are redacted", () => {
  const result = scrubSecrets("password=hunter2 Bearer abc123 https://example.internal/x?token=secret", ["hunter2"]);
  assert(!result.includes("hunter2"));
  assert(!result.includes("Bearer abc123"));
  assert(!result.includes("token=secret"));
});

test("request paths are exact except explicit subtree rules", () => {
  assert.deepEqual(PAGE_IDS, ["dashboard", "billing_logs", "auth_logs"]);
  for (const id of PAGE_IDS) assert(getPageConfig(id).allowedRequestPaths.includes("/login"));
  assert.equal(isAllowedPath("/api/dashboard/summary", getPageConfig("dashboard").allowedRequestPaths), true);
  assert.equal(isAllowedPath("/api/dashboard/admin", getPageConfig("dashboard").allowedRequestPaths), false);
});

test("protocol guard accepts only valid results", () => {
  const base = {
    traceId: "trace",
    pageId: "dashboard",
    durationMs: 1,
    console: [],
    pageErrors: [],
    requestFailures: [],
    securityEvents: [],
    droppedEvents: 0,
  };
  assert.equal(isInspectResult({ status: "success", ...base }), true);
  assert.equal(isInspectResult({ status: "blocked", ...base, reason: "external_redirect" }), true);
  assert.equal(isInspectResult({ status: "error", traceId: "trace", pageId: "dashboard", durationMs: 1, code: "timeout", message: "x", securityEvents: [] }), true);
  assert.throws(() => asInspectResult({ status: "success" }));
});
