import assert from "node:assert/strict";
import { test } from "node:test";
import { executeApiRequest, extractApiResponse, findApiResponseFields, selectApiResponse } from "../dispatcher/api.ts";

const registry = JSON.stringify({
  customers: { baseUrl: "https://customers.example.test", auth: { type: "apiKey", header: "X-API-Key", secretRef: "CUSTOMERS_API_KEY" } },
  orders: { baseUrl: "https://orders.example.test", auth: { type: "bearer", secretRef: "ORDERS_API_TOKEN" } },
});

function setEnv(name, value) {
  const old = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  return () => {
    if (old === undefined) delete process.env[name]; else process.env[name] = old;
  };
}

test("API request injects a service secret but never returns it", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "customers-secret")];
  const oldFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (_input, init) => {
    seen = init;
    return new Response(JSON.stringify({ echoed: "customers-secret" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.match(result.url, /^https:\/\/example\.invalid\/__pi_crm_url\/[a-f0-9]{32}$/);
    assert.doesNotMatch(result.url, /v1\/customers/);
    assert.equal(result.anonymized, true);
    assert.doesNotMatch(result.body, /customers-secret/);
    assert.equal(JSON.parse(result.body).echoed !== "customers-secret", true);
    assert.equal(seen.headers["X-API-Key"], "customers-secret");
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request body is sent verbatim and is never anonymized", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  let seenBody;
  globalThis.fetch = async (_input, init) => {
    seenBody = init.body;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const requestBody = JSON.stringify({ customerId: "real-customer-id", email: "real@example.com" });
    await executeApiRequest({ service: "customers", method: "POST", path: "/v1/customers/search", body: requestBody });
    assert.equal(seenBody, requestBody);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("anonymized API URLs remain executable through the URL token", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const seenUrls = [];
  globalThis.fetch = async (input) => {
    seenUrls.push(String(input));
    return new Response(JSON.stringify({ next: "https://customers.example.test/v1/customers?page=2" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const first = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    const tokenUrl = JSON.parse(first.body).next;
    const tokenPath = new URL(tokenUrl).pathname;
    await executeApiRequest({ service: "customers", method: "GET", path: tokenPath });
    assert.equal(seenUrls[0], "https://customers.example.test/v1/customers");
    assert.equal(seenUrls[1], "https://customers.example.test/v1/customers?page=2");
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API response keeps object schema while anonymizing every JSON value", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const payload = {
    id: 12345,
    customerId: "cust_001234",
    order_id: 987654,
    ids: ["a1", "b2"],
    name: "Ivan Petrov",
    email: "ivan@example.com",
    phone: "+79991234567",
    active: true,
    verified: false,
    status: "active",
    orderStatus: "processing",
    balance: 15320.5,
    createdAt: "2026-09-12T10:30:00Z",
    uuid: "550e8400-e29b-41d4-a716-446655440000",
    tags: ["vip", "client"],
    profile: { city: "Moscow", empty: null },
  };
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const first = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers/123" });
    const second = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers/123" });
    const a = JSON.parse(first.body);
    const b = JSON.parse(second.body);
    assert.deepEqual(Object.keys(a), Object.keys(payload));
    assert.deepEqual(Object.keys(a.profile), Object.keys(payload.profile));
    assert.equal(a.id, payload.id);
    assert.equal(a.customerId, payload.customerId);
    assert.equal(a.order_id, payload.order_id);
    assert.deepEqual(a.ids, payload.ids);
    assert.equal(a.active, payload.active);
    assert.equal(a.verified, payload.verified);
    assert.equal(a.status, payload.status);
    assert.equal(a.orderStatus, payload.orderStatus);
    assert.equal(typeof a.id, "number");
    assert.equal(Number.isInteger(a.id), true);
    assert.equal(typeof a.balance, "number");
    assert.equal(typeof a.active, "boolean");
    assert.equal(a.email.endsWith("@example.invalid"), true);
    assert.match(a.phone, /^\+\d+$/);
    assert.match(a.uuid, /^[0-9a-f-]{36}$/);
    assert.match(a.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(a.tags.length, payload.tags.length);
    assert.equal(a.profile.empty, null);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, payload);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request supports bearer auth and anonymizes plain text", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("ORDERS_API_TOKEN", "orders-token")];
  const oldFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (_input, init) => { seen = init; return new Response("customer order 123", { status: 200, headers: { "content-type": "text/plain" } }); };
  try {
    const result = await executeApiRequest({ service: "orders", method: "GET", path: "/v1/orders" });
    assert.equal(seen.headers.Authorization, "Bearer orders-token");
    assert.notEqual(result.body, "customer order 123");
    assert.equal(typeof result.body, "string");
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request rejects unknown service and cross-origin paths", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  try {
    await assert.rejects(executeApiRequest({ service: "missing", method: "GET", path: "/data" }), /Unknown or invalid CRM service/);
    await assert.rejects(executeApiRequest({ service: "customers", method: "GET", path: "https://evil.example.test/data" }), /relative and start with/);
    await assert.rejects(executeApiRequest({ service: "customers", method: "GET", path: "//evil.example.test/data" }), /relative and start with/);
  } finally {
    restore.reverse().forEach((fn) => fn());
  }
});

test("large JSON responses return a handle and compact schema instead of the full body", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const payload = { customers: Array.from({ length: 300 }, (_, i) => ({
    id: i + 1,
    email: "customer" + i + "@example.com",
    status: "active",
    profile: { city: "Moscow", phone: "+79991234567", notes: "x".repeat(80) },
  })) };
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.equal(typeof result.responseId, "string");
    assert.equal(result.body, undefined);
    assert.ok(result.schema);
    assert.ok(result.schema.fields.some((field) => field.path === "$.customers[*].email"));
    assert.ok(result.schema.fields.some((field) => field.path === "$.customers[*].profile.city"));
    const matches = findApiResponseFields("customers", result.responseId, "email");
    assert.deepEqual(matches.matches.map((field) => field.path), ["$.customers[*].email"]);
    const extracted = extractApiResponse("customers", result.responseId, ["$.customers[*].id", "$.customers[*].email"], 3);
    assert.equal(extracted.returned, 3);
    assert.equal(extracted.items[0].id, 1);
    assert.match(extracted.items[0].email, /^user-[a-f0-9]{8}@example\.invalid$/);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request can return only selected JSON fields in one call", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const payload = { customers: Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    email: "customer" + i + "@example.com",
    status: "active",
    profile: { city: "Moscow", notes: "x".repeat(100) },
  })) };
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers", select: ["email", "status"], limit: 3 });
    assert.equal(result.body, undefined);
    assert.equal(result.schema, undefined);
    assert.equal(result.responseId, undefined);
    assert.deepEqual(result.selected.requested, ["email", "status"]);
    assert.deepEqual(result.selected.fields.map((field) => field.path), ["$.customers[*].email", "$.customers[*].status"]);
    assert.equal(result.selected.returned, 3);
    assert.deepEqual(Object.keys(result.selected.items[0]).sort(), ["email", "status"]);
    assert.match(result.selected.items[0].email, /^user-[a-f0-9]{8}@example\.invalid$/);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("response handles cannot cross service boundaries", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ customers: [{ id: 1, email: "a@example.com" }] }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.throws(
      () => findApiResponseFields("orders", result.responseId, "email"),
      /Unknown or expired API response handle/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});


test("API schema stays bounded for deep and wide responses", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const deep = { value: "secret@example.com" };
  let cursor = deep;
  for (let i = 0; i < 30; i++) { cursor.next = { value: "secret@example.com" }; cursor = cursor.next; }
  globalThis.fetch = async () => new Response(JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: i, payload: deep })) }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.ok(result.schema);
    assert.ok(result.schema.fields.length <= 512);
    assert.equal(result.schema.fields.some((field) => field.path.split(".").length > 18), false);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API field selection rejects ambiguous field names with candidate paths", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const payload = {
    customers: [{ email: "customer@example.com" }],
    managers: [{ email: "manager@example.com" }],
  };
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(
      executeApiRequest({ service: "customers", method: "GET", path: "/v1/search", select: ["email"], limit: 3 }),
      /Ambiguous JSON field select query: email; candidates: .*\.customers\[\*\]\.email, .*\.managers\[\*\]\.email/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API field selection pairs only fields from the same collection", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const payload = {
    customers: [{ id: 1, email: "customer@example.com" }],
    managers: [{ id: 10, email: "manager@example.com" }],
  };
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(
      executeApiRequest({ service: "customers", method: "GET", path: "/v1/search", select: ["customer id", "manager email"], limit: 3 }),
      /do not share the same collection/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API field selection does not mark a short result as truncated", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const payload = { customers: [{ email: "customer@example.com", status: "active" }] };
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/search", select: ["email", "status"], limit: 10 });
    assert.equal(result.selected.returned, 1);
    assert.equal(result.selected.truncated, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});


test("API request preserves PDF responses as bounded anonymized binary-safe text", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0xfe, 0x00, 0x25]);
  globalThis.fetch = async () => new Response(pdfBytes, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/document/123" });
    assert.equal(result.contentType, "application/pdf");
    assert.equal(result.anonymized, true);
    assert.equal(typeof result.body, "string");
    assert.ok(result.body.length > 0);
    assert.equal(result.responseId, undefined);
    assert.equal(result.schema, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request does not parse arbitrary text beginning with JSON-like characters", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[not valid json", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/raw" });
    assert.equal(result.contentType, "text/plain");
    assert.equal(result.body.includes("[not valid json"), true);
    assert.equal(result.responseId, undefined);
    assert.equal(result.schema, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request returns structured errors without exposing the API secret", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: "authorization failed",
    token: "secret",
    requestId: "req-123",
  }), {
    status: 401,
    statusText: "Unauthorized",
    headers: { "content-type": "application/json" },
  });
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.equal(result.status, 401);
    assert.equal(result.statusText, "Unauthorized");
    assert.equal(result.anonymized, true);
    assert.equal(result.body.includes("secret"), false);
    assert.doesNotMatch(result.body, /authorization failed/);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request handles empty 204 responses without inventing JSON metadata", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 204,
    statusText: "No Content",
  });
  try {
    const result = await executeApiRequest({ service: "customers", method: "DELETE", path: "/v1/customers/123" });
    assert.equal(result.status, 204);
    assert.equal(result.body, "");
    assert.equal(result.responseId, undefined);
    assert.equal(result.schema, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request truncates oversized PDF bodies to the response byte limit", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const oversizedPdf = new Uint8Array(256 * 1024 + 1024);
  oversizedPdf.set([0x25, 0x50, 0x44, 0x46], 0);
  globalThis.fetch = async () => new Response(oversizedPdf, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/document/large.pdf" });
    assert.equal(result.contentType, "application/pdf");
    assert.equal(result.truncated, true);
    assert.equal(result.body, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request refuses redirects instead of following an untrusted location", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (_input, init) => {
    seen = init;
    return new Response(null, { status: 302, headers: { location: "https://evil.example.test/steal" } });
  };
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/redirect" });
    assert.equal(seen.redirect, "error");
    assert.equal(result.status, 302);
    assert.equal(result.body, "");
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});
