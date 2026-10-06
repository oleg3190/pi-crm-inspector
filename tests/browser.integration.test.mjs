import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import {
  captureAccessibilityElements,
  captureDomSnapshot,
  captureViewportScreenshot,
  sanitizePageForScreenshot,
  hasSensitiveInspectAction,
  runInspectActions,
  runInspectAssertions,
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


test("browser inspection can verify pagination state after moving to the next page", async (t) => {
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
          <div id="page" data-page="1">Page 1</div>
          <table>
            <tbody id="rows">
              <tr><td>Client 1</td></tr>
              <tr><td>Client 2</td></tr>
              <tr><td>Client 3</td></tr>
            </tbody>
          </table>
          <button id="previous" disabled aria-label="Previous">Previous</button>
          <button id="next" aria-label="Next">Next</button>
        </main>
        <script>
          const pageLabel = document.querySelector("#page");
          const rows = document.querySelector("#rows");
          const previous = document.querySelector("#previous");
          const next = document.querySelector("#next");

          next.addEventListener("click", () => {
            setTimeout(() => {
              pageLabel.dataset.page = "2";
              pageLabel.textContent = "Page 2";
              rows.innerHTML = "<tr><td>Client 4</td></tr><tr><td>Client 5</td></tr>";
              previous.disabled = false;
              next.disabled = true;
              next.setAttribute("aria-disabled", "true");
              window.location.hash = "page=2";
            }, 120);
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
      target: { by: "role", role: "button", name: "Next" },
      waitFor: { selector: '[data-page="2"]', state: "visible", timeoutMs: 2_000 },
    },
  ], signal);

  assert.equal(interactions.length, 1);
  assert.equal(interactions[0].ok, true);

  const assertions = await runInspectAssertions(page, [
    {
      type: "expectText",
      target: { by: "id", value: "page" },
      text: "Page 2",
    },
    {
      type: "expectVisible",
      target: { by: "role", role: "button", name: "Previous" },
    },
    {
      type: "expectCount",
      target: { by: "css", value: "#rows tr" },
      count: 2,
    },
    {
      type: "expectAttribute",
      target: { by: "role", role: "button", name: "Next" },
      name: "aria-disabled",
      value: "true",
    },
    {
      type: "expectUrl",
      value: "#page=2",
      mode: "contains",
    },
    {
      type: "expectElementState",
      target: { by: "role", role: "button", name: "Next" },
      state: "disabled",
    },
  ], signal);

  assert.equal(assertions.length, 6);
  assert(assertions.every((assertion) => assertion.ok), JSON.stringify(assertions));
  assert.equal(assertions[2].actualCount, 2);
  assert.equal(assertions[3].attributePresent, true);
  assert.equal(assertions[5].state, "disabled");

  const failed = await runInspectAssertions(page, [{
    type: "expectText",
    target: { by: "id", value: "page" },
    text: "Page 99",
  }], signal);
  assert.equal(failed[0].ok, false);
  assert.equal(failed[0].error, "Text assertion failed");
});


test("screenshot sanitization removes textual and visual CRM PII before pixels are captured", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          #pseudo::before { content: "Real customer name"; }
          #background { width: 40px; height: 40px; background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><text x='0' y='15'>PII</text></svg>"); }
        </style>
      </head>
      <body>
        <main>
          <h1>Иван Иванов 12345</h1>
          <button id="customer" aria-label="Open Иван Иванов">Иван Иванов</button>
          <input id="customer-input" value="Иван Иванов 12345" placeholder="Телефон +372 555-1234">
          <img id="avatar" alt="Иван Иванов" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><text x='0' y='15'>Иван</text></svg>">
          <canvas id="chart" width="100" height="50"></canvas>
          <svg id="svg"><text>Иван Иванов</text></svg>
          <div id="pseudo"></div>
          <div id="background"></div>
          <crm-secret-widget>Иван Иванов</crm-secret-widget>
        </main>
      </body>
    </html>
  `);

  await page.evaluate(() => {
    const canvas = document.querySelector("#chart");
    const ctx = canvas.getContext("2d");
    ctx.fillText("Иван Иванов", 5, 20);
  });

  await sanitizePageForScreenshot(page);

  const bodyText = await page.locator("body").innerText();
  assert.doesNotMatch(bodyText, /Иван|555-1234/);
  assert.equal(await page.locator("#customer-input").inputValue(), "ipsum ipsum 77777");
  assert.equal(await page.locator("#customer").getAttribute("aria-label"), "ipsum ipsum ipsum");
  assert.equal(await page.locator("#avatar").evaluate((el) => getComputedStyle(el).visibility), "hidden");
  assert.equal(await page.locator("#chart").evaluate((el) => getComputedStyle(el).visibility), "hidden");
  assert.equal(await page.locator("#svg").evaluate((el) => getComputedStyle(el).visibility), "hidden");
  assert.equal(await page.locator("crm-secret-widget").evaluate((el) => getComputedStyle(el).visibility), "hidden");
  assert.equal(await page.locator("#background").evaluate((el) => getComputedStyle(el).backgroundImage), "none");

  const screenshot = await captureViewportScreenshot(page);
  assert.equal(screenshot.data.length > 0, true);
});


test("browser inspection supports first-class waits, action-local checkpoints, actual text, and layout assertions", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <button id="filter">Filter</button>
        <div id="status">All records</div>
        <section id="calendar" style="width:100%;height:420px">Calendar
          <div data-calendar="main">
            <button class="day">4</button>
            <button class="day">5</button>
          </div>
        </section>
        <section data-calendar="other">
          <button class="day">4</button>
        </section>
        <script>
          const filter = document.querySelector("#filter");
          const status = document.querySelector("#status");
          filter.addEventListener("click", () => {
            filter.dataset.active = filter.dataset.active !== "true" ? "true" : "false";
            setTimeout(() => {
              status.textContent = filter.dataset.active === "true" ? "Filtered records" : "All records";
            }, 40);
          });
        </script>
      </body>
    </html>
  `);

  const signal = new AbortController().signal;
  const actions = await runInspectActions(page, [
    {
      type: "click",
      target: { by: "id", value: "filter" },
      waitFor: { selector: "#status", state: "visible", timeoutMs: 2_000 },
      assertions: [{
        type: "expectText",
        target: { by: "id", value: "status" },
        text: "Filtered",
      }],
    },
    {
      type: "wait",
      durationMs: 60,
      assertions: [{
        type: "expectText",
        target: { by: "id", value: "status" },
        text: "Filtered records",
      }],
    },
    {
      type: "click",
      target: { by: "text", value: "4", scope: { by: "css", value: "[data-calendar='main']" } },
      assertions: [{
        type: "expectStyle",
        target: { by: "id", value: "calendar" },
        property: "width",
        value: "100%",
      }, {
        type: "expectGeometry",
        target: { by: "id", value: "calendar" },
        width: { min: 900 },
        height: { min: 400 },
        visible: true,
      }],
    },
  ], signal, { captureOnAssertionFailure: true });

  assert.equal(actions.length, 3);
  assert(actions.every((item) => item.ok), JSON.stringify(actions));
  assert.equal(actions[0].assertionsPassed, true);
  assert.equal(actions[0].assertions?.[0].actualText, "Filtered records");
  assert.equal(actions[0].checkpoint, undefined);
  assert.equal(actions[2].assertionsPassed, true);

  const selectedMain = await page.locator("[data-calendar='main'] button.day").filter({ hasText: "4" }).count();
  const selectedOther = await page.locator("[data-calendar='other'] button.day").filter({ hasText: "4" }).count();
  assert.equal(selectedMain, 1);
  assert.equal(selectedOther, 1);
});

test("NetworkRecorder captures bounded request/response diagnostics and redacts secrets", async () => {
  const { NetworkRecorder } = await import("../inspector/diagnostics.ts");
  const recorder = new NetworkRecorder();
  const request = {
    method: () => "POST",
    url: () => "https://crm.example.test/api/plan?page=2&token=secret",
    resourceType: () => "xhr",
    postData: () => '{"categoryId":"42","token":"super-secret"}',
  };
  const response = {
    request: () => request,
    status: () => 200,
    statusText: () => "OK",
    headers: () => ({ "content-type": "application/json" }),
    body: async () => Buffer.from('{"items":["one","two"],"token":"response-secret"}', "utf8"),
  };

  recorder.onRequest(request);
  recorder.onResponse(response);
  await recorder.flush();

  assert.equal(recorder.entriesSnapshot.length, 1);
  const entry = recorder.entriesSnapshot[0];
  assert.equal(entry.method, "POST");
  assert.match(entry.url, /page=2/);
  assert.match(entry.url, /token=%5BREDACTED%5D/);
  assert.doesNotMatch(entry.requestBody ?? "", /super-secret/);
  assert.doesNotMatch(entry.responseBody ?? "", /response-secret/);
  assert.equal(entry.status, 200);
  assert.equal(typeof entry.durationMs, "number");
});


test("accessibility diagnostics support interactive and all element modes", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`
    <main>
      <section id="content"><span>Static content</span><button id="go">Go</button></section>
      <div id="hidden" style="display:none"><button>Hidden</button></div>
    </main>
  `);
  const interactive = await captureAccessibilityElements(page, 40, "interactive");
  const all = await captureAccessibilityElements(page, 100, "all");
  assert(interactive.some((item) => item.kind === "button"));
  assert(all.some((item) => item.kind === "other"));
  assert(all.length > interactive.length);
});
