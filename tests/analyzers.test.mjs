import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { buildPageDataAnalysis, captureVisibleTableSummary, summarizeApiPayload } from "../inspector/analyzers/api.ts";
import { analyzeVuePage } from "../inspector/analyzers/vue.ts";

test("API analyzer reports JSON structure without response values", () => {
  const source = {
    data: [
      { id: 101, email: "private.person@example.com", status: "active" },
      { id: 102, email: "another.private@example.com", status: "inactive" },
    ],
    paging: { total: 2, next: null },
    ok: true,
  };
  const result = summarizeApiPayload(Buffer.from(JSON.stringify(source)), "application/json; charset=utf-8");

  assert.equal(result.status, "analyzed");
  assert.equal(result.rootType, "object");
  assert.deepEqual(result.topLevelKeys, ["data", "paging", "ok"]);
  assert.ok(result.fieldPaths.includes("$.paging.total"));
  assert.ok(result.collections.some((item) => item.path === "$.data" && item.itemCount === 2));
  assert.equal(result.collections[0].objectItemsSampled, 2);
  assert.doesNotMatch(JSON.stringify(result), /private\.person|another\.private|active|inactive|101|102/);
});

test("API analyzer bounds oversized JSON and distinguishes non-JSON and invalid JSON", () => {
  const oversized = Buffer.from(JSON.stringify({ payload: "x".repeat(300 * 1024) }));
  assert.equal(summarizeApiPayload(oversized, "application/json").status, "truncated");
  assert.equal(summarizeApiPayload(Buffer.from("<html>ok</html>"), "text/html").status, "not_json");
  assert.equal(summarizeApiPayload(Buffer.from("{not-json"), "application/json").status, "invalid_json");
});

test("page data analysis reports JSON collections and rendered table counts without claiming correctness", () => {
  const result = buildPageDataAnalysis([
    {
      id: "request-1",
      timestamp: "2026-10-12T00:00:00.000Z",
      method: "GET",
      url: "https://example.invalid/api/customers",
      status: 200,
      apiDataSummary: {
        status: "analyzed",
        byteLength: 120,
        rootType: "object",
        topLevelKeys: ["items"],
        fieldPaths: ["$.items", "$.items[*].id"],
        collections: [{ path: "$.items", itemCount: 2, objectItemsSampled: 2, sampleSize: 2 }],
      },
    },
  ], [{ index: 0, kind: "table", rowCount: 2, columnCount: 3 }]);

  assert.equal(result.jsonResponses, 1);
  assert.equal(result.analyzedResponses, 1);
  assert.deepEqual(result.collections.map((item) => [item.path, item.itemCount]), [["$.items", 2]]);
  assert.deepEqual(result.visibleTables, [{ index: 0, kind: "table", rowCount: 2, columnCount: 3 }]);
  assert.match(result.note, /pagination, filtering/i);
});

test("Vue analyzer detects component metadata when a Vue 3 mount tree is exposed", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="app"></div>');
    await page.evaluate(() => {
      const root = document.querySelector("#app");
      root.__vue_app__ = {
        version: "3.5.2",
        _instance: {
          type: { name: "RootApp" },
          subTree: {
            component: {
              type: { name: "CustomerPage" },
              subTree: {
                children: [
                  { component: { type: { __name: "CustomerTable" } } },
                ],
              },
            },
          },
        },
      };
    });
    const result = await analyzeVuePage(page);
    assert.equal(result.framework, "vue");
    assert.equal(result.status, "analyzed");
    assert.equal(result.version, "3.5.2");
    assert.ok(result.componentNames.includes("RootApp"));
    assert.ok(result.componentNames.includes("CustomerPage"));
    assert.ok(result.componentNames.includes("CustomerTable"));
    assert.equal(JSON.stringify(result).includes("props"), false);
  } finally {
    await browser.close();
  }
});

test("Vue analyzer gracefully falls back on pages without Vue and identifies React without Vue introspection", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main>Plain HTML</main>');
    const plain = await analyzeVuePage(page);
    assert.equal(plain.framework, "unknown");
    assert.equal(plain.status, "not_detected");

    await page.evaluate(() => {
      const root = document.querySelector("main");
      root["__reactFiber$test"] = {};
    });
    const react = await analyzeVuePage(page);
    assert.equal(react.framework, "react");
    assert.equal(react.status, "not_applicable");
    assert.deepEqual(react.componentNames, undefined);
  } finally {
    await browser.close();
  }
});

test("visible table analyzer returns only dimensions and never cell contents", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table>
        <thead><tr><th>Private header</th><th>Secret header</th></tr></thead>
        <tbody><tr><td>Private customer</td><td>person@example.com</td></tr><tr><td>Another customer</td><td>other@example.com</td></tr></tbody>
      </table>
    `);
    const result = await captureVisibleTableSummary(page);
    assert.deepEqual(result, [{ index: 0, kind: "table", rowCount: 2, columnCount: 2 }]);
    assert.equal(JSON.stringify(result).includes("person@example.com"), false);
  } finally {
    await browser.close();
  }
});
