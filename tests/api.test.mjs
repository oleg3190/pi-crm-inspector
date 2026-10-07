import assert from "node:assert/strict";
import { test } from "node:test";
import { executeApiRequest } from "../dispatcher/api.ts";

test("API request injects the key at runtime and never returns it", async () => {
  const previousBase = process.env.PI_CRM_API_BASE_URL;
  const previousKey = process.env.PI_CRM_API_KEY;
  const previousHeader = process.env.PI_CRM_API_KEY_HEADER;
  const previousFetch = globalThis.fetch;

  process.env.PI_CRM_API_BASE_URL = "https://api.example.test";
  process.env.PI_CRM_API_KEY = "super-secret";
  process.env.PI_CRM_API_KEY_HEADER = "X-API-Key";

  let seen: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    seen = init;
    return new Response(JSON.stringify({ ok: true, echoed: "super-secret" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await executeApiRequest({ method: "GET", path: "/v1/customers" });
    assert.equal(result.status, 200);
    assert.equal(result.url, "https://api.example.test/v1/customers");
    assert.match(result.body, /REDACTED/);
    assert.doesNotMatch(result.body, /super-secret/);
    assert.equal((seen?.headers as Record<string, string>)["X-API-Key"], "super-secret");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.PI_CRM_API_BASE_URL;
    else process.env.PI_CRM_API_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.PI_CRM_API_KEY;
    else process.env.PI_CRM_API_KEY = previousKey;
    if (previousHeader === undefined) delete process.env.PI_CRM_API_KEY_HEADER;
    else process.env.PI_CRM_API_KEY_HEADER = previousHeader;
  }
});

test("API request rejects absolute or cross-origin paths", async () => {
  const previousBase = process.env.PI_CRM_API_BASE_URL;
  const previousKey = process.env.PI_CRM_API_KEY;
  process.env.PI_CRM_API_BASE_URL = "https://api.example.test";
  process.env.PI_CRM_API_KEY = "secret";

  try {
    await assert.rejects(
      executeApiRequest({ method: "GET", path: "https://evil.example.test/data" }),
      /relative and start with/,
    );
    await assert.rejects(
      executeApiRequest({ method: "GET", path: "//evil.example.test/data" }),
      /relative and start with/,
    );
  } finally {
    if (previousBase === undefined) delete process.env.PI_CRM_API_BASE_URL;
    else process.env.PI_CRM_API_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.PI_CRM_API_KEY;
    else process.env.PI_CRM_API_KEY = previousKey;
  }
});
