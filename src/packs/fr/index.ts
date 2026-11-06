import type { Pack } from "../types";

export const fr: Pack = {
  id: "fr",
  name: "France and French",
  detectors: [
    {
      id: "fr.nir",
      label: "French social security number",
      pattern: /[123478] ?\d{2} ?\d{2} ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}/,
      validator: "nir",
    },
  ],
  fields: [
    { id: "fr.name", label: "Name", names: ["Nom", "Prénom", "Prenom", "Prénoms", "Nom et Prénom", "Nom de Famille", "Nom de Jeune Fille", "Nom Complet"] },
    { id: "fr.address", label: "Address", names: ["Adresse", "Adresse Postale", "Domicile"], multiline: true },
    { id: "fr.birth", label: "Birth details", names: ["Date de Naissance", "Lieu de Naissance"] },
  ],
  otherLabels: ["Âge", "Téléphone", "Telephone", "Tél", "Tél.", "Courriel", "Sexe", "Nationalité", "Profession", "Fonction"],
};
