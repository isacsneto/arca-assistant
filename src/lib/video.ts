import { MAX_VIDEO_SECONDS, VIDEO_SAMPLE_STEP, frameName, pickFrames, type FrameSample } from "../../shared/videoFrames";
import { dhashOf } from "./files";
import { L } from "../../shared/i18n";

/*
 * Vídeo de tela → quadros (JPEG) para a IA ler como prints.
 * Caminho principal: o próprio navegador decodifica e amostra o vídeo.
 * Plano B: formatos que o navegador não abre (ex.: .mov HEVC) vão para o servidor (ffmpeg).
 */

export interface VideoFrame {
  file: File;
  at: number;
}

type Progress = (text: string) => void;

const MAX_SIDE = 2000;

function once(el: HTMLVideoElement, ok: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      el.removeEventListener(ok, onOk);
      el.removeEventListener("error", onErr);
      fn();
    };
    const onOk = () => done(resolve);
    const onErr = () => done(() => reject(new Error(L("vídeo não suportado pelo navegador", "video not supported by the browser"))));
    const timer = setTimeout(() => done(() => reject(new Error(L("tempo esgotado ao ler o vídeo", "timed out reading the video")))), timeoutMs);
    el.addEventListener(ok, onOk);
    el.addEventListener("error", onErr);
  });
}

async function seek(el: HTMLVideoElement, t: number) {
  const p = once(el, "seeked", 10_000);
  el.currentTime = t;
  await p;
}

function toJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(w * scale), height: Math.round(h * scale) });
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(L("falha ao gerar o quadro", "failed to generate the frame")))), "image/jpeg", 0.88));
}

/** Duração real (vídeos do MediaRecorder às vezes informam Infinity até buscar o fim). */
async function durationOf(el: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  await seek(el, 1e7).catch(() => undefined);
  const d = el.duration;
  await seek(el, 0).catch(() => undefined);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

async function inBrowser(file: File, progress: Progress): Promise<VideoFrame[]> {
  const url = URL.createObjectURL(file);
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  try {
    progress(L(`Abrindo o vídeo ${file.name}…`, `Opening video ${file.name}…`));
    // Formato que o navegador não decodifica costuma travar aqui: o plano B (servidor) assume.
    const meta = once(el, "loadeddata", 8_000);
    el.src = url;
    await meta;
    if (!el.videoWidth || !el.videoHeight) throw new Error(L("vídeo sem imagem decodificável", "video has no decodable image"));
    const duration = await durationOf(el);
    if (!duration) throw new Error(L("duração desconhecida", "unknown duration"));
    if (duration > MAX_VIDEO_SECONDS) throw new TooLong();
    const step = Math.max(VIDEO_SAMPLE_STEP, duration / 240);
    // 1ª passada: só o hash de cada amostra (rápido, pouca memória).
    const samples: FrameSample[] = [];
    for (let t = 0; t < duration; t += step) {
      await seek(el, Math.min(t, duration - 0.05));
      samples.push({ t, hash: dhashOf(el) });
      progress(L(`Analisando o vídeo ${file.name}… ${Math.round((t / duration) * 100)}%`, `Analyzing video ${file.name}… ${Math.round((t / duration) * 100)}%`));
    }
    // 2ª passada: quadros escolhidos em resolução cheia.
    const picked = pickFrames(samples);
    const frames: VideoFrame[] = [];
    for (const [n, i] of picked.entries()) {
      const { t } = samples[i];
      await seek(el, Math.min(t, duration - 0.05));
      const blob = await toJpeg(el, el.videoWidth, el.videoHeight);
      frames.push({ file: new File([blob], frameName(file.name, n + 1), { type: "image/jpeg" }), at: t });
      progress(L(`Extraindo quadros de ${file.name}… ${n + 1}/${picked.length}`, `Extracting frames from ${file.name}… ${n + 1}/${picked.length}`));
    }
    return frames;
  } finally {
    el.removeAttribute("src");
    el.load();
    URL.revokeObjectURL(url);
  }
}

class TooLong extends Error {
  constructor() {
    super(L(`vídeo longo demais (máximo ${MAX_VIDEO_SECONDS / 60} minutos)`, `video too long (maximum ${MAX_VIDEO_SECONDS / 60} minutes)`));
  }
}

async function onServer(file: File, progress: Progress): Promise<VideoFrame[]> {
  progress(L(`Convertendo ${file.name} no servidor…`, `Converting ${file.name} on the server…`));
  const res = await fetch("/api/video/frames", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
  const body = (await res.json().catch(() => ({}))) as { samples?: { t: number; data: string }[]; error?: string };
  if (!res.ok || !body.samples) throw new Error(body.error ?? L(`Erro ${res.status}`, `Error ${res.status}`));
  const decoded = await Promise.all(
    body.samples.map(async (s) => {
      const blob = new Blob([Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0))], { type: "image/jpeg" });
      const bmp = await createImageBitmap(blob);
      const hash = dhashOf(bmp);
      bmp.close();
      return { t: s.t, hash, blob };
    }),
  );
  return pickFrames(decoded).map((i, n) => ({
    file: new File([decoded[i].blob], frameName(file.name, n + 1), { type: "image/jpeg" }),
    at: decoded[i].t,
  }));
}

/** Quadros de um vídeo de tela, prontos para entrar no lote como imagens. */
export async function videoFrames(file: File, progress: Progress): Promise<VideoFrame[]> {
  try {
    return await inBrowser(file, progress);
  } catch (e) {
    if (e instanceof TooLong) throw new Error(`${file.name}: ${e.message}.`);
    try {
      return await onServer(file, progress);
    } catch (e2) {
      throw new Error(`${file.name}: ${(e2 as Error).message}`);
    }
  }
}
