/*
 * Detecção de arquivos duplicados no upload, antes de gastar uma chamada ao Claude.
 * - sha: hash exato do conteúdo (SHA-256) → arquivo idêntico, é descartado.
 * - dhash: "difference hash" da imagem reduzida (16×16 = 256 bits) → prints quase
 *   iguais (o mesmo screenshot recomprimido, redimensionado ou com leve diferença).
 *   Prints de texto em fundo claro se parecem muito num hash pequeno, por isso o
 *   hash é maior e também exigimos a mesma proporção largura/altura.
 */

export interface Fingerprint {
  id: string;
  name: string;
  sha: string;
  /** Dígitos hex do dHash; só imagens. */
  dhash?: string;
  /** Largura ÷ altura da imagem original. */
  aspect?: number;
}

/** Fração máxima de bits diferentes para contar como "quase idênticos". */
export const NEAR_DUP_RATIO = 0.08;
/** Diferença relativa máxima de proporção entre dois prints da mesma tela. */
export const ASPECT_TOLERANCE = 0.03;

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    let x = parseInt(a[i] ?? "0", 16) ^ parseInt(b[i] ?? "0", 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function looksAlike(a: Fingerprint, b: Fingerprint): boolean {
  if (!a.dhash || !b.dhash || a.dhash.length !== b.dhash.length) return false;
  if (a.aspect && b.aspect && Math.abs(a.aspect - b.aspect) / Math.max(a.aspect, b.aspect) > ASPECT_TOLERANCE) return false;
  return hamming(a.dhash, b.dhash) <= Math.round(a.dhash.length * 4 * NEAR_DUP_RATIO);
}

export interface DupCheck<F extends Fingerprint> {
  /** Arquivos novos aceitos (com `looksLike` quando parecem outro). */
  accepted: (F & { looksLike?: string })[];
  /** Arquivos idênticos a outro já presente, descartados. */
  exact: { file: F; sameAs: string }[];
}

/** Classifica arquivos recém-adicionados em relação aos que já estão no lote (e entre si). */
export function checkDuplicates<F extends Fingerprint>(existing: Fingerprint[], incoming: F[]): DupCheck<F> {
  const pool: Fingerprint[] = [...existing];
  const accepted: (F & { looksLike?: string })[] = [];
  const exact: { file: F; sameAs: string }[] = [];

  for (const f of incoming) {
    const same = pool.find((p) => p.sha === f.sha);
    if (same) {
      exact.push({ file: f, sameAs: same.name });
      continue;
    }
    const near = pool.find((p) => looksAlike(p, f));
    accepted.push(near ? { ...f, looksLike: near.name } : f);
    pool.push(f);
  }
  return { accepted, exact };
}

/** Garante nomes únicos no lote (o Claude referencia os itens pelo nome do arquivo). */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const m = name.match(/^(.*?)(\.[^.]+)?$/)!;
  for (let i = 2; ; i += 1) {
    const candidate = `${m[1]} (${i})${m[2] ?? ""}`;
    if (!taken.has(candidate)) return candidate;
  }
}
