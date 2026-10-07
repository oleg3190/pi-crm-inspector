import assert from "node:assert/strict";
import { test } from "node:test";
import { executeApiRequest } from "../dispatcher/api.ts";

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
    assert.match(result.url, /^https:\/\/customers\.example\.test\/[A-Za-z0-9]+$/);
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

test("API response keeps object schema while anonymizing every JSON value", async () => {
  const restore = [setEnv("PI_CRM_API_SERVICES_JSON", registry), setEnv("CUSTOMERS_API_KEY", "secret")];
  const oldFetch = globalThis.fetch;
  const payload = {
    id: 12345,
    name: "Ivan Petrov",
    email: "ivan@example.com",
    phone: "+79991234567",
    active: true,
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
