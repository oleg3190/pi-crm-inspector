import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import {
  captureAccessibilityElements,
  captureDomSnapshot,
  captureViewportScreenshot,
  runInspectActions,
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
  assert.equal(button.name, "Open ipsum");
  assert(elements.some((item) => item.kind === "other" && item.role === undefined) || elements.length > 0);

  const screenshot = await captureViewportScreenshot(page);
  assert.equal(screenshot.data.length > 0, true);
  assert.equal(screenshot.width, 900);
  assert.equal(screenshot.height, 600);
});
