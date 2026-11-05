import { NUMBER_GROUPS, type Pack } from "../types";

export const id: Pack = {
  id: "id",
  name: "Indonesia",
  detectors: [
    { id: "id.nik", label: "NIK (Indonesian ID)", pattern: NUMBER_GROUPS, groups: [16, 16], validator: "nik" },
    // Only the dotted layout: as bare digits, 15 numbers with no checksum could be anything.
    { id: "id.npwp", label: "NPWP (Indonesian tax ID)", pattern: /\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}/, validator: "npwp" },
  ],
};
