// Every value here is made up or a published test value.
import { describe, expect, it } from "vitest";
import { findingsOnPage, findMatches, isCovered } from "../../src/core/detect";
import type { Word } from "../../src/core/words";
import { DETECTORS, PACKS } from "../../src/packs";
import { isCardNumber, isIban, isNik, luhn } from "../../src/packs/validators";

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
  it("finds the 16-digit layout, with a leading 0", () => finds("id.npwp", "001.234.567.8-901.234", "NPWP: 001.234.567.8-901.234"));
  it("ignores three leading digits that aren't a 0", () => nothing("101.234.567.8-901.234"));
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

describe("national IDs", () => {
  it.each([
    ["us.ssn", "123-45-6789"],
    ["gb.nino", "AB 12 34 56 C"],
    ["gb.nino", "AB123456C"],
    ["in.aadhaar", "2837 4651 0291"],
    ["in.pan", "ABCPE1234F"],
    ["br.cpf", "529.982.247-25"],
    ["br.cpf", "111.444.777-35"],
    ["es.dni", "12345678Z"],
    ["es.dni", "12345678-Z"],
    ["es.nie", "X1234567L"],
    ["gb.nino", "AB 11 11 11 A"],
    ["fr.nir", "1 85 13 78 006 084 25"],
    ["fr.nir", "7 85 05 78 006 084 82"],
    ["fr.nir", "1 85 05 78 006 084 91"],
    ["fr.nir", "1 85 05 2A 006 084 35"],
  ])("%s finds %s", (id, value) => finds(id, value, `Ref: ${value}, on file`));

  it.each([
    ["an SSN in the 900s", "912-34-5678"],
    ["the 666 area", "666-12-3456"],
    ["an SSN with an empty group", "123-00-4567"],
    ["bare 9 digits", "123456789"],
    ["a NINO with a banned first letter", "QQ123456C"],
    ["a reserved NINO prefix", "GB123456C"],
    ["a NINO with a bad suffix", "AB123456E"],
    ["Aadhaar failing its check", "2345 6789 0123"],
    ["Aadhaar starting with 1", "1234 5678 9012"],
    ["bare 12 digits", "283746510291"],
    ["a PAN with a bad fourth letter", "ABCDE1234F"],
    ["a CPF failing its check", "529.982.247-26"],
    ["a repeated CPF", "111.111.111-11"],
    ["a DNI with the wrong letter", "12345678A"],
    ["a NIE with the wrong letter", "X1234567A"],
    ["a NIR with the wrong key", "1 85 05 78 006 084 92"],
  ])("ignores %s", (_why, value) => nothing(value));

  it("a product code isn't a PAN inside a longer word", () => nothing("XABCPE1234F"));

  it("doesn't call a number starting with 0 an SSN", () => {
    expect(found("000-12-3456").map((f) => f[0])).not.toContain("us.ssn");
    expect(found("078-05-1120").map((f) => f[0])).not.toContain("us.ssn");
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

  describe("values found by their label", () => {
    const row = (y: number, ...cells: [string, number][]) =>
      cells.flatMap(([text, start]) => {
        let x = start;
        return text.split(" ").map((t) => {
          const w = word(t, x, y);
          x += w.w + 4;
          return w;
        });
      });
    const list = (...rows: Word[][]) => findingsOnPage(rows.flat(), 0, page).map((f) => [f.detectorId, f.text]);

    it.each([
      ["a colon", row(100, ["Nama: Budi Santoso", 10])],
      ["a colon with a space", row(100, ["Nama : Budi Santoso", 10])],
      ["a table row", row(100, ["Nama", 10], ["Budi Santoso", 200])],
      ["a colon in a column of its own", row(100, ["Nama", 10], [":", 100], ["Budi Santoso", 200])],
      ["a colon starting the value's column", row(100, ["Nama", 10], [": Budi Santoso", 200])],
      ["a numbered line", row(100, ["1. Nama: Budi Santoso", 10])],
      ["any letter case", row(100, ["NAMA: Budi Santoso", 10])],
    ])("finds a name after %s", (_how, words) => {
      expect(findingsOnPage(words, 0, page).map((f) => [f.detectorId, f.text])).toEqual([["id.name", "Budi Santoso"]]);
    });

    it("boxes only the value, not its label", () => {
      const [f] = findingsOnPage(row(100, ["Nama:", 10], ["Budi", 60]), 0, page);
      expect(f!.rects).toHaveLength(1);
      expect(f!.rects[0]!.x).toBeGreaterThan(50);
    });

    it("ends a value at the next known label", () => {
      expect(list(row(100, ["Nama: Budi Umur: 30 Alamat: Jl Merdeka", 10]))).toEqual([
        ["id.name", "Budi"],
        ["id.address", "Jl Merdeka"],
      ]);
    });

    it("follows an address onto lines lined up under it", () => {
      expect(
        list(row(100, ["Alamat", 10], [": Jl Merdeka 10", 100]), row(117, ["RT 01 RW 02", 110]), row(134, ["Bandung", 110])),
      ).toEqual([["id.address", "Jl Merdeka 10 RT 01 RW 02 Bandung"]]);
      expect(list(row(100, ["Alamat: Jl Merdeka 10,", 10]), row(117, ["Bandung 40111", 10]))).toEqual([
        ["id.address", "Jl Merdeka 10, Bandung 40111"],
      ]);
    });

    it("doesn't take the next row of a table or a line after a finished address", () => {
      expect(list(row(100, ["Nama", 10], ["Budi", 200]), row(117, ["Jabatan", 10], ["Direktur", 200]))).toEqual([["id.name", "Budi"]]);
      expect(list(row(100, ["Alamat: Jl Merdeka 10", 10]), row(117, ["Perjanjian ini berlaku", 10]))).toEqual([["id.address", "Jl Merdeka 10"]]);
    });

    it("gives every line of a followed value a box", () => {
      const [f] = findingsOnPage([...row(100, ["Alamat", 10], ["Jl Merdeka", 100]), ...row(117, ["Bandung", 100])], 0, page);
      expect(f!.rects).toHaveLength(2);
    });

    it.each([
      ["a sentence", row(100, ["Silakan isi Nama: Budi", 10])],
      ["a longer label", row(100, ["Nama Perusahaan: PT Maju", 10])],
      ["a label ending in the same word", row(100, ["File Name: report.pdf", 10])],
      ["a word starting with the label", row(100, ["Namanya: Budi", 10])],
      ["a blank to fill in", row(100, ["Nama: ________", 10])],
      ["dots to fill in", row(100, ["Nama : ........", 10])],
      ["a table's header row", row(100, ["Nama", 10], ["Alamat", 200], ["Telepon", 400])],
      ["a header row ending in another column", row(100, ["Nama", 10], ["Alamat", 200], ["Tahun", 400])],
      ["a label with nothing after it", row(100, ["Nama", 10])],
      ["the label word in plain text", row(100, ["Nama Budi Santoso", 10])],
    ])("ignores %s", (_why, words) => {
      expect(findingsOnPage(words, 0, page)).toEqual([]);
    });

    it("doesn't list what a format already found, but keeps the rest of the value", () => {
      expect(list(row(100, ["NIK: 3201014512900001", 10]))).toEqual([["id.nik", "3201014512900001"]]);
      expect(list(row(100, ["NPWP: 01.234.567.8-901.234", 10]))).toEqual([["id.npwp", "01.234.567.8-901.234"]]);
      const both = findingsOnPage(row(100, ["Alamat: Jl Merdeka a@example.com", 10]), 0, page);
      expect(both.map((f) => f.detectorId).sort()).toEqual(["id.address", "intl.email"]);
      expect(both.every((f) => f.rects.length === 1)).toBe(true);
    });

    it("finds bare NPWP digits next to the label only", () => {
      expect(list(row(100, ["NPWP: 0012345678012345", 10]))).toEqual([["id.npwp-labelled", "0012345678012345"]]);
      expect(list(row(100, ["NPWP: 012345678012345", 10]))).toEqual([["id.npwp-labelled", "012345678012345"]]);
      expect(list(row(100, ["NPWP: 12345", 10]))).toEqual([]);
      expect(list(row(100, ["NPWP: sedang diurus", 10]))).toEqual([]);
      expect(list(row(100, ["Referensi: 012345678012345", 10]))).toEqual([]);
    });

    it.each([
      ["Nombre: Ana García", "es.name", "Ana García"],
      ["Dirección: Calle Mayor 5", "es.address", "Calle Mayor 5"],
      ["Fecha de Nacimiento: 15/05/1990", "es.birth", "15/05/1990"],
      ["Prénom : Claire", "fr.name", "Claire"],
      ["Adresse : 5 Rue de la Paix", "fr.address", "5 Rue de la Paix"],
      ["Date de Naissance : 15/05/1990", "fr.birth", "15/05/1990"],
      ["Nachname: Müller", "de.name", "Müller"],
      ["Anschrift: Hauptstraße 5", "de.address", "Hauptstraße 5"],
      ["Geburtsdatum: 15.05.1990", "de.birth", "15.05.1990"],
      ["Nome Completo: João Silva", "pt.name", "João Silva"],
      ["Endereço: Rua Augusta 5", "pt.address", "Rua Augusta 5"],
      ["Data de Nascimento: 15/05/1990", "pt.birth", "15/05/1990"],
      ["Cognome: Rossi", "it.name", "Rossi"],
      ["Indirizzo: Via Roma 5", "it.address", "Via Roma 5"],
      ["Codice Fiscale: RSSMRA90E15H501X", "it.tax", "RSSMRA90E15H501X"],
      ["SSN: 123456789", "us.ssn-labelled", "123456789"],
      ["CPF: 52998224725", "br.cpf-labelled", "52998224725"],
    ])("reads %s", (text, id, value) => {
      expect(list(row(100, [text, 10]))).toEqual([[id, value]]);
    });

    it("stops at labels in other languages too", () => {
      expect(list(row(100, ["Nombre: Ana Edad: 30", 10]))).toEqual([["es.name", "Ana"]]);
      expect(list(row(100, ["Nachname: Müller Beruf: Lehrer", 10]))).toEqual([["de.name", "Müller"]]);
    });

    it("finds English labels and birth details", () => {
      expect(list(row(100, ["Full Name: Jane Doe", 10]))).toEqual([["intl.name", "Jane Doe"]]);
      expect(list(row(100, ["Date of Birth: 1 May 1990", 10]))).toEqual([["intl.birth", "1 May 1990"]]);
      expect(list(row(100, ["Tempat/Tgl Lahir: Bandung, 15-05-1990", 10]))).toEqual([["id.birth", "Bandung, 15-05-1990"]]);
    });
  });

  describe("a value that wraps onto the next line", () => {
    const texts = (list: { text: string }[]) => list.map((f) => f.text);

    it("finds it whole, with a box on each line and nothing else boxed", () => {
      const list = findingsOnPage(
        [word("ke", 10, 100), word("+62", 40, 100), word("21", 70, 100), word("5555", 90, 100), word("0199", 10, 117), word("apabila", 50, 117)],
        0,
        page,
      );
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ detectorId: "intl.phone", text: "+62 21 5555 0199" });
      expect(list[0]!.rects).toHaveLength(2);
      const [first, second] = list[0]!.rects;
      expect(first!.x).toBeGreaterThan(30);
      expect(first!.x + first!.w).toBeGreaterThanOrEqual(114);
      expect(second!.x).toBeLessThanOrEqual(10);
      expect(second!.x + second!.w).toBeLessThan(50);
    });

    it.each([
      ["a card", ["4111 1111", "1111 1111"], "intl.card", "4111 1111 1111 1111"],
      ["an IBAN", ["DE89 3704 0044", "0532 0130 00"], "eu.iban", "DE89 3704 0044 0532 0130 00"],
      ["a NIK cut in the middle", ["32010145", "12900001"], "id.nik", "32010145 12900001"],
      ["a card over four lines of a narrow cell", ["4111", "1111", "1111", "1111"], "intl.card", "4111 1111 1111 1111"],
      ["a phone number broken at a hyphen", ["0812-3456-", "7890"], "intl.phone", "0812-3456-7890"],
      ["an NPWP broken at a hyphen", ["01.234.567.8-", "901.234"], "id.npwp", "01.234.567.8-901.234"],
      ["an email broken at a hyphen", ["budi-", "santoso@example.com"], "intl.email", "budi-santoso@example.com"],
      ["an email broken after the @", ["budi@", "example.com"], "intl.email", "budi@example.com"],
    ])("%s", (_what, parts, detector, value) => {
      const pieces = parts.flatMap((part, i) => {
        let x = 10;
        return part.split(" ").map((t) => {
          const w = word(t, x, 100 + i * 17);
          x += w.w + 6;
          return w;
        });
      });
      const list = findingsOnPage(pieces, 0, page);
      expect(list.map((f) => [f.detectorId, f.text])).toEqual([[detector, value]]);
      expect(list[0]!.rects).toHaveLength(parts.length);
    });

    it("finds it on rotated pages, where the next line lies in another direction", () => {
      const turned = (text: string, base: number, y: number, reversed: boolean): Word => ({
        ...word(text, base - 10, y),
        w: 12,
        h: text.length * 6,
        axis: "v",
        reversed,
        base,
      });
      const clockwise = [turned("4111", 300, 10, false), turned("1111", 300, 40, false), turned("1111", 283, 10, false), turned("1111", 283, 40, false)];
      expect(texts(findingsOnPage(clockwise, 0, page))).toEqual(["4111 1111 1111 1111"]);
      const anti = [turned("4111", 300, 300, true), turned("1111", 300, 270, true), turned("1111", 317, 300, true), turned("1111", 317, 270, true)];
      expect(texts(findingsOnPage(anti, 0, page))).toEqual(["4111 1111 1111 1111"]);
    });

    it("keeps each row of a table as its own finding", () => {
      const rows = ["021 555 0199", "021 555 0200"].flatMap((row, i) => {
        let x = 10;
        return row.split(" ").map((t) => {
          const w = word(t, x, 100 + i * 17);
          x += w.w + 6;
          return w;
        });
      });
      expect(texts(findingsOnPage(rows, 0, page))).toEqual(["021 555 0199", "021 555 0200"]);
    });

    it("follows the column the value is in, not the row's other cells", () => {
      const list = findingsOnPage(
        [word("Kartu", 10, 100), word("4111", 200, 100), word("1111", 240, 100), word("Rp", 400, 100), word("1111", 200, 117), word("1111", 240, 117), word("9000", 400, 117)],
        0,
        page,
      );
      expect(texts(list)).toEqual(["4111 1111 1111 1111"]);
      expect(list[0]!.rects).toHaveLength(2);
    });

    it.each([
      ["too far below", [word("4111", 10, 100), word("1111", 40, 100), word("1111", 10, 140), word("1111", 40, 140)]],
      ["off to the side", [word("4111", 10, 100), word("1111", 40, 100), word("1111", 300, 117), word("1111", 330, 117)]],
      ["above, not below", [word("1111", 10, 83), word("1111", 40, 83), word("4111", 10, 100), word("1111", 40, 100)]],
      ["in much smaller print", [word("4111", 10, 100), word("1111", 40, 100), { ...word("1111", 10, 117), size: 6 }, { ...word("1111", 40, 117), size: 6 }]],
    ])("doesn't join lines that are %s", (_why, pieces) => {
      expect(findingsOnPage(pieces, 0, page)).toEqual([]);
    });

    it("keeps findings in reading order with unique ids", () => {
      const list = findingsOnPage(
        [word("a@example.com", 10, 60), word("4111", 10, 100), word("1111", 40, 100), word("1111", 10, 117), word("1111", 40, 117), word("b@example.com", 10, 160)],
        0,
        page,
      );
      expect(texts(list)).toEqual(["a@example.com", "4111 1111 1111 1111", "b@example.com"]);
      expect(new Set(list.map((f) => f.id)).size).toBe(3);
    });

    it("counts as covered only when every line is covered", () => {
      const [f] = findingsOnPage([word("4111", 10, 100), word("1111", 40, 100), word("1111", 10, 117), word("1111", 40, 117)], 1, page);
      const [first, second] = f!.rects;
      expect(isCovered(f!, [{ ...first!, page: 1 }])).toBe(false);
      expect(isCovered(f!, [{ ...first!, page: 1 }, { ...second!, page: 1 }])).toBe(true);
    });
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
