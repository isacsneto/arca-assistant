import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess } from "./ai/proc";
import { L } from "../shared/i18n";

/*
 * Plano B para vídeos que o navegador não decodifica (ex.: .mov HEVC do iPhone em
 * alguns PCs): o ffmpeg extrai amostras em intervalos fixos e o navegador escolhe
 * os quadros (mesma lógica do caminho principal).
 */

export interface VideoSample {
  t: number;
  /** JPEG em base64. */
  data: string;
}

/** Máximo de amostras por vídeo: vídeos longos são amostrados com intervalo maior. */
export const MAX_SAMPLES = 240;

export class VideoError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
  const p = typeof mod === "string" ? mod : mod.default;
  // O binário vem do script de instalação do pacote; o npm pode ter bloqueado esse script.
  if (!p || !(await fs.stat(p).catch(() => null)))
    throw new VideoError(L("O navegador não abriu este vídeo e o ffmpeg não está instalado (rode: npm approve-scripts ffmpeg-static && npm rebuild ffmpeg-static). Ou grave/converta o vídeo em MP4.", "The browser couldn't open this video and ffmpeg isn't installed (run: npm approve-scripts ffmpeg-static && npm rebuild ffmpeg-static). Or record/convert the video to MP4."), 501);
  return p;
}

/** Duração em segundos, lida do cabeçalho que o ffmpeg imprime. */
export function parseDuration(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Intervalo entre amostras: `base`, ou maior para caber em MAX_SAMPLES. */
export function sampleStep(duration: number, base: number): number {
  return Math.max(base, Math.ceil((duration / MAX_SAMPLES) * 10) / 10);
}

export async function sampleVideo(bytes: Buffer, opts: { step: number; signal?: AbortSignal }): Promise<VideoSample[]> {
  const ffmpeg = await ffmpegPath();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arca-video-"));
  try {
    const input = path.join(dir, "input");
    await fs.writeFile(input, bytes);
    const probe = await runProcess(ffmpeg, ["-hide_banner", "-i", input], { cwd: dir, env: process.env, signal: opts.signal });
    const duration = parseDuration(probe.stderr);
    if (!duration) throw new VideoError(L("Não consegui ler este vídeo. Tente gravar em MP4.", "Couldn't read this video. Try recording in MP4."));
    if (duration > 15 * 60) throw new VideoError(L("Vídeo longo demais (máximo 15 minutos).", "Video too long (15 minutes max)."));
    const step = sampleStep(duration, opts.step);
    // Lado maior até 1600 px: suficiente para ler texto de tela de celular.
    const scale = "scale='if(gte(iw,ih),min(1600,iw),-2)':'if(gte(iw,ih),-2,min(1600,ih))'";
    const run = await runProcess(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-i", input, "-vf", `fps=1/${step},${scale}`, "-q:v", "4", path.join(dir, "f_%04d.jpg")],
      { cwd: dir, env: process.env, signal: opts.signal },
    );
    if (run.code !== 0) throw new VideoError(L("O ffmpeg não conseguiu extrair quadros deste vídeo.", "ffmpeg couldn't extract frames from this video."));
    const names = (await fs.readdir(dir)).filter((n) => n.startsWith("f_")).sort();
    return Promise.all(
      names.map(async (n, i) => ({ t: Math.round(i * step * 10) / 10, data: (await fs.readFile(path.join(dir, n))).toString("base64") })),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
