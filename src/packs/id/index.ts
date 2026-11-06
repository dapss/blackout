import { NUMBER_GROUPS, type Pack } from "../types";

export const id: Pack = {
  id: "id",
  name: "Indonesia",
  detectors: [
    { id: "id.nik", label: "NIK (Indonesian ID)", pattern: NUMBER_GROUPS, groups: [16, 16], validator: "nik" },
    // Only the dotted layout: as bare digits, 15 numbers with no checksum could be anything.
    // Three leading digits is the 16-digit form, the old number with a 0 in front.
    { id: "id.npwp", label: "NPWP (Indonesian tax ID)", pattern: /\d{2,3}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}/, validator: "npwp" },
  ],
  fields: [
    { id: "id.npwp-labelled", label: "NPWP (Indonesian tax ID)", names: ["NPWP"], value: /^\d[\d .\-]{13,21}\d$/, validator: "npwpLabelled" },
    { id: "id.name", label: "Name", names: ["Nama", "Nama Lengkap", "Nama Ibu Kandung", "Nama Ayah", "Nama Suami", "Nama Istri"] },
    {
      id: "id.address",
      label: "Address",
      names: ["Alamat", "Alamat Lengkap", "Alamat Rumah", "Alamat Domisili", "Alamat KTP", "Domisili"],
      multiline: true,
    },
    {
      id: "id.birth",
      label: "Birth details",
      names: ["Tanggal Lahir", "Tgl Lahir", "Tgl. Lahir", "Tempat Lahir", "Tempat/Tgl Lahir", "Tempat/Tgl. Lahir", "Tempat/Tanggal Lahir", "Tempat, Tanggal Lahir", "Tempat Tanggal Lahir", "TTL"],
    },
  ],
  otherLabels: ["NIK", "Telepon", "Telp", "Telp.", "HP", "No. HP", "Tanggal", "Tgl", "Umur", "Usia", "Pekerjaan", "Agama", "Status", "Jenis Kelamin", "Kewarganegaraan", "Jabatan", "Golongan Darah"],
};
