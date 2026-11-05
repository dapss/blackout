import { NUMBER_GROUPS, type Pack } from "../types";

export const intl: Pack = {
  id: "intl",
  name: "International",
  detectors: [
    { id: "intl.card", label: "Card number", pattern: NUMBER_GROUPS, groups: [13, 19], validator: "card" },
    {
      id: "intl.email",
      label: "Email",
      pattern: /[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9\-]{1,63}(?:\.[A-Za-z0-9\-]{1,63}){0,8}\.[A-Za-z]{2,24}/,
      validator: "email",
    },
    {
      id: "intl.phone",
      label: "Phone number",
      // In order: +country code; 0 trunk prefix with separators; Indonesian mobile, which is often
      // printed unbroken; North American 3-3-4. Other unbroken digit strings are too ambiguous to flag.
      pattern:
        /\+\d[\d ().\-]{6,22}\d|\(?0\d{1,4}\)?[ .\-]\d{2,4}(?:[ .\-]\d{2,4}){1,3}|08[1-9]\d{7,10}|\(?[2-9]\d{2}\)?[ .\-]\d{3}[ .\-]\d{4}/,
      validator: "phone",
      loose: true,
    },
  ],
};
