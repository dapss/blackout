// Every value here is made up or a published test value.
import { describe, expect, it } from "vitest";
import { findingsOnPage, findMatches, isCovered } from "../../src/core/detect";
import type { Word } from "../../src/core/words";
import { DETECTORS, PACKS } from "../../src/packs";
import { isCardNumber, isIban, isNik, luhn } from "../../src/packs/validators";

/** What was found in a line of text: [detector id, matched text]. */
const found = (text: string) => findMatches(text).map((m) => [m.detector.id, text.slice(m.start, m.end)]);
const nothing = (text: string) => expect(found(text), text).toEqual([]);
const finds = (id: string, value: string, text = value) => expect(found(text), text).toEqual([[id, value]]);

describe("card numbers", () => {
  it.each([
    "4111111111111111",
    "4111 1111 1111 1111",
    "4111-1111-1111-1111",
    "5555555555554444",
    "378282246310005",
    "3782 822463 10005",
    "6011111111111117",
    "3530111333300000",
    "4222222222222",
  ])("finds %s", (card) => finds("intl.card", card));

  it("finds a card among other text and numbers", () => {
    finds("intl.card", "4111 1111 1111 1111", "Card: 4111 1111 1111 1111, expires 2031");
    finds("intl.card", "4111 1111 1111 1111", "Paid 4111 1111 1111 1111 2031");
  });

  it.each([
    ["fails Luhn", "4111111111111112"],
    ["a bare 16-digit number", "1234567890123456"],
    ["passes Luhn but no issuer uses that prefix", "9999999999999995"],
    ["known prefix at a length that issuer doesn't use", "411111111111116"],
    ["all zeros", "0000000000000000"],
    ["all zeros, grouped", "0000 0000 0000 0000"],
    ["inside a longer number", "41111111111111119"],
    ["inside a word", "A4111111111111111"],
    ["followed by letters", "4111111111111111X"],
  ])("ignores %s", (_why, value) => nothing(value));

  it("a card isn't mistaken for a NIK in the numbers around it", () => {
    expect(found("4111 1111 1111 1111 3201014512900001").map((f) => f[0])).toEqual(["intl.card", "id.nik"]);
  });

  it("Luhn", () => {
    expect(luhn("79927398713")).toBe(true);
    expect(luhn("79927398710")).toBe(false);
    expect(isCardNumber("4111 1111 1111 1111")).toBe(true);
  });
});

describe("NIK", () => {
  it.each([
    ["a woman's, with 40 added to the day", "3201014512900001"],
    ["a man's", "3201010512900001"],
    ["born on 29 February", "3171012902000123"],
  ])("finds %s", (_why, nik) => finds("id.nik", nik));

  it("finds a grouped NIK", () => finds("id.nik", "3201 0145 1290 0001"));

  it.each([
    ["no such province", "9901014512900001"],
    ["regency 00", "3200014512900001"],
    ["district 00", "3201004512900001"],
    ["month 13", "3201014513900001"],
    ["month 00", "3201014500900001"],
    ["day 00", "3201010012900001"],
    ["day 32", "3201013212900001"],
    ["day 72 (women's days stop at 71)", "3201017212900001"],
    ["31 February", "3201013102900001"],
    ["serial 0000", "3201014512900000"],
    ["a regency code that isn't used", "3250014512900001"],
    ["a city code that isn't used", "3280014512900001"],
    ["a repeating pattern", "1212121212121212"],
    ["15 digits", "320101451290001"],
    ["17 digits", "32010145129000011"],
  ])("rejects %s", (_why, nik) => expect(isNik(nik)).toBe(false));

  it.each(["1234567890123456", "1111111111111111", "1212121212121212", "9876543210987654", "0000000000000000", "1234 5678 9012 3456"])(
    "doesn't flag the bare 16-digit number %s",
    (value) => nothing(value),
  );

  it("isn't found inside a longer number or word", () => {
    nothing("32010145129000011");
    nothing("ID3201014512900001");
  });
});

describe("NPWP", () => {
  it("finds the dotted layout", () => finds("id.npwp", "01.234.567.8-901.234", "NPWP: 01.234.567.8-901.234"));
  it.each([
    ["bare digits", "012345678901234"],
    ["the wrong layout", "01.234.567.8.901.234"],
    ["all zeros", "00.000.000.0-000.000"],
    ["inside a longer number", "01.234.567.8-901.2345"],
  ])("ignores %s", (_why, value) => nothing(value));
});

describe("IBAN", () => {
  it.each(["DE89370400440532013000", "GB82WEST12345698765432", "FR1420041010050500013M02606", "NL91ABNA0417164300", "NO9386011117947"])(
    "finds %s",
    (iban) => finds("eu.iban", iban),
  );

  it("finds a grouped IBAN and stops where it ends", () => {
    finds("eu.iban", "DE89 3704 0044 0532 0130 00", "IBAN: DE89 3704 0044 0532 0130 00");
    finds("eu.iban", "DE89 3704 0044 0532 0130 00", "DE89 3704 0044 0532 0130 00 BIC COBADEFF");
  });

  it.each([
    ["a wrong check digit", "DE89370400440532013001"],
    ["two digits swapped", "DE98370400440532013000"],
    ["too short for the country", "DE8937040044053201300"],
    ["an unknown country", "ZZ89370400440532013000"],
    ["check digits 00", "DE00370400440532013000"],
    ["a similar-looking code", "AB12 CDEF GHIJ KLMN"],
  ])("rejects %s", (_why, value) => {
    expect(isIban(value)).toBe(false);
    nothing(value);
  });
});

describe("email", () => {
  it.each(["jane.doe@example.com", "a+tag@sub.example.co.id", "J_D-1@example.org"])("finds %s", (email) => finds("intl.email", email));

  it("leaves out punctuation around the address", () => {
    finds("intl.email", "jane@example.com", "(jane@example.com),");
    finds("intl.email", "jane@example.com", "Mail jane@example.com.");
  });

  it.each(["@example.com", "jane@", "jane@localhost", "a..b@example.com", ".a@example.com", "a.@example.com", "a@-x.com", "a@x-.com", "jane at example dot com"])(
    "ignores %s",
    nothing,
  );
});

describe("phone numbers", () => {
  it.each(["+62 812-3456-7890", "+62 81234567890", "+1 (555) 123-4567", "+44 20 7946 0958", "(021) 555-1234", "021-555-1234", "081234567890", "0812-3456-7890", "555-123-4567"])(
    "finds %s",
    (phone) => finds("intl.phone", phone),
  );

  it.each([
    ["an ISO date", "2024-01-15"],
    ["a date", "15-01-2024"],
    ["a date with a leading zero", "01-02-2024"],
    ["a date with dots", "01.02.2024"],
    ["a date and time", "01 02 2024 1530"],
    ["a US social security layout", "123-45-6789"],
    ["short numbers", "12345"],
    ["ten bare digits", "1234567890"],
    ["a bare 16-digit number", "1234567890123456"],
    ["a mobile-looking start in a long number", "0812345678901234"],
    ["too many digits", "+1234567890123456"],
    ["too few digits", "+1234567"],
    ["one repeated digit", "0000-0000-0000"],
    ["inside a word", "A081234567890"],
    ["one piece of a longer number", "12-0812-3456-789"],
    ["the tail of a grouped number", "1234 0812 3456 7890"],
  ])("ignores %s", (_why, value) => nothing(value));
});

describe("packs", () => {
  it("every detector has a unique id starting with its pack's", () => {
    expect(new Set(DETECTORS.map((d) => d.id)).size).toBe(DETECTORS.length);
    for (const pack of PACKS) for (const d of pack.detectors) expect(d.id.startsWith(`${pack.id}.`)).toBe(true);
  });

  it("no pattern has flags that would make the engine skip text", () => {
    for (const d of DETECTORS) expect(d.pattern.flags).toBe("");
  });

  it("finds several values on one line without overlaps", () => {
    expect(found("jane@example.com 4111 1111 1111 1111 +62 812-3456-7890").map((f) => f[0])).toEqual(["intl.email", "intl.card", "intl.phone"]);
  });

  it("stays fast on a huge line from a hostile PDF", () => {
    const started = performance.now();
    for (const line of ["1 ".repeat(50_000), "a.".repeat(50_000), "A1".repeat(50_000), "+1 ".repeat(30_000), "(0".repeat(50_000)]) findMatches(line);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe("findingsOnPage", () => {
  const page = { width: 600, height: 800 };
  const word = (text: string, x: number, y = 100, w = text.length * 6): Word => ({
    text,
    x,
    y,
    w,
    h: 12,
    axis: "h",
    reversed: false,
    base: y + 10,
    size: 12,
    snapped: true,
  });

  it("boxes the whole words a match touches, and nothing else on the line", () => {
    const [f] = findingsOnPage([word("Card:", 10), word("4111", 50), word("1111", 80), word("1111", 110), word("1111", 140), word("end", 300)], 2, page);
    expect(f).toMatchObject({ page: 2, detectorId: "intl.card", label: "Card number", text: "4111 1111 1111 1111" });
    expect(f!.rects).toHaveLength(1);
    expect(f!.rects[0]!.x).toBeLessThanOrEqual(50);
    expect(f!.rects[0]!.x).toBeGreaterThan(40);
    expect(f!.rects[0]!.x + f!.rects[0]!.w).toBeGreaterThanOrEqual(164);
    expect(f!.rects[0]!.x + f!.rects[0]!.w).toBeLessThan(200);
  });

  it("joins text the PDF split into separate runs, but not words with a real space", () => {
    const joined = findingsOnPage([word("jane@", 10), word("example.com", 40)], 0, page);
    expect(joined.map((f) => f.text)).toEqual(["jane@example.com"]);
    expect(findingsOnPage([word("jane@", 10), word("example.com", 60)], 0, page)).toEqual([]);
  });

  it("keeps words in reading order whatever order the PDF stores them in", () => {
    const [f] = findingsOnPage([word("example.com", 40), word("jane@", 10)], 0, page);
    expect(f!.text).toBe("jane@example.com");
  });

  it("doesn't find a value split across two lines", () => {
    expect(findingsOnPage([word("4111", 10, 100), word("1111", 40, 100), word("1111", 10, 120), word("1111", 40, 120)], 0, page)).toEqual([]);
  });

  it("gives every finding its own id, and returns nothing for a page with no words", () => {
    const list = findingsOnPage([word("a@example.com", 10, 100), word("b@example.com", 10, 140)], 1, page);
    expect(new Set(list.map((f) => f.id)).size).toBe(2);
    expect(findingsOnPage([], 0, page)).toEqual([]);
  });

  it("isCovered needs a box on the same page around the whole finding", () => {
    const [f] = findingsOnPage([word("a@example.com", 10)], 1, page);
    const r = f!.rects[0]!;
    expect(isCovered(f!, [])).toBe(false);
    expect(isCovered(f!, [{ ...r, page: 1 }])).toBe(true);
    expect(isCovered(f!, [{ x: 0, y: 0, w: 600, h: 800, page: 1 }])).toBe(true);
    expect(isCovered(f!, [{ ...r, page: 0 }])).toBe(false);
    expect(isCovered(f!, [{ ...r, w: r.w / 2, page: 1 }])).toBe(false);
  });
});
