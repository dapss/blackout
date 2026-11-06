import type { Pack } from "../types";

export const de: Pack = {
  id: "de",
  name: "German",
  detectors: [],
  fields: [
    { id: "de.name", label: "Name", names: ["Vorname", "Nachname", "Familienname", "Vollständiger Name", "Geburtsname"] },
    { id: "de.address", label: "Address", names: ["Anschrift", "Wohnort", "Wohnadresse", "Straße"], multiline: true },
    { id: "de.birth", label: "Birth details", names: ["Geburtsdatum", "Geburtsort"] },
  ],
  otherLabels: ["Alter", "Telefon", "Tel.", "Geschlecht", "Staatsangehörigkeit", "Beruf", "Datum"],
};
