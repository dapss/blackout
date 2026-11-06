import { br } from "./br";
import { de } from "./de";
import { es } from "./es";
import { eu } from "./eu";
import { fr } from "./fr";
import { gb } from "./gb";
import { id } from "./id";
import { india } from "./in";
import { intl } from "./intl";
import { it } from "./it";
import { us } from "./us";
import type { Detector, Field, Pack } from "./types";

// Card numbers before NIK: a checksum and issuer prefix are stronger evidence than NIK's structure.
export const PACKS: Pack[] = [eu, intl, us, gb, india, br, es, fr, de, it, id];

/** When two detectors match the same text, the earlier one wins. */
const all = PACKS.flatMap((p) => p.detectors);
export const DETECTORS: Detector[] = [...all.filter((d) => !d.loose), ...all.filter((d) => d.loose)];

export const FIELDS: Field[] = PACKS.flatMap((p) => p.fields ?? []);
export const OTHER_LABELS: string[] = PACKS.flatMap((p) => p.otherLabels ?? []);
