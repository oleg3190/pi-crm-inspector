import assert from "node:assert/strict";
import { test } from "node:test";
import { anonymizeNetworkDiagnosticBody, NetworkRecorder } from "../inspector/diagnostics.ts";

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

  assert.equal(result.userName, "xxxx xxxxxx 777");
  assert.equal(result.userId, "real-user-id-123");
  assert.equal(result.document_id, 987654);
  assert.equal(result.idNumber, "AB-12345");
  assert.equal(result.active, true);
  assert.equal(result.deleted, false);
  assert.equal(result.missing, null);
  assert.equal(result.total, 77777);
  assert.equal(result.ratio, 77.77);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].clientName, "xxx xxxxxxx");
  assert.equal(result.rows[0].client_id, "client-9988");
  assert.equal(result.rows[0].enabled, false);
});

test("network diagnostic anonymization scrubs secrets and keeps digit count in plain text", () => {
  const result = anonymizeNetworkDiagnosticBody('Authorization: Bearer abc.def.123; customer 12345');
  assert.match(result, /\[REDACTED\]/);
  assert.match(result, /77777/);
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


test("network diagnostic anonymization handles malformed JSON as text without leaking letters or digits", () => {
  const malformed = '{"customerName":"Alice Smith","count":12345';
  const result = anonymizeNetworkDiagnosticBody(malformed, "application/json");
  assert.equal(result, '{"xxxxxxxxxxxx":"xxxxx xxxxx","xxxxx":77777');
  assert.doesNotMatch(result, /Alice|Smith|12345/);
});

test("identifier-like keys are preserved without protecting unrelated names", () => {
  const source = JSON.stringify({
    id: "crm-123",
    ids: ["id-123"],
    userID: "U-123",
    documentId: "D-123",
    id_number: "N-123",
    idNumber: "AB-123",
    valid: "should be anonymized",
    candidate: "should also be anonymized",
  });
  const result = JSON.parse(anonymizeNetworkDiagnosticBody(source, "application/json"));
  assert.equal(result.id, "crm-123");
  assert.deepEqual(result.ids, ["id-123"]);
  assert.equal(result.userID, "U-123");
  assert.equal(result.documentId, "D-123");
  assert.equal(result.id_number, "N-123");
  assert.equal(result.idNumber, "AB-123");
  assert.equal(result.valid, "xxxxx xx xxxxxxxxxx");
  assert.equal(result.candidate, "xxxxxxxxx xx xxxxxxxxxx");
});

test("numeric anonymization preserves negative signs, decimals, exponent notation, and number types", () => {
  const source = '{"negative":-123,"decimal":-12.34,"scientific":1.23e+45,"zero":0}';
  const result = JSON.parse(anonymizeNetworkDiagnosticBody(source, "application/json"));
  assert.equal(result.negative, -777);
  assert.equal(result.decimal, -77.77);
  assert.equal(result.scientific, 7.77e+45);
  assert.equal(result.zero, 7);
  assert.equal(typeof result.negative, "number");
});

test("sensitive JSON fields are redacted, including nested values", () => {
  const source = JSON.stringify({
    access_token: "secret-access-token",
    profile: { password: "super-secret", name: "Alice" },
  });
  const result = JSON.parse(anonymizeNetworkDiagnosticBody(source, "application/json"));
  assert.equal(result.access_token, "[REDACTED]");
  assert.equal(result.profile.password, "[REDACTED]");
  assert.equal(result.profile.name, "xxxxx");
  assert.doesNotMatch(JSON.stringify(result), /secret-access-token|super-secret|Alice/);
});

test("NetworkRecorder anonymizes only diagnostic copies and marks oversized response bodies truncated", async () => {
  const originalRequestBody = JSON.stringify({ customerName: "Alice Smith", customerId: "cust-123" });
  const originalResponseBody = JSON.stringify({ displayName: "Bob Jones", enabled: true, details: "A".repeat(1_500) });
  const request = {
    method: () => "POST",
    url: () => "https://crm.example.test/api/customers",
    resourceType: () => "xhr",
    postData: () => originalRequestBody,
    headers: () => ({ "content-type": "application/json" }),
  };
  const response = {
    request: () => request,
    status: () => 200,
    statusText: () => "OK",
    headers: () => ({ "content-type": "application/json" }),
    body: async () => Buffer.from(originalResponseBody, "utf8"),
  };

  const recorder = new NetworkRecorder();
  recorder.onRequest(request);
  recorder.onResponse(response);
  await recorder.flush();

  const [entry] = recorder.entriesSnapshot;
  assert.ok(entry);
  assert.notEqual(entry.requestBody, originalRequestBody);
  assert.match(entry.requestBody, /xxxx xxxxx/);
  assert.equal(entry.responseBodyTruncated, true);
  assert.equal(entry.responseBody.length, 1_024);
  assert.ok(entry.responseBody.endsWith("[truncated]"));
  assert.match(originalRequestBody, /Alice Smith/);
  assert.match(originalResponseBody, /Bob Jones/);
  assert.equal(request.postData(), originalRequestBody);
  assert.equal((await response.body()).toString("utf8"), originalResponseBody);
});
