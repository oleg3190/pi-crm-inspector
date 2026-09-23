import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_IDS, isInspectResult, asInspectResult } from "../shared/protocol.ts";
import { CRM_POLICY, getPageConfig } from "../inspector/policy.ts";
import { anonymizeTextContent, anonymizeTextSegments } from "../inspector/index.ts";
import { isAllowedPath, isAllowedQuery, normalizedOrigin, scrubSecrets, validatePathRule, validateQueryPolicy, isAllowedRequest, isAllowedDocumentUrl } from "../inspector/security.ts";
import { buildChildEnv, extractChildToolResult, extractChildToolImages } from "../dispatcher/index.ts";

test("fixed origin is strict HTTPS origin", () => {
  assert.equal(normalizedOrigin("https://crm.example.internal"), "https://crm.example.internal");
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

test("text anonymization preserves dates exactly", () => {
  const input = "Событие 29.10.2025 12:53:47 и 29.10.2025  29-10-2025, номер 12345";
  const output = anonymizeTextContent(input);

  assert.equal(
    output,
    "ipsum 29.10.2025 12:53:47 ipsum 29.10.2025  29-10-2025, ipsum 77777",
  );
});

test("date stays intact when split across DOM text nodes", () => {
  assert.deepEqual(
    anonymizeTextSegments(["Событие ", "29.10.", "2025", " 12:53:47"]),
    ["ipsum ", "29.10.", "2025", " 12:53:47"],
  );
});

test("ISO date is preserved", () => {
  assert.equal(
    anonymizeTextContent("Создано 2025-10-29, номер 12345"),
    "ipsum 2025-10-29, ipsum 77777",
  );
});

test("text anonymization preserves digit count and number-like formatting", () => {
  const input = "Иван Иванов: заказ №12345, сумма 1 234,56 руб. Телефон +372 555-1234";
  const output = anonymizeTextContent(input);

  assert.equal(output, "ipsum ipsum: ipsum №77777, ipsum 7 777,77 ipsum. ipsum +777 777-7777");
  assert.equal((output.match(/\\d/g) ?? []).length, (input.match(/\\d/g) ?? []).length);
  assert.equal((output.match(/77777/g) ?? []).length, 1);
  assert.equal(anonymizeTextContent(output), output);
});

test("secrets are redacted", () => {
  const result = scrubSecrets("password=hunter2 Bearer abc123 https://example.internal/x?token=secret", ["hunter2"]);
  assert(!result.includes("hunter2"));
  assert(!result.includes("Bearer abc123"));
  assert(!result.includes("token=secret"));
});

test("request URL/path restrictions are disabled", () => {
  assert.deepEqual(PAGE_IDS, ["dashboard", "billing_logs", "auth_logs", "custom"]);

  const pageConfig = getPageConfig("dashboard");
  const makeRequest = (url, method = "GET") => ({
    url: () => url,
    method: () => method,
    resourceType: () => "document",
  });

  assert.deepEqual(
    isAllowedRequest(makeRequest("https://example.com/completely/arbitrary/path?foo=bar"), pageConfig, "authenticated"),
    { allowed: true },
  );
  assert.deepEqual(
    isAllowedRequest(makeRequest("http://10.0.0.5:8080/unlisted", "POST"), pageConfig, "authenticated"),
    { allowed: true },
  );
});

test("protocol guard accepts only valid results", () => {
  const base = {
    traceId: "trace",
    pageId: "dashboard",
    durationMs: 1,
    pageText: "ipsum Dashboard",
    domSnapshot: "<body><main>ipsum Dashboard</main></body>",
    interactions: [],
    elements: [],
    console: [],
    pageErrors: [],
    requestFailures: [],
    securityEvents: [],
    droppedEvents: 0,
  };
  assert.equal(isInspectResult({ status: "success", ...base }), true);
  assert.equal(isInspectResult({ status: "blocked", ...base, reason: "external_redirect" }), true);
  assert.equal(isInspectResult({ status: "error", traceId: "trace", pageId: "dashboard", durationMs: 1, code: "timeout", message: "x", securityEvents: [] }), true);
  assert.equal(
    isInspectResult({ status: "success", ...base, interactions: Array.from({ length: 9 }, (_, index) => ({ type: "click", selector: String(index), ok: true, matched: 1 })) }),
    false,
  );
  assert.equal(
    isInspectResult({
      status: "success",
      ...base,
      interactions: [{ type: "click", selector: "#go", ok: true, matched: 1, waitFor: { selector: "#ready", state: "visible", timeoutMs: 1000 } }],
      elements: [{ kind: "button", selector: "body:nth-of-type(1) > button:nth-of-type(1)", visible: true, enabled: true }],
      screenshot: { mimeType: "image/png", width: 800, height: 600 },
    }),
    true,
  );
  assert.throws(() => asInspectResult({ status: "success" }));
});

// ===== Adversarial / Regression Tests =====

test("child screenshot content is extracted separately from result details", () => {
  const fakeStdout = `
{"type":"tool_execution_end","toolName":"inspect_crm_page","result":{"details":{"status":"success","traceId":"t1","pageId":"dashboard","durationMs":1,"pageText":"ipsum","domSnapshot":"<body></body>","interactions":[],"elements":[],"console":[],"pageErrors":[],"requestFailures":[],"securityEvents":[],"droppedEvents":0},"content":[{"type":"text","text":"{}"},{"type":"image","data":"abc","mimeType":"image/png"}]}}
`;
  assert.deepEqual(extractChildToolImages(fakeStdout, false), [{ type: "image", data: "abc", mimeType: "image/png" }]);
});


test("protocol — two tool_execution_end events → extractChildToolResult throws", () => {
  const fakeStdout = `
{"type":"tool_execution_end","toolName":"inspect_crm_page","result":{"details":{"status":"success","traceId":"t1","pageId":"dashboard","durationMs":1,"console":[],"pageErrors":[],"requestFailures":[],"securityEvents":[],"droppedEvents":0}}}
{"type":"tool_execution_end","toolName":"inspect_crm_page","result":{"details":{"status":"success","traceId":"t2","pageId":"dashboard","durationMs":1,"console":[],"pageErrors":[],"requestFailures":[],"securityEvents":[],"droppedEvents":0}}}
`;
  assert.throws(() => extractChildToolResult(fakeStdout, "dashboard", false));
});

test("stdout overflow → throws", () => {
  const fakeStdout = "x".repeat(1000); // any content
  assert.throws(() => extractChildToolResult(fakeStdout, "dashboard", true));
});

test("malformed details (no status/pageId) → asInspectResult throws", () => {
  assert.throws(() => asInspectResult({}));
  assert.throws(() => asInspectResult({ traceId: "x", pageId: "dashboard", durationMs: 0, console: [], pageErrors: [], requestFailures: [], securityEvents: [], droppedEvents: 0 }));
});

test("env dangerous vars — copyEnv must NOT pass NODE_OPTIONS (test via regex)", () => {
  // Save original
  const originalNodeOptions = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = "--require ./evil.js";
    const childEnv = buildChildEnv();
    assert.strictEqual(childEnv.NODE_OPTIONS, undefined, "NODE_OPTIONS must not be passed to child environment");
  } finally {
    // Restore
    if (originalNodeOptions !== undefined) {
      process.env.NODE_OPTIONS = originalNodeOptions;
    } else {
      delete process.env.NODE_OPTIONS;
    }
  }
});

test("CHILD_GUARD_ENV — inspector throws if env not set", async () => {
  const mockPi = {
    registerTool: (opts) => {
      if (opts.name === "inspect_crm_page") {
        mockPi.execute = opts.execute;
      }
    }
  };
  // Unset CHILD_GUARD_ENV — must throw on default export call
  delete process.env.PI_CRM_INSPECTOR_CHILD;
  const inspector = await import("../inspector/index.ts");
  assert.throws(() => inspector.default(mockPi), /child-only and may only be loaded by the CRM dispatcher/);
});

test("second invocationUsed → second call returns error with terminate:true", async () => {
  process.env.PI_CRM_INSPECTOR_CHILD = "1";
  const mockPi = {
    registerTool: (opts) => {
      if (opts.name === "inspect_crm_page") {
        mockPi.execute = opts.execute;
      }
    }
  };
  const inspector = await import("../inspector/index.ts");
  inspector.default(mockPi);
  const result1 = await mockPi.execute(null, { page_id: "dashboard" }, undefined);
  const result2 = await mockPi.execute(null, { page_id: "dashboard" }, undefined);
  assert.equal(result2.terminate, true);
  assert.equal(result2.isError, true);
  assert.equal(result2.details.status, "error");
  assert.equal(result2.details.code, "browser_error");
  assert.equal(result2.details.message, "This CRM inspector child session permits exactly one inspection call.");
});

test("query allowlist — isAllowedQuery rejects unknown keys", () => {
  assert.equal(isAllowedQuery("?page=1&unknown=2", { allowedKeys: ["page"] }), false);
  assert.equal(isAllowedQuery("?unknown=1", { allowedKeys: ["page"] }), false);
  assert.equal(isAllowedQuery("?page=1&sort=asc", { allowedKeys: ["page", "sort"] }), true);
});

test("path allowlist — isAllowedPath rejects unknown paths", () => {
  const allowed = ["/api/dashboard/summary", "/api/billing/logs"];
  assert.equal(isAllowedPath("/api/dashboard/unknown", allowed), false);
  assert.equal(isAllowedPath("/api/billing/unknown", allowed), false);
  assert.equal(isAllowedPath("/api/dashboard/summary", allowed), true);
});

test("URL credentials — isAllowedDocumentUrl rejects url with username/password", () => {
  const allowedDocs = ["https://crm.example.internal/dashboard"];
  assert.equal(isAllowedDocumentUrl("https://user:pass@crm.example.internal/dashboard", allowedDocs), false);
  assert.equal(isAllowedDocumentUrl("https://crm.example.internal/dashboard", allowedDocs), true);
});

test("non-https — normalizedOrigin throws for http", () => {
  assert.throws(() => normalizedOrigin("http://crm.example.internal"));
  assert.throws(() => normalizedOrigin("http://crm.example.internal/"));
  assert.doesNotThrow(() => normalizedOrigin("https://crm.example.internal"));
});


test("URL allowlist is disabled — arbitrary destinations are allowed", () => {
  const pageConfig = getPageConfig("dashboard");
  const makeRequest = (url, method = "GET") => ({
    url: () => url,
    method: () => method,
    resourceType: () => "document",
  });

  assert.deepEqual(
    isAllowedRequest(makeRequest("https://auth.example.internal/login"), pageConfig, "login"),
    { allowed: true },
  );
  assert.deepEqual(
    isAllowedRequest(makeRequest("https://another.example.com/any/path?foo=bar"), pageConfig, "authenticated"),
    { allowed: true },
  );
  assert.deepEqual(
    isAllowedRequest(makeRequest("http://10.0.0.5:8080/unlisted", "GET"), pageConfig, "authenticated"),
    { allowed: true },
  );
});

test("URL allowlist disabled — login POST is allowed regardless of destination", () => {
  const pageConfig = getPageConfig("dashboard");
  const request = {
    url: () => "https://auth.example.internal/login",
    method: () => "POST",
    resourceType: () => "document",
  };

  assert.deepEqual(
    isAllowedRequest(request, pageConfig, "login"),
    { allowed: true },
  );
});

test("all HTTP methods are allowed", () => {
  const pageConfig = getPageConfig("dashboard");
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const request = {
      url: () => "https://any.example.com/path",
      method: () => method,
      resourceType: () => "document",
    };

    assert.deepEqual(
      isAllowedRequest(request, pageConfig, "authenticated"),
      { allowed: true },
    );
  }
});

test("WebSocket is enabled and popup blocking is disabled", async () => {
  const policy = await import("../inspector/policy.ts");
  assert.equal(policy.CRM_POLICY.browser.allowWebSocket, true);

  const index = await import("../inspector/index.ts");
  assert.equal(typeof index.default, "function");
});
