import type { UploadFile } from "../../shared/types";
import { L } from "../../shared/i18n";

export interface PreparedFile extends UploadFile {
  id: string;
  preview?: string; // object URL para miniatura
  size: number;
  /** SHA-256 do arquivo original (duplicado exato). */
  sha: string;
  /** Hash visual (prints quase iguais) e proporção. Só imagens. */
  dhash?: string;
  aspect?: number;
}

async function sha256(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const HASH = 16; // grade 16×16 = 256 bits

let hashCanvas: HTMLCanvasElement | null = null;

/** dHash: reduz a 17×16 em tons de cinza e compara cada pixel com o vizinho da direita. */
export function dhashOf(source: CanvasImageSource): string {
  hashCanvas ??= Object.assign(document.createElement("canvas"), { width: HASH + 1, height: HASH });
  const ctx = hashCanvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, HASH + 1, HASH);
  const px = ctx.getImageData(0, 0, HASH + 1, HASH).data;
  const gray = (x: number, y: number) => {
    const i = (y * (HASH + 1) + x) * 4;
    return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
  };
  let hex = "";
  for (let y = 0; y < HASH; y += 1) {
    for (let x = 0; x < HASH; x += 4) {
      let nibble = 0;
      for (let k = 0; k < 4; k += 1) nibble = (nibble << 1) | (gray(x + k, y) > gray(x + k + 1, y) ? 1 : 0);
      hex += nibble.toString(16);
    }
  }
  return hex;
}

async function visualHash(file: Blob): Promise<{ dhash?: string; aspect?: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const aspect = bmp.width / bmp.height;
    const dhash = dhashOf(bmp);
    bmp.close();
    return { dhash, aspect };
  } catch {
    return {};
  }
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
    canvas.toBlob((b) => (b ? res(b) : rej(new Error(L("Falha ao converter imagem", "Failed to convert image")))), "image/jpeg", 0.9),
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
    return { id, name, kind: "image", size: file.size, preview: URL.createObjectURL(file), sha: await sha256(file), ...(await visualHash(file)), ...img };
  }
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    if (file.size > 30 * 1024 * 1024) throw new Error(L(`${name}: PDF acima de 30 MB.`, `${name}: PDF over 30 MB.`));
    return { id, name, kind: "pdf", size: file.size, sha: await sha256(file), mediaType: "application/pdf", data: await readAsBase64(file) };
  }
  if (/\.(xlsx|xlsm|xls|ods)$/.test(lower)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const text = wb.SheetNames.map(
      (n) => `# Planilha: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`,
    ).join("\n\n");
    return { id, name, kind: "text", size: file.size, sha: await sha256(file), data: text };
  }
  if (/\.(csv|tsv|txt|ofx|json)$/.test(lower) || file.type.startsWith("text/")) {
    return { id, name, kind: "text", size: file.size, sha: await sha256(file), data: await decodeText(file) };
  }
  throw new Error(L(`${name}: formato não suportado (use imagem, vídeo, PDF, CSV ou XLSX).`, `${name}: unsupported format (use image, video, PDF, CSV or XLSX).`));
}
