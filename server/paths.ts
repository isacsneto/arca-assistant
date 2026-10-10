import path from "node:path";

/**
 * Pasta de dados do app. `ARCA_DATA_DIR` permite rodar uma instância separada
 * (ex.: demo com dados fictícios) sem tocar nos dados reais.
 */
export function dataDir(): string {
  return path.resolve(process.cwd(), process.env.ARCA_DATA_DIR || "data");
}

export const stateFile = () => path.join(dataDir(), "state.json");
export const attachmentsRoot = () => path.join(dataDir(), "attachments");
export const secretsFile = () => path.join(dataDir(), "secrets.json");
