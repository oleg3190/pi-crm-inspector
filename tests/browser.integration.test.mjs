import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import {
  captureAccessibilityElements,
  captureDomSnapshot,
  captureViewportScreenshot,
  hasSensitiveInspectAction,
  runInspectActions,
  shouldCaptureInspectScreenshot,
  waitForDomStability,
} from "../inspector/index.ts";

test("browser inspection handles server HTML and SPA-like delayed DOM updates", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <main>
          <h1>CRM Dashboard 12345</h1>
          <button id="open" aria-label="Open client Иван Иванов">Open client</button>
          <section id="result" hidden>Loading</section>
          <svg id="sales-chart" width="320" height="180" viewBox="0 0 320 180" aria-label="Sales chart">
            <rect x="0" y="0" width="320" height="180"></rect>
          </svg>
          <canvas id="revenue-chart" width="640" height="360" style="width:320px;height:180px"></canvas>
        </main>
        <script>
          document.querySelector("#open").addEventListener("click", () => {
            setTimeout(() => {
              const result = document.querySelector("#result");
              result.hidden = false;
              result.textContent = "Client 12345 loaded";
            }, 200);
          });
        </script>
      </body>
    </html>
  `);

  const signal = new AbortController().signal;
  await waitForDomStability(page, signal);

  const interactions = await runInspectActions(page, [
    {
      type: "click",
      selector: "#open",
      waitFor: { selector: "#result", state: "visible", timeoutMs: 2_000 },
    },
  ], signal);

  assert.equal(interactions.length, 1);
  assert.equal(interactions[0].ok, true);
  assert.equal(interactions[0].waitFor?.state, "visible");

  const snapshot = await captureDomSnapshot(page);
  assert.match(snapshot, /<svg/);
  assert.match(snapshot, /rendered="320x180"/);
  assert.match(snapshot, /<canvas/);
  assert.match(snapshot, /bitmap="640x360"/);
  assert.doesNotMatch(snapshot, /Иван Иванов/);

  const elements = await captureAccessibilityElements(page);
  const button = elements.find((item) => item.kind === "button");
  assert(button);
  assert.equal(button.visible, true);
  assert.equal(button.enabled, true);
  assert.equal(button.name?.includes("ipsum"), true);
  assert.equal(button.name?.includes("Иван"), false);
  assert(elements.length > 0);

  const screenshot = await captureViewportScreenshot(page);
  assert.equal(screenshot.data.length > 0, true);
  assert.equal(screenshot.width, 900);
  assert.equal(screenshot.height, 600);
});


test("browser inspection supports deterministic form actions", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <form id="filters">
          <label for="query">Client search</label>
          <input id="query" placeholder="Search clients" />
          <label for="region">Region</label>
          <select id="region">
            <option value="all">All regions</option>
            <option value="north">North</option>
          </select>
          <label><input id="active" type="checkbox" /> Active only</label>
          <label for="secret">API secret</label>
          <input id="secret" type="password" placeholder="Secret value" />

          <div id="status" role="combobox" aria-label="Status" aria-expanded="false" tabindex="0" style="display:inline-block;width:120px;height:24px"></div>
          <div id="options" style="display:none">
            <div role="option" aria-selected="false">Open</div>
          </div>

          <button data-testid="apply">Apply filters</button>
        </form>
        <section id="filter-result" hidden>Ready</section>
      </body>
      <script>
        const result = document.querySelector("#filter-result");
        document.querySelector("#filters").addEventListener("submit", (event) => event.preventDefault());
        const status = document.querySelector("#status");
        const options = document.querySelector("#options");
        status.addEventListener("click", () => {
          status.setAttribute("aria-expanded", "true");
          options.style.display = "block";
        });
        const option = document.querySelector('[role="option"]');
        option.addEventListener("click", () => {
          option.setAttribute("aria-selected", "true");
          status.setAttribute("aria-activedescendant", "status-open");
        });
        document.querySelector("#query").addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            result.hidden = false;
          }
        });
        document.querySelector("#apply").addEventListener("click", (event) => {
          event.preventDefault();
          result.hidden = false;
        });
        option.id = "status-open";
      </script>
    </html>
  `);

  const signal = new AbortController().signal;
  await waitForDomStability(page, signal);

  const actions = [
    {
      type: "fill",
      target: { by: "label", value: "Client search" },
      value: "North clients",
    },
    {
      type: "select",
      target: { by: "label", value: "Region" },
      option: { value: "north" },
    },
    {
      type: "check",
      target: { by: "label", value: "Active only" },
      checked: true,
    },
    {
      type: "select",
      target: { by: "id", value: "status" },
      option: { label: "Open" },
    },
    {
      type: "fill",
      target: { by: "placeholder", value: "Secret value" },
      value: "super-secret-token",
      sensitive: true,
    },
    {
      type: "press",
      target: { by: "role", role: "textbox", name: "Client search" },
      key: "Enter",
      waitFor: { selector: "#filter-result", state: "visible", timeoutMs: 2_000 },
    },
    {
      type: "click",
      target: { by: "testId", value: "apply" },
      waitFor: { selector: "#filter-result", state: "visible", timeoutMs: 2_000 },
    },
  ];

  const results = await runInspectActions(page, actions, signal);
  assert.equal(results.length, 7);
  assert(results.every((result) => result.ok), JSON.stringify(results));
  assert.equal(results[0].valueLength, "North clients".length);
  assert.equal(results[1].changed, true);
  assert.equal(results[2].checked, true);
  assert.equal(results[3].changed, true);
  assert.equal(results[4].valueLength, "super-secret-token".length);
  assert.equal(JSON.stringify(results).includes("super-secret-token"), false);
  assert.equal(results[5].key, "Enter");
  assert.equal(hasSensitiveInspectAction(actions), true);
  assert.equal(shouldCaptureInspectScreenshot(actions, true), false);
  assert.equal(shouldCaptureInspectScreenshot(actions.slice(0, 4), true), true);
});
