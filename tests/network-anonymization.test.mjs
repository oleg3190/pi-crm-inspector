import assert from "node:assert/strict";
import { test } from "node:test";
import { anonymizeNetworkDiagnosticBody } from "../inspector/diagnostics.ts";

test("network diagnostic JSON anonymization preserves shape, booleans, nulls, and identifier fields", () => {
  const source = JSON.stringify({
    userName: "Иван Петров 123",
    userId: "real-user-id-123",
    document_id: 987654,
    idNumber: "AB-12345",
    active: true,
    deleted: false,
    missing: null,
    total: 12345,
    ratio: 12.34,
    rows: [{ clientName: "ООО Ромашка", client_id: "client-9988", enabled: false }],
  });

  const result = JSON.parse(anonymizeNetworkDiagnosticBody(source, "application/json"));

  assert.equal(result.userName, "xxxx xxxxx 777");
  assert.equal(result.userId, "real-user-id-123");
  assert.equal(result.document_id, 987654);
  assert.equal(result.idNumber, "AB-12345");
  assert.equal(result.active, true);
  assert.equal(result.deleted, false);
  assert.equal(result.missing, null);
  assert.equal(result.total, 77777);
  assert.equal(result.ratio, 77.77);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].clientName, "xxx xxxxxxxxx");
  assert.equal(result.rows[0].client_id, "client-9988");
  assert.equal(result.rows[0].enabled, false);
});

test("network diagnostic anonymization scrubs secrets and keeps digit count in plain text", () => {
  const result = anonymizeNetworkDiagnosticBody('Authorization: Bearer abc.def.123; customer 12345');
  assert.match(result, /Bearer \[REDACTED\]/);
  assert.match(result, /customer 77777/);
  assert.doesNotMatch(result, /abc\.def\.123/);
});

test("network diagnostic JSON preserves all keys and array lengths", () => {
  const source = JSON.stringify({ list: [{ name: "Alice", ok: true }, { name: "Bob", ok: false }], meta: { page_id: "page-123" } });
  const result = JSON.parse(anonymizeNetworkDiagnosticBody(source, "application/json"));
  assert.deepEqual(Object.keys(result), ["list", "meta"]);
  assert.equal(result.list.length, 2);
  assert.deepEqual(result.list.map((item) => item.ok), [true, false]);
  assert.equal(result.meta.page_id, "page-123");
});
