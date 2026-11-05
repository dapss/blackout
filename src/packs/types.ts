import type { ValidatorName } from "./validators";

export interface Detector {
  /** Unique across all packs, written `<pack>.<name>`. */
  id: string;
  /** What the review panel calls a finding. */
  label: string;
  /** What a candidate looks like. Don't anchor it or set the `g` flag; the engine scans the whole line. */
  pattern: RegExp;
  /** Name of a check in `validators.ts`. Without one, every pattern match counts as a finding. */
  validator?: ValidatorName;
  /**
   * For values printed in separated groups, such as `4111 1111 1111 1111`. A match may run on into
   * unrelated text, so each run of whole groups is tried, longest first, with this many letters and
   * digits in total ([min, max]). The value can't start or end in the middle of a group.
   */
  groups?: [min: number, max: number];
  /**
   * For formats with no real check. These run after all the others so they never take text from a
   * stricter detector, and they ignore a match that directly follows another number.
   */
  loose?: boolean;
}

export interface Pack {
  /** `<cc>` in `src/packs/<cc>`, or `intl` for formats used everywhere. */
  id: string;
  name: string;
  detectors: Detector[];
}

/** Digit groups joined by one space or hyphen, for detectors using `groups`. */
export const NUMBER_GROUPS = /\d+(?:[ \-‐-―]\d+)*/;
