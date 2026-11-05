// Checks that turn a pattern match into a real finding. Packs refer to these by name.

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** Every digit the same, as in placeholders like 0000 0000 0000 0000. */
const allSame = (digits: string) => /^(\d)\1*$/.test(digits);

/** A short pattern repeated, as in 1212121212121212. */
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

/** Province codes in use, the first two digits of a NIK. */
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
  return digits.length === 15 && !allSame(digits);
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
  email: isEmail,
  phone: isPhone,
};

export type ValidatorName = keyof typeof validators;
