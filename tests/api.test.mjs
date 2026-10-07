import assert from "node:assert/strict";
import { test } from "node:test";
import { executeApiRequest } from "../dispatcher/api.ts";

const registry = JSON.stringify({
  customers: { baseUrl: "https://customers.example.test", auth: { type: "apiKey", header: "X-API-Key", secretRef: "CUSTOMERS_API_KEY" } },
  orders: { baseUrl: "https://orders.example.test", auth: { type: "bearer", secretRef: "ORDERS_API_TOKEN" } },
});

test("API request selects a service and injects its secret at runtime", async () => {
  const old = { registry: process.env.PI_CRM_API_SERVICES_JSON, key: process.env.CUSTOMERS_API_KEY, fetch: globalThis.fetch };
  process.env.PI_CRM_API_SERVICES_JSON = registry;
  process.env.CUSTOMERS_API_KEY = "customers-secret";
  let seen: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    seen = init;
    return new Response(JSON.stringify({ echoed: "customers-secret" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.equal(result.url, "https://customers.example.test/v1/customers");
    assert.doesNotMatch(result.body, /customers-secret/);
    assert.match(result.body, /REDACTED/);
    assert.equal((seen?.headers as Record<string, string>)["X-API-Key"], "customers-secret");
  } finally {
    globalThis.fetch = old.fetch;
    if (old.registry === undefined) delete process.env.PI_CRM_API_SERVICES_JSON; else process.env.PI_CRM_API_SERVICES_JSON = old.registry;
    if (old.key === undefined) delete process.env.CUSTOMERS_API_KEY; else process.env.CUSTOMERS_API_KEY = old.key;
  }
});

test("API request supports bearer auth for another service", async () => {
  const old = { registry: process.env.PI_CRM_API_SERVICES_JSON, token: process.env.ORDERS_API_TOKEN, fetch: globalThis.fetch };
  process.env.PI_CRM_API_SERVICES_JSON = registry;
  process.env.ORDERS_API_TOKEN = "orders-token";
  let seen: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => { seen = init; return new Response("ok", { status: 200 }); };
  try {
    await executeApiRequest({ service: "orders", method: "GET", path: "/v1/orders" });
    assert.equal((seen?.headers as Record<string, string>).Authorization, "Bearer orders-token");
  } finally {
    globalThis.fetch = old.fetch;
    if (old.registry === undefined) delete process.env.PI_CRM_API_SERVICES_JSON; else process.env.PI_CRM_API_SERVICES_JSON = old.registry;
    if (old.token === undefined) delete process.env.ORDERS_API_TOKEN; else process.env.ORDERS_API_TOKEN = old.token;
  }
});

test("API request rejects unknown service and cross-origin paths", async () => {
  const oldRegistry = process.env.PI_CRM_API_SERVICES_JSON;
  const oldKey = process.env.CUSTOMERS_API_KEY;
  process.env.PI_CRM_API_SERVICES_JSON = registry;
  process.env.CUSTOMERS_API_KEY = "secret";
  try {
    await assert.rejects(executeApiRequest({ service: "missing", method: "GET", path: "/data" }), /Unknown or invalid CRM service/);
    await assert.rejects(executeApiRequest({ service: "customers", method: "GET", path: "https://evil.example.test/data" }), /relative and start with/);
    await assert.rejects(executeApiRequest({ service: "customers", method: "GET", path: "//evil.example.test/data" }), /relative and start with/);
  } finally {
    if (oldRegistry === undefined) delete process.env.PI_CRM_API_SERVICES_JSON; else process.env.PI_CRM_API_SERVICES_JSON = oldRegistry;
    if (oldKey === undefined) delete process.env.CUSTOMERS_API_KEY; else process.env.CUSTOMERS_API_KEY = oldKey;
  }
});
