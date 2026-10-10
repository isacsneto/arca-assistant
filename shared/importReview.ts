import { applyFileReadings, describeHint, parseFileName } from "./fileHints";
import type { ExtractionResult, FileReading, ImportQuestion } from "./types";
import { clock } from "./videoFrames";

const MAX_QUESTIONS = 6;

/**
 * Deixa a resposta do Claude consistente antes de mostrar ao usuário:
 * - garante uma leitura por arquivo enviado (completando com a leitura do nome);
 * - aplica instituição/titular de cada arquivo aos seus itens;
 * - descarta perguntas que não apontam para itens válidos e limita a quantidade;
 * - ignora "duplicateOf" que aponte para arquivo inexistente ou para ele mesmo.
 */
export function finalizeExtraction(data: ExtractionResult, fileNames: string[]): ExtractionResult {
  const names = new Set(fileNames);
  const byFile = new Map(data.files.filter((f) => names.has(f.file)).map((f) => [f.file, f]));

  const files: FileReading[] = fileNames.map((name) => {
    const r = byFile.get(name);
    const h = parseFileName(name);
    const dup = r?.duplicateOf && r.duplicateOf !== name && names.has(r.duplicateOf) ? r.duplicateOf : null;
    return {
      file: name,
      institution: r?.institution ?? h.institution,
      owner: r?.owner ?? h.owner,
      productHint: r?.productHint ?? h.hint,
      summary: r?.summary ?? "",
      duplicateOf: dup,
    };
  });

  const items = applyFileReadings(data.items, fileNames, files);
  const questions: ImportQuestion[] = data.questions
    .map((q) => ({ ...q, itemIndexes: [...new Set(q.itemIndexes)].filter((i) => Number.isInteger(i) && i >= 0 && i < items.length) }))
    .filter((q) => q.question.trim() && (q.itemIndexes.length > 0 || /titular|institui|arquivo/i.test(q.question)))
    .slice(0, MAX_QUESTIONS)
    .map((q, i) => ({ ...q, id: q.id || `q${i + 1}`, options: q.options.filter(Boolean).slice(0, 4) }));

  return { ...data, items, files, questions };
}

/** Linha do prompt com a leitura automática do nome, para o Claude confirmar ou corrigir. */
export function fileNameNote(name: string, looksLike?: string, video?: { source: string; at: number }): string {
  const d = describeHint(parseFileName(name));
  const parts = [
    d ? `leitura automática do nome: ${d}` : "nome sem a convenção banco-pf/pj",
    video
      ? `quadro do vídeo "${video.source}" em ${clock(video.at)} — quadros seguidos do mesmo vídeo mostram a mesma tela rolada e se sobrepõem: conte cada ativo uma vez só e não marque duplicateOf só por sobreposição parcial`
      : null,
    looksLike ? `visualmente quase idêntico a "${looksLike}" — confira se é duplicado` : null,
  ].filter(Boolean);
  return ` [${parts.join("; ")}]`;
}
