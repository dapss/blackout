import { eu } from "./eu";
import { id } from "./id";
import { intl } from "./intl";
import type { Detector, Pack } from "./types";

// Card numbers before NIK: a checksum and issuer prefix are stronger evidence than NIK's structure.
export const PACKS: Pack[] = [eu, intl, id];

/** When two detectors match the same text, the earlier one wins. */
const all = PACKS.flatMap((p) => p.detectors);
export const DETECTORS: Detector[] = [...all.filter((d) => !d.loose), ...all.filter((d) => d.loose)];
