const digitsOf = (s: string) => s.replace(/\D/g, "");

const allSame = (digits: string) => /^(\d)\1*$/.test(digits);

const repeating = (digits: string) => /^(\d{1,4})\1+$/.test(digits);

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Issuer prefixes and the lengths those issuers use. A checksum alone passes one number in ten. */
const CARD_NETWORKS: { prefix: RegExp; lengths: number[] }[] = [
  { prefix: /^4/, lengths: [13, 16, 19] }, // Visa
  { prefix: /^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/, lengths: [16] }, // Mastercard
  { prefix: /^3[47]/, lengths: [15] }, // American Express
  { prefix: /^(6011|65|64[4-9])/, lengths: [16, 19] }, // Discover
  { prefix: /^35(2[89]|[3-8])/, lengths: [16, 19] }, // JCB
  { prefix: /^(3[689]|30[0-5])/, lengths: [14, 16] }, // Diners Club
  { prefix: /^62/, lengths: [16, 17, 18, 19] }, // UnionPay
  { prefix: /^220[0-4]/, lengths: [16] }, // Mir
];

export function isCardNumber(text: string): boolean {
  const digits = digitsOf(text);
  if (allSame(digits) || !luhn(digits)) return false;
  return CARD_NETWORKS.some((n) => n.prefix.test(digits) && n.lengths.includes(digits.length));
}

/** Length of an IBAN in each country that issues them, from the SWIFT registry. */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
  LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24,
  PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

export function isIban(text: string): boolean {
  const iban = text.replace(/[^0-9A-Z]/g, "");
  if (IBAN_LENGTHS[iban.slice(0, 2)] !== iban.length) return false;
  const check = iban.slice(2, 4);
  if (check === "00" || check === "01" || check === "99") return false;
  // ISO 13616: move the first four characters to the end, turn letters into 10-35, remainder mod 97 must be 1.
  let remainder = 0;
  for (const c of iban.slice(4) + iban.slice(0, 4)) {
    const value = parseInt(c, 36);
    remainder = value > 9 ? (remainder * 100 + value) % 97 : (remainder * 10 + value) % 97;
  }
  return remainder === 1;
}

const NIK_PROVINCES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 31, 32, 33, 34, 35, 36, 51, 52, 53, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75,
  76, 81, 82, 91, 92, 93, 94, 95, 96,
]);
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Indonesian NIK: PPKKSS DDMMYY NNNN (province, regency, district, birth date, serial). There is no
 * checksum, so every segment has to make sense. Women's birth days have 40 added. Regencies are
 * numbered from 01 and cities from 71. Some random 16-digit numbers still pass, so this reduces false
 * positives but can't rule them out.
 */
export function isNik(text: string): boolean {
  const nik = digitsOf(text);
  if (nik.length !== 16 || repeating(nik)) return false;
  const part = (start: number) => Number(nik.slice(start, start + 2));
  const regency = part(2);
  if (!NIK_PROVINCES.has(part(0)) || regency === 0 || (regency > 40 && regency < 71) || regency > 79) return false;
  if (part(4) === 0) return false;
  const month = part(8);
  if (month < 1 || month > 12) return false;
  const day = part(6) > 40 ? part(6) - 40 : part(6);
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]!) return false;
  return nik.slice(12) !== "0000";
}

/** The dotted NPWP layout is distinctive enough on its own; there's no public checksum to test. */
export function isNpwp(text: string): boolean {
  const digits = digitsOf(text);
  if (allSame(digits)) return false;
  return digits.length === 15 || (digits.length === 16 && digits[0] === "0");
}

/** Next to an NPWP label, bare digits are enough, and a person's 16-digit NPWP is their NIK. */
export function isNpwpLabelled(text: string): boolean {
  const digits = digitsOf(text);
  return (digits.length === 15 || digits.length === 16) && !allSame(digits);
}

/** The ranges the US has never issued, and two numbers made famous by printed samples. */
export function isSsn(text: string): boolean {
  const d = digitsOf(text);
  if (d.length !== 9 || allSame(d)) return false;
  const area = Number(d.slice(0, 3));
  if (area === 0 || area === 666 || area >= 900) return false;
  if (d.slice(3, 5) === "00" || d.slice(5) === "0000") return false;
  return d !== "078051120" && d !== "219099999";
}

/** UK National Insurance prefixes exclude certain letters and a few reserved pairs. */
export function isNino(text: string): boolean {
  const n = text.replace(/ /g, "");
  if (/[DFIQUV]/.test(n[0]!) || /[DFIOQUV]/.test(n[1]!)) return false;
  return !["BG", "GB", "NK", "KN", "TN", "NT", "ZZ"].includes(n.slice(0, 2)) && !/^[A-Z]{2}(\d)\1{5}/.test(n);
}

const VERHOEFF_D = [
  "0123456789", "1234067895", "2340178956", "3401289567", "4012395678",
  "5987604321", "6598710432", "7659821043", "8765932104", "9876543210",
].map((row) => [...row].map(Number));
const VERHOEFF_P = [
  "0123456789", "1576283094", "5803796142", "8916043527", "9453126870",
  "4286573901", "2793806415", "7046913258",
].map((row) => [...row].map(Number));

/** Aadhaar: 12 digits, not starting with 0 or 1, with a Verhoeff check digit. */
export function isAadhaar(text: string): boolean {
  const d = digitsOf(text);
  if (d.length !== 12 || /^[01]/.test(d) || repeating(d)) return false;
  let c = 0;
  [...d].reverse().forEach((ch, i) => {
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![Number(ch)]!]!;
  });
  return c === 0;
}

/** CPF: 9 digits and two mod-11 check digits. */
export function isCpf(text: string): boolean {
  const d = digitsOf(text);
  if (d.length !== 11 || allSame(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return (r === 10 ? 0 : r) === Number(d[len]);
  };
  return check(9) && check(10);
}

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

export function isDni(text: string): boolean {
  const d = digitsOf(text);
  return !allSame(d) && DNI_LETTERS[Number(d) % 23] === text[text.length - 1];
}

/** NIE: a DNI whose first letter stands for a leading digit (X 0, Y 1, Z 2). */
export function isNie(text: string): boolean {
  const lead = "XYZ".indexOf(text[0]!);
  return DNI_LETTERS[Number(`${lead}${digitsOf(text)}`) % 23] === text[text.length - 1];
}

/** French NIR: sex, year, month, place, order and a mod-97 key. Corsica's 2A and 2B count as 19 and 18. */
export function isNir(text: string): boolean {
  const n = text.replace(/ /g, "");
  const month = Number(n.slice(3, 5));
  if (month === 0 || (month > 12 && month < 20)) return false;
  const body = n.slice(0, 13).replace("2A", "19").replace("2B", "18");
  return 97 - Number(BigInt(body) % 97n) === Number(n.slice(13));
}

export function isEmail(text: string): boolean {
  const [local, domain] = text.split("@") as [string, string];
  if (local.startsWith(".") || local.endsWith(".") || text.includes("..")) return false;
  return domain.split(".").every((label) => !label.startsWith("-") && !label.endsWith("-"));
}

/** Phone numbers have no checksum, so this mostly rules out what isn't one, such as dates. */
export function isPhone(text: string): boolean {
  const digits = digitsOf(text);
  if (allSame(digits)) return false;
  if (text.startsWith("+")) return digits.length >= 8 && digits.length <= 15;
  if (digits.length < 9 || digits.length > 13) return false;
  const groups = text.split(/[^0-9]+/).filter(Boolean);
  const looksLikeDate =
    groups.length >= 3 &&
    groups[2]!.length === 4 &&
    Number(groups[0]) <= 31 &&
    Number(groups[1]) <= 12 &&
    /^(19|20)/.test(groups[2]!);
  return !looksLikeDate;
}

export const validators = {
  card: isCardNumber,
  iban: isIban,
  nik: isNik,
  npwp: isNpwp,
  npwpLabelled: isNpwpLabelled,
  ssn: isSsn,
  nino: isNino,
  aadhaar: isAadhaar,
  cpf: isCpf,
  dni: isDni,
  nie: isNie,
  nir: isNir,
  email: isEmail,
  phone: isPhone,
};

export type ValidatorName = keyof typeof validators;
