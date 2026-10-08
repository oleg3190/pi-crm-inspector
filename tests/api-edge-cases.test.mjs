import assert from "node:assert/strict";
import { test } from "node:test";
import { executeApiRequest } from "../dispatcher/api.ts";

const registry = JSON.stringify({
  customers: {
    baseUrl: "https://customers.example.test",
    auth: { type: "apiKey", header: "X-API-Key", secretRef: "CUSTOMERS_API_KEY" },
  },
});

function setEnv(name, value) {
  const old = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (old === undefined) delete process.env[name];
    else process.env[name] = old;
  };
}

function withApiFetch(handler) {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = oldFetch; };
}

function setup() {
  return [
    setEnv("PI_CRM_API_SERVICES_JSON", registry),
    setEnv("CUSTOMERS_API_KEY", "secret"),
  ];
}

test("API request preserves CSV responses as bounded text without JSON metadata", async () => {
  const restore = setup();
  const restoreFetch = withApiFetch(async () => new Response(
    "id,email,status\n1,customer@example.com,active\n",
    { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } },
  ));
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/export.csv" });
    assert.equal(result.contentType, "text/csv; charset=utf-8");
    assert.equal(result.responseId, undefined);
    assert.equal(result.schema, undefined);
    assert.equal(typeof result.body, "string");
    assert.match(result.body, /,/);
    assert.doesNotMatch(result.body, /customer@example.com/);
  } finally {
    restoreFetch();
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request preserves XML responses without treating them as JSON", async () => {
  const restore = setup();
  const restoreFetch = withApiFetch(async () => new Response(
    "<customer><id>123</id><email>customer@example.com</email></customer>",
    { status: 200, headers: { "content-type": "application/xml; charset=utf-8" } },
  ));
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customer/123.xml" });
    assert.equal(result.contentType, "application/xml; charset=utf-8");
    assert.equal(result.responseId, undefined);
    assert.equal(result.schema, undefined);
    assert.equal(typeof result.body, "string");
    assert.match(result.body, /<customer>/);
    assert.doesNotMatch(result.body, /customer@example.com/);
  } finally {
    restoreFetch();
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request handles a top-level JSON array and exposes its schema", async () => {
  const restore = setup();
  const restoreFetch = withApiFetch(async () => new Response(
    JSON.stringify([{ id: 1, email: "a@example.com" }, { id: 2, email: "b@example.com" }]),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.equal(result.schema.type, "array");
    assert.ok(result.schema.fields.some((field) => field.path === "$[*].email"));
    assert.ok(result.schema.fields.some((field) => field.path === "$[*].id"));
  } finally {
    restoreFetch();
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request keeps JSON error bodies inspectable for 4xx and 5xx responses", async () => {
  const restore = setup();
  let call = 0;
  const restoreFetch = withApiFetch(async () => {
    call += 1;
    return new Response(
      JSON.stringify({ error: "upstream failure", requestId: "req-123", status: call === 1 ? 429 : 500 }),
      {
        status: call === 1 ? 429 : 500,
        statusText: call === 1 ? "Too Many Requests" : "Internal Server Error",
        headers: { "content-type": "application/problem+json" },
      },
    );
  });
  try {
    const rateLimited = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.statusText, "Too Many Requests");
    assert.equal(rateLimited.schema.type, "object");
    assert.match(rateLimited.body, /upstream failure/);

    const failed = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.equal(failed.status, 500);
    assert.equal(failed.statusText, "Internal Server Error");
    assert.match(failed.body, /upstream failure/);
  } finally {
    restoreFetch();
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request does not expose a secret in a response URL or body", async () => {
  const restore = setup();
  const restoreFetch = withApiFetch(async () => new Response(
    JSON.stringify({
      next: "https://customers.example.test/v1/customers?api_key=secret",
      message: "secret",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/customers" });
    assert.doesNotMatch(result.url, /secret/);
    assert.doesNotMatch(result.body, /secret/);
  } finally {
    restoreFetch();
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request supports API key prefixes", async () => {
  const prefixedRegistry = JSON.stringify({
    customers: {
      baseUrl: "https://customers.example.test",
      auth: {
        type: "apiKey",
        header: "X-API-Key",
        prefix: "Token ",
        secretRef: "CUSTOMERS_API_KEY",
      },
    },
  });
  const restore = [
    setEnv("PI_CRM_API_SERVICES_JSON", prefixedRegistry),
    setEnv("CUSTOMERS_API_KEY", "secret"),
  ];
  const oldFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (_input, init) => {
    seen = init;
    return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
  };
  try {
    await executeApiRequest({ service: "customers", method: "GET", path: "/v1/health" });
    assert.equal(seen.headers["X-API-Key"], "Token secret");
  } finally {
    globalThis.fetch = oldFetch;
    restore.reverse().forEach((fn) => fn());
  }
});

test("API request returns an empty body for an empty 200 response", async () => {
  const restore = setup();
  const restoreFetch = withApiFetch(async () => new Response("", {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  try {
    const result = await executeApiRequest({ service: "customers", method: "GET", path: "/v1/empty" });
    assert.equal(result.status, 200);
    assert.equal(result.body, "");
    assert.equal(result.responseId, undefined);
    assert.equal(result.schema, undefined);
  } finally {
    restoreFetch();
    restore.reverse().forEach((fn) => fn());
  }
});
