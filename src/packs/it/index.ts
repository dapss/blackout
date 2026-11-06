import type { Pack } from "../types";

export const it: Pack = {
  id: "it",
  name: "Italian",
  detectors: [],
  fields: [
    { id: "it.tax", label: "Codice Fiscale (Italy)", names: ["Codice Fiscale"], value: /^[A-Za-z0-9]{16}$/ },
    { id: "it.name", label: "Name", names: ["Cognome", "Nome e Cognome"] },
    { id: "it.address", label: "Address", names: ["Indirizzo", "Residenza"], multiline: true },
    { id: "it.birth", label: "Birth details", names: ["Data di Nascita", "Luogo di Nascita"] },
  ],
  otherLabels: ["Età", "Sesso", "Nazionalità", "Professione"],
};
