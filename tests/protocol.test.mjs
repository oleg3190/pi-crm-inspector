import assert from "node:assert/strict";
import { test } from "node:test";
import { isInspectAction, isInspectAssertion, isInspectTarget } from "../shared/protocol.ts";

test("inspect action protocol accepts structured targets and bounded actions", () => {
  assert.equal(isInspectTarget({ by: "css", value: "#search" }), true);
  assert.equal(isInspectTarget({ by: "role", role: "combobox", name: "Region" }), true);
  assert.equal(isInspectTarget({ by: "label", value: "Client search" }), true);
  assert.equal(isInspectTarget({ by: "testId", value: "apply" }), true);

  assert.equal(isInspectAction({
    type: "fill",
    target: { by: "label", value: "Client search" },
    value: "North",
  }), true);

  assert.equal(isInspectAction({
    type: "select",
    target: { by: "role", role: "combobox" },
    option: { label: "Open" },
  }), true);

  assert.equal(isInspectAction({
    type: "check",
    target: { by: "label", value: "Active only" },
    checked: true,
  }), true);

  assert.equal(isInspectAction({
    type: "press",
    target: { by: "placeholder", value: "Search clients" },
    key: "Enter",
  }), true);

  assert.equal(isInspectAction({
    type: "click",
    selector: "#legacy",
  }), true);

  assert.equal(isInspectAction({
    type: "press",
    target: { by: "css", value: "#search" },
    key: "Control+L",
  }), false);

  assert.equal(isInspectAction({
    type: "fill",
    target: { by: "label", value: "Client search" },
    value: "x".repeat(4097),
  }), false);

  assert.equal(isInspectAction({
    type: "select",
    target: { by: "label", value: "Region" },
    option: {},
  }), false);

  assert.equal(isInspectTarget({ by: "unknown", value: "x" }), false);
});


test("inspect assertion protocol accepts bounded pagination assertions and rejects unsafe/unbounded values", () => {
  const target = { by: "role", role: "button", name: "Next" };

  assert.equal(isInspectAssertion({
    type: "expectText",
    target: { by: "css", value: "#page" },
    text: "Page 2",
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectVisible",
    target,
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectCount",
    target: { by: "css", value: "tbody tr" },
    count: 25,
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectAttribute",
    target,
    name: "aria-disabled",
    value: "true",
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectUrl",
    value: "/clients?page=2",
    mode: "contains",
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectElementState",
    target,
    state: "disabled",
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectCount",
    target: { by: "css", value: "tbody tr" },
    count: 101,
  }), false);

  assert.equal(isInspectAssertion({
    type: "expectAttribute",
    target,
    name: "bad attribute",
    value: "alert(1)",
  }), false);

  assert.equal(isInspectAssertion({
    type: "expectUrl",
    value: "javascript:alert(1)",
    mode: "contains",
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectElementState",
    target,
    state: "unknown",
  }), false);

  assert.equal(isInspectAssertion({
    type: "expectText",
    target: { by: "css", value: "#page" },
    text: "x".repeat(4097),
  }), false);
});


test("extended protocol accepts wait, scoped matching, local assertions, and layout assertions", () => {
  assert.equal(isInspectTarget({
    by: "text",
    value: "4",
    match: "exact",
    scope: { by: "css", value: "[data-calendar='main']" },
  }), true);

  assert.equal(isInspectTarget({
    by: "text",
    value: "4",
    scope: { by: "text", value: "Calendar" },
  }), true);

  assert.equal(isInspectTarget({
    by: "css",
    value: "#x",
    match: "contains",
  }), false);

  assert.equal(isInspectAction({ type: "wait", durationMs: 35_000 }), true);
  assert.equal(isInspectAction({ type: "wait", durationMs: 60_001 }), false);
  assert.equal(isInspectAction({
    type: "wait",
    durationMs: 1_000,
    assertions: [{ type: "expectVisible", target: { by: "id", value: "ready" } }],
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectStyle",
    target: { by: "id", value: "calendar" },
    property: "width",
    value: "100%",
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectGeometry",
    target: { by: "id", value: "calendar" },
    width: { min: 900 },
    height: { min: 400 },
    visible: true,
  }), true);

  assert.equal(isInspectAssertion({
    type: "expectGeometry",
    target: { by: "id", value: "calendar" },
    width: { exact: -1 },
  }), false);
});


test("inspect result protocol accepts compact diagnostics summary and failed network metadata", async () => {
  const { isInspectResult } = await import("../shared/protocol.ts");
  const result = {
    status: "success", traceId: "trace", pageId: "dashboard", durationMs: 10,
    pageText: "", domSnapshot: "", interactions: [], assertions: [], assertionsPassed: true, elements: [],
    console: [], pageErrors: [], requestFailures: [],
    networkRequests: [{ id: "req", timestamp: new Date().toISOString(), method: "GET", url: "https://crm.example.test/api/fail", status: 500, failed: true, error: "server error" }],
    securityEvents: [], diagnosticsSummary: { actionCount: 0, actionsPassed: 0, assertionCount: 0, assertionsPassed: 0, failedAssertions: 0, networkRequests: 1, failedNetworkRequests: 1, consoleErrors: 0, pageErrors: 0, checkpoints: 0 },
    droppedEvents: 0,
  };
  assert.equal(isInspectResult(result), true);
});


test("inspect result accepts visual layout diagnostics on elements", async () => {
  const { isInspectResult } = await import("../shared/protocol.ts");
  const result = {
    status: "success", traceId: "trace", pageId: "dashboard", durationMs: 10,
    pageText: "", domSnapshot: "", interactions: [], assertions: [], assertionsPassed: true,
    elements: [{
      kind: "button",
      selector: "button:nth-of-type(1)",
      name: "ipsum",
      visible: true,
      geometry: {
        x: 100, y: 200, width: 120, height: 40, visible: true,
        zIndex: "1000",
        position: "fixed",
        occluded: true,
        occludedBy: ["div:nth-of-type(2)"],
      },
    }],
    console: [], pageErrors: [], requestFailures: [], networkRequests: [],
    checkpoints: [], securityEvents: [],
    diagnosticsSummary: { actionCount: 0, actionsPassed: 0, assertionCount: 0, assertionsPassed: 0, failedAssertions: 0, networkRequests: 0, failedNetworkRequests: 0, consoleErrors: 0, pageErrors: 0, checkpoints: 0 },
    droppedEvents: 0,
  };
  assert.equal(isInspectResult(result), true);
});
