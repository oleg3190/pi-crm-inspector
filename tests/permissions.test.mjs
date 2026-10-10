import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeInspectorPermissions } from "../dispatcher/permissions.ts";

const validConfig = {
  databaseName: "crm_test",
  role: "crm_test_user",
  query: "GRANT SELECT ON TABLE public.customers TO crm_test_user;",
};

function fakeClient({ database = "crm_test", onQuery = () => {} } = {}) {
  const executed = [];
  const client = async () => [{ database }];
  client.unsafe = async (query) => {
    executed.push(query);
    onQuery(query);
    return [];
  };
  client.end = async () => {};
  return { client, executed };
}

async function withConfig(config, run) {
  const directory = await mkdtemp(join(tmpdir(), "pi-crm-permissions-"));
  const path = join(directory, "permissions.json");
  await writeFile(path, JSON.stringify(config), "utf8");
  try {
    await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const enabledEnv = {
  PI_CRM_INSPECTOR_PERMISSIONS_ENABLED: "1",
  PI_CRM_INSPECTOR_TEST_DATABASE_URL: "postgresql://test-user:never-return-this@localhost/crm_test",
};

test("permission setup is disabled unless explicitly enabled", async () => {
  let connected = false;
  const result = await executeInspectorPermissions({
    env: { PI_CRM_INSPECTOR_TEST_DATABASE_URL: enabledEnv.PI_CRM_INSPECTOR_TEST_DATABASE_URL },
    configPath: "/not-read-when-disabled.json",
    createClient: () => { connected = true; throw new Error("must not connect"); },
  });
  assert.equal(result.status, "error");
  assert.equal(result.code, "disabled");
  assert.equal(connected, false);
});

test("executes only the configured GRANT on the expected database and returns no SQL/data", async () => {
  await withConfig(validConfig, async (configPath) => {
    const { client, executed } = fakeClient();
    let connectionStringSeen;
    const result = await executeInspectorPermissions({
      env: { ...enabledEnv },
      configPath,
      createClient: (connectionString) => {
        connectionStringSeen = connectionString;
        return client;
      },
    });

    assert.deepEqual(result, { status: "success", operation: "grant", anonymized: true });
    assert.equal(connectionStringSeen, enabledEnv.PI_CRM_INSPECTOR_TEST_DATABASE_URL);
    assert.deepEqual(executed, ["GRANT SELECT ON TABLE public.customers TO crm_test_user"]);
    assert.equal(JSON.stringify(result).includes("never-return-this"), false);
    assert.equal(JSON.stringify(result).includes("customers"), false);
  });
});

test("database mismatch blocks the GRANT", async () => {
  await withConfig(validConfig, async (configPath) => {
    const { client, executed } = fakeClient({ database: "crm_prod" });
    const result = await executeInspectorPermissions({
      env: { ...enabledEnv },
      configPath,
      createClient: () => client,
    });
    assert.equal(result.status, "error");
    assert.equal(result.code, "database_mismatch");
    assert.deepEqual(executed, []);
  });
});

test("rejects SQL which targets a different role or contains a second statement", async () => {
  await withConfig({ ...validConfig, query: "GRANT SELECT ON TABLE public.customers TO other_user;" }, async (configPath) => {
    const result = await executeInspectorPermissions({ env: { ...enabledEnv }, configPath, createClient: () => { throw new Error("must not connect"); } });
    assert.equal(result.code, "configuration_error");
  });

  await withConfig({ ...validConfig, query: "GRANT SELECT ON TABLE public.customers TO crm_test_user; DROP TABLE public.customers;" }, async (configPath) => {
    const result = await executeInspectorPermissions({ env: { ...enabledEnv }, configPath, createClient: () => { throw new Error("must not connect"); } });
    assert.equal(result.code, "configuration_error");
  });
});

test("rejects non-GRANT SQL and grants to another database", async () => {
  for (const query of [
    "SELECT 1",
    "GRANT SELECT ON DATABASE crm_prod TO crm_test_user",
    'GRANT CONNECT ON DATABASE "crm_prod" TO crm_test_user',
    "GRANT SELECT ON TABLE public.customers TO crm_test_user WITH GRANT OPTION",
  ]) {
    await withConfig({ ...validConfig, query }, async (configPath) => {
      const result = await executeInspectorPermissions({ env: { ...enabledEnv }, configPath, createClient: () => { throw new Error("must not connect"); } });
      assert.equal(result.code, "configuration_error", query);
    });
  }
});

test("suppresses PostgreSQL error details", async () => {
  await withConfig(validConfig, async (configPath) => {
    const result = await executeInspectorPermissions({
      env: { ...enabledEnv },
      configPath,
      createClient: () => {
        const client = async () => [{ database: "crm_test" }];
        client.unsafe = async () => { throw new Error("secret-db-host customer-name private-sql"); };
        client.end = async () => {};
        return client;
      },
    });
    assert.equal(result.code, "execution_failed");
    assert.doesNotMatch(JSON.stringify(result), /secret-db-host|customer-name|private-sql/);
  });
});
