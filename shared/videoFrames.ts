import { hamming } from "./dupes";

/*
 * Vídeo de tela (rolando o app do banco) → poucos quadros que cobrem todo o conteúdo.
 * Amostramos o vídeo em intervalos fixos e calculamos o dHash de cada amostra.
 * Um quadro entra quando a tela "parou" (quase igual à amostra anterior — sem borrão
 * de rolagem) e mostra algo novo em relação ao último quadro escolhido. Em rolagem
 * contínua, sem pausas, entra mesmo sem parar, para não perder trechos.
 */

export interface FrameSample {
  /** Segundos desde o início do vídeo. */
  t: number;
  /** dHash (hex) da amostra. */
  hash: string;
}

export interface PickOptions {
  /** Fração de bits diferentes até a qual a tela é considerada parada. */
  still?: number;
  /** Fração de bits diferentes a partir da qual a tela é considerada nova. */
  fresh?: number;
  /** Segundos sem quadro novo a partir dos quais aceitamos um quadro em movimento. */
  maxGap?: number;
  /** Máximo de quadros devolvidos. */
  max?: number;
}

export const VIDEO_SAMPLE_STEP = 0.5;
export const VIDEO_MAX_FRAMES = 20;
export const MAX_VIDEO_SECONDS = 15 * 60;

/** Índices (em `samples`, em ordem) dos quadros a enviar para a IA. */
export function pickFrames(samples: FrameSample[], opts: PickOptions = {}): number[] {
  if (!samples.length) return [];
  const bits = samples[0].hash.length * 4;
  const still = Math.round(bits * (opts.still ?? 0.06));
  const fresh = Math.round(bits * (opts.fresh ?? 0.25));
  const maxGap = opts.maxGap ?? 2.5;
  const max = opts.max ?? VIDEO_MAX_FRAMES;

  const settled = (i: number) => i > 0 && hamming(samples[i].hash, samples[i - 1].hash) <= still;
  // Primeiro quadro: o primeiro parado no começo do vídeo (ou a primeira amostra).
  let first = samples.findIndex((s, i) => s.t - samples[0].t <= maxGap && settled(i));
  if (first < 0) first = 0;
  const picked = [first];
  const last = () => samples[picked[picked.length - 1]];
  for (let i = first + 1; i < samples.length; i += 1) {
    const s = samples[i];
    const isNew = hamming(s.hash, last().hash) >= fresh;
    if (isNew && (settled(i) || s.t - last().t >= maxGap)) picked.push(i);
  }
  // Último trecho do vídeo em movimento: garante o fim da rolagem.
  const end = samples.length - 1;
  if (picked[picked.length - 1] !== end && hamming(samples[end].hash, last().hash) >= fresh) picked.push(end);
  return evenly(picked, max);
}

/** Reduz a lista a `max` itens espaçados por igual, mantendo o primeiro e o último. */
export function evenly<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  if (max <= 1) return list.slice(0, max);
  return Array.from({ length: max }, (_, k) => list[Math.round((k * (list.length - 1)) / (max - 1))]);
}

/** "1:05" para 65 s. */
export function clock(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Nome do quadro: mantém o nome do vídeo (convenção banco-pf vale para ele) + número. */
export function frameName(videoName: string, n: number): string {
  const base = videoName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,5}$/i, "") || "video";
  return `${base}-quadro${String(n).padStart(2, "0")}.jpg`;
}

export const isVideoName = (name: string) => /\.(mp4|m4v|mov|webm|mkv|avi|3gp)$/i.test(name);
