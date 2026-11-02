/** "PETR4 · Petrobras"; só o ticker quando o nome é o próprio ticker (posições do Open Finance). Sem dependências: usado em todo lugar. */
export function positionLabel(p: { ticker?: string | null; name: string }): string {
  const t = p.ticker?.trim();
  return t && t.toUpperCase() !== p.name.trim().toUpperCase() ? `${t} · ${p.name}` : p.name;
}
