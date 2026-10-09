import type { UploadFile } from "../../shared/types";

export interface PreparedFile extends UploadFile {
  id: string;
  preview?: string; // object URL para miniatura
  size: number;
}

const MAX_DIM = 2200;
const MAX_RAW_BYTES = 3.5 * 1024 * 1024;

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function prepareImage(file: File): Promise<Pick<PreparedFile, "mediaType" | "data">> {
  const supported = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const bmp = await createImageBitmap(file);
  const small = file.size <= MAX_RAW_BYTES && Math.max(bmp.width, bmp.height) <= MAX_DIM;
  if (small && supported.includes(file.type)) {
    bmp.close();
    return { mediaType: file.type, data: await readAsBase64(file) };
  }
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Falha ao converter imagem"))), "image/jpeg", 0.9),
  );
  return { mediaType: "image/jpeg", data: await readAsBase64(blob) };
}

async function decodeText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf); // CSVs de bancos costumam vir em Latin-1
  }
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  const id = crypto.randomUUID();
  const name = file.name || `colado-${Date.now()}.png`;
  const lower = name.toLowerCase();

  if (file.type.startsWith("image/")) {
    const img = await prepareImage(file);
    return { id, name, kind: "image", size: file.size, preview: URL.createObjectURL(file), ...img };
  }
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    if (file.size > 30 * 1024 * 1024) throw new Error(`${name}: PDF acima de 30 MB.`);
    return { id, name, kind: "pdf", size: file.size, mediaType: "application/pdf", data: await readAsBase64(file) };
  }
  if (/\.(xlsx|xlsm|xls|ods)$/.test(lower)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const text = wb.SheetNames.map(
      (n) => `# Planilha: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`,
    ).join("\n\n");
    return { id, name, kind: "text", size: file.size, data: text };
  }
  if (/\.(csv|tsv|txt|ofx|json)$/.test(lower) || file.type.startsWith("text/")) {
    return { id, name, kind: "text", size: file.size, data: await decodeText(file) };
  }
  throw new Error(`${name}: formato não suportado (use imagem, PDF, CSV ou XLSX).`);
}
