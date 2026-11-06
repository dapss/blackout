import type { Pack } from "../types";

export const gb: Pack = {
  id: "gb",
  name: "United Kingdom",
  detectors: [
    { id: "gb.nino", label: "UK National Insurance number", pattern: /[A-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]/, validator: "nino" },
  ],
};
