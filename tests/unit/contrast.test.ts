// WCAG contrast of the app's colour tokens, read straight from styles.css, so a colour tweak that
// breaks AA fails the build. Formula: WCAG 2.x relative luminance.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../src/app/styles.css", import.meta.url), "utf8");

/** Custom properties declared in the first block matching `selector`. */
function tokens(selector: RegExp): Record<string, string> {
  const start = css.search(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

const light = tokens(/^:root\s*\{/m);
const dark = { ...light, ...tokens(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{/) };

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** color-mix(in srgb, a p%, b), as the tinted chips use. */
const mix = (a: string, b: string, p: number) =>
  "#" + rgb(a).map((v, i) => Math.round(v * p + rgb(b)[i]! * (1 - p)).toString(16).padStart(2, "0")).join("");

for (const [mode, t] of [["light", light], ["dark", dark]] as const) {
  describe(`${mode} theme`, () => {
    const text: [string, string, string][] = [
      ["body text", t.ink!, t.bg!],
      ["secondary text on page", t["ink-2"]!, t.bg!],
      ["secondary text on cards", t["ink-2"]!, t.surface!],
      ["hint above the page", t["ink-2"]!, t.stage!],
      ["Private chip / Verified", t.ok!, mix(t.ok!, t.surface!, 0.14)],
      ["Check failed", t.fail!, mix(t.fail!, t.surface!, 0.14)],
      ["Delete on the phone bar", t.fail!, t.surface!],
      ["primary and phone active tool", t.bg!, t.ink!],
    ];
    for (const [name, fg, bg] of text) {
      it(`${name}: ${fg} on ${bg} meets 4.5:1`, () => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5));
    }
    it("focus ring meets 3:1 against the page", () => expect(ratio(t.focus!, t.bg!)).toBeGreaterThanOrEqual(3));
    it("current-page thumbnail border meets 3:1", () => expect(ratio(t.ink!, t.surface!)).toBeGreaterThanOrEqual(3));
  });
}

it("text on the yellow accent meets 4.5:1", () => expect(ratio(light["accent-ink"]!, light.accent!)).toBeGreaterThanOrEqual(4.5));
it("selected box ring (#141414) meets 3:1 on the white page", () => expect(ratio("#141414", "#ffffff")).toBeGreaterThanOrEqual(3));
it("loading text on the page meets 4.5:1", () => {
  const color = /\.page-loading \{[^}]*color: (#[0-9a-f]{6})/i.exec(css)![1]!;
  expect(ratio(color, "#ffffff")).toBeGreaterThanOrEqual(4.5);
});
