import type { Pack } from "../types";

export const us: Pack = {
  id: "us",
  name: "United States",
  detectors: [
    // Only the dashed layout: as bare digits, 9 numbers could be anything.
    { id: "us.ssn", label: "US Social Security number", pattern: /\d{3}-\d{2}-\d{4}/, validator: "ssn" },
  ],
  fields: [
    {
      id: "us.ssn-labelled",
      label: "US Social Security number",
      names: ["SSN", "SS#", "Social Security Number", "Social Security No", "Social Security No."],
      value: /^\d{3}[ -]?\d{2}[ -]?\d{4}$/,
      validator: "ssn",
    },
  ],
};
