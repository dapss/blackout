import type { Pack } from "../types";

export const eu: Pack = {
  id: "eu",
  name: "Europe",
  detectors: [
    {
      id: "eu.iban",
      label: "IBAN",
      pattern: /[A-Z]{2}\d{2}(?:[ \-‐-―]?[A-Z0-9]){11,44}/,
      groups: [15, 34],
      validator: "iban",
    },
  ],
};
