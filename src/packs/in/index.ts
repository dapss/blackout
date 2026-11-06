import type { Pack } from "../types";

export const india: Pack = {
  id: "in",
  name: "India",
  detectors: [
    // Only in its printed groups: as bare digits, one 12-digit number in ten passes the checksum.
    { id: "in.aadhaar", label: "Aadhaar (India)", pattern: /\d{4}[ -]\d{4}[ -]\d{4}/, validator: "aadhaar" },
    { id: "in.pan", label: "PAN (India)", pattern: /[A-Z]{3}[ABCFGHJLPTE][A-Z]\d{4}[A-Z]/ },
  ],
  fields: [
    {
      id: "in.aadhaar-labelled",
      label: "Aadhaar (India)",
      names: ["Aadhaar", "Aadhaar No", "Aadhaar No.", "Aadhaar Number"],
      value: /^\d{4}[ -]?\d{4}[ -]?\d{4}$/,
      validator: "aadhaar",
    },
  ],
};
