import { describe, expect, it } from "vitest";
import { buildCsp } from "../../csp.config";
import { sniffKind } from "../../src/core/sniff";
import { redactedFileName } from "../../src/core/redact-safe";
import { fitScale, MAX_CANVAS_AREA } from "../../src/core/render";

const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe("sniffKind", () => {
  it("recognizes files by content, not name", () => {
    expect(sniffKind(bytes("%PDF-1.7\n"))).toBe("pdf");
    expect(sniffKind(bytes("garbage\n%PDF-1.4"))).toBe("pdf");
    expect(sniffKind(bytes(0x89, "PNG", 0x0d, 0x0a))).toBe("image");
    expect(sniffKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image");
    expect(sniffKind(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe("image");
    expect(sniffKind(bytes("GIF89a"))).toBeNull();
    expect(sniffKind(bytes("<html>"))).toBeNull();
  });
});

describe("redactedFileName", () => {
  it("adds .redacted and the right extension", () => {
    expect(redactedFileName("payslip.pdf", "pdf")).toBe("payslip.redacted.pdf");
    expect(redactedFileName("passport.photo.JPG", "image")).toBe("passport.photo.redacted.png");
    expect(redactedFileName("noext", "pdf")).toBe("noext.redacted.pdf");
  });
});

describe("fitScale", () => {
  it("keeps the requested scale for normal pages", () => {
    expect(fitScale({ width: 595, height: 842 }, 200 / 72)).toBeCloseTo(200 / 72);
  });
  it("shrinks huge pages under the canvas limit", () => {
    const s = fitScale({ width: 5000, height: 5000 }, 200 / 72);
    expect(5000 * 5000 * s * s).toBeLessThanOrEqual(MAX_CANVAS_AREA + 1);
  });
});

describe("CSP", () => {
  it("restricts connect-src to 'self' only", () => {
    for (const csp of [buildCsp(), buildCsp({ dev: true }), buildCsp({ header: true })]) {
      const connect = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
      expect(connect).toBe("connect-src 'self'");
      expect(csp).toContain("object-src 'none'");
    }
  });
  it("production policy allows no inline scripts", () => {
    expect(buildCsp()).toContain("script-src 'self';");
    expect(buildCsp({ header: true })).toContain("frame-ancestors 'none'");
  });
});
