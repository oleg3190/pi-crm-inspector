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
