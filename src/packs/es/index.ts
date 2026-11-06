import type { Pack } from "../types";

// Spanish labels, for Latin America as well as Spain.
export const es: Pack = {
  id: "es",
  name: "Spain and Spanish",
  detectors: [
    { id: "es.dni", label: "DNI (Spain)", pattern: /\d{8}[ -]?[A-Z]/, validator: "dni" },
    { id: "es.nie", label: "NIE (Spain)", pattern: /[XYZ][ -]?\d{7}[ -]?[A-Z]/, validator: "nie" },
  ],
  fields: [
    { id: "es.name", label: "Name", names: ["Nombre", "Nombre Completo", "Nombre y Apellidos", "Apellido", "Apellidos"] },
    { id: "es.address", label: "Address", names: ["Dirección", "Direccion", "Domicilio"], multiline: true },
    { id: "es.birth", label: "Birth details", names: ["Fecha de Nacimiento", "Lugar de Nacimiento"] },
  ],
  otherLabels: ["DNI", "NIE", "Edad", "Teléfono", "Telefono", "Correo", "Correo Electrónico", "Nacionalidad", "Profesión", "Profesion", "Fecha", "Cargo"],
};
