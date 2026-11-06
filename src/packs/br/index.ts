import type { Pack } from "../types";

// Portuguese labels, for Portugal as well as Brazil.
export const br: Pack = {
  id: "br",
  name: "Brazil and Portuguese",
  detectors: [{ id: "br.cpf", label: "CPF (Brazil)", pattern: /\d{3}\.\d{3}\.\d{3}-\d{2}/, validator: "cpf" }],
  fields: [
    { id: "br.cpf-labelled", label: "CPF (Brazil)", names: ["CPF"], value: /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/, validator: "cpf" },
    { id: "pt.name", label: "Name", names: ["Nome", "Nome Completo", "Nome da Mãe", "Nome do Pai", "Sobrenome", "Apelido"] },
    { id: "pt.address", label: "Address", names: ["Endereço", "Endereco", "Morada", "Residência", "Residencia"], multiline: true },
    { id: "pt.birth", label: "Birth details", names: ["Data de Nascimento", "Local de Nascimento", "Naturalidade"] },
  ],
  otherLabels: ["Idade", "Telefone", "Celular", "Sexo", "Nacionalidade", "Profissão", "Profissao", "Data", "RG", "Estado Civil"],
};
