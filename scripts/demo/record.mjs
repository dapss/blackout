// Records the README demo as screenshots with explicit durations. Every value in the document is made up.
// To remake docs/demo.gif, from the project root:
//   pnpm build
//   node scripts/demo/record.mjs
//   python scripts/demo/encode.py docs/demo.gif
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { preview } from "vite";

const WORK = join(tmpdir(), "blackout-demo");
const FRAMES = join(WORK, "frames");
const PORT = 4179;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

async function makeDoc() {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([595, 500]);
  p.drawText("Rental application", { x: 60, y: 440, size: 22, font: bold });
  const rows = [
    ["Applicant", "Jane Doe"],
    ["Email", "jane.doe@example.com"],
    ["Phone", "+62 812-3456-7890"],
    ["NIK", "3201014512900001"],
    ["IBAN", "DE89 3704 0044 0532 0130 00"],
    ["Card on file", "4111 1111 1111 1111"],
    ["Monthly rent", "Rp 4.500.000"],
    ["Start date", "1 December 2026"],
  ];
  rows.forEach(([k, v], i) => {
    const y = 390 - i * 40;
    p.drawText(k, { x: 60, y, size: 13, font: bold });
    p.drawText(v, { x: 170, y, size: 13, font: regular });
  });
  doc.setTitle("Rental application");
  return Buffer.from(await doc.save());
}

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 790 }, deviceScaleFactor: 1 });

const frames = [];
const snap = async (ms) => {
  const file = join(FRAMES, `${String(frames.length).padStart(4, "0")}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  frames.push({ file, ms });
};

await page.goto(`http://localhost:${PORT}/`);
await page.waitForLoadState("networkidle");
// The local build's version and "Preview build" label would be wrong in a README image.
await page.evaluate(() => {
  const f = document.querySelector("footer");
  if (f) f.style.visibility = "hidden";
});

// A visible pointer, because headless screenshots don't show one.
await page.evaluate(() => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.id = "demo-cursor";
  svg.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(560px,420px)";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M3 2 L3 19 L8 15 L11.5 22 L14.5 20.5 L11 14 L18 14 Z");
  path.setAttribute("fill", "#111");
  path.setAttribute("stroke", "#fff");
  path.setAttribute("stroke-width", "1.5");
  svg.appendChild(path);
  document.documentElement.appendChild(svg);
});

let cursor = { x: 560, y: 420 };
const setCursor = (x, y) =>
  page.evaluate(
    ([x, y]) => {
      document.getElementById("demo-cursor").style.transform = `translate(${x}px,${y}px)`;
    },
    [x, y],
  );
async function glide(x, y, steps = 9) {
  const from = { ...cursor };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t * t * (3 - 2 * t);
    await setCursor(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await snap(50);
  }
  cursor = { x, y };
}
async function glideTo(locator) {
  const b = await locator.boundingBox();
  await glide(b.x + b.width / 2, b.y + b.height / 2);
  return b;
}

await snap(1300); // the landing page

await page.getByTestId("file-input").setInputFiles({
  name: "rental-application.pdf",
  mimeType: "application/pdf",
  buffer: await makeDoc(),
});
await page.getByTestId("page-layer").waitFor();
await page.locator(".page-loading").waitFor({ state: "detached" });
const gotIt = page.getByRole("button", { name: "Got it" });
if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
await page.waitForTimeout(600);
await snap(1300); // the document, every value readable

const find = page.getByTestId("find-button");
await glideTo(find);
await find.click();
await page.getByTestId("review-summary").waitFor({ timeout: 60000 });
await page.waitForTimeout(300);
await snap(2600); // the findings and their marks

const all = page.locator(".review-all");
await glideTo(all);
await all.click();
await page.waitForTimeout(300);
await snap(1700); // everything found is now black, the name is not

// Names aren't detected, so take this one by hand in Words mode.
const layer = page.getByTestId("page-layer");
const r = await layer.boundingBox();
const nx = r.x + r.width * ((170 + 15) / 595);
const ny = r.y + r.height * ((500 - 390 - 4) / 500);
await glide(nx, ny);
await page.mouse.click(nx, ny);
await page.waitForTimeout(400);
await snap(900);
const lx = r.x + r.width * ((170 + 42) / 595);
await glide(lx, ny, 5);
await page.mouse.click(lx, ny);
await page.waitForTimeout(400);
await snap(1200); // the name is black too

const exportBtn = page.getByTestId("export-button");
await glideTo(exportBtn);
await exportBtn.click();
await page.getByTestId("verify-summary").waitFor({ timeout: 120000 });
await page.waitForTimeout(300);
console.log("summary:", await page.getByTestId("verify-summary").innerText());
await snap(4000); // the verified result

writeFileSync(join(WORK, "frames.json"), JSON.stringify(frames));
await browser.close();
await server.close();
console.log(`frames: ${frames.length}, seconds: ${frames.reduce((a, f) => a + f.ms, 0) / 1000}`);
process.exit(0);
