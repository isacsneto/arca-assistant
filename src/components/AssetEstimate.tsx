import { ChevronDown, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { ASSET_DETAIL_HINTS, type AssetEstimate, type PhysicalAsset } from "../../shared/assets";
import { amt, dateTime, safeUrl, amtCompact } from "../lib/format";
import { L, locale } from "../../shared/i18n";

export interface EstimateRun {
  status: string;
  last?: string;
}

const CONF = { alta: "ok", media: "warn", baixa: "bad" } as const;
/** Rótulo exibido da confiança (o valor salvo continua alta/media/baixa). */
const confLabel = (c: keyof typeof CONF) =>
  ({ alta: L("conf. alta", "high confidence"), media: L("conf. media", "med. confidence"), baixa: L("conf. baixa", "low confidence") })[c];
/** Rótulo exibido da condição do anúncio (valor salvo: novo/usado/…). */
const conditionLabel = (c: string) => (c === "novo" ? L("novo", "new") : c === "usado" ? L("usado", "used") : c === "referencia" ? L("referencia", "reference") : c);

/** Célula da coluna "Estimativa (IA)". */
export function EstimateCell({
  asset, run, error, disabled, open, onEstimate, onUse, onToggle,
}: {
  asset: PhysicalAsset;
  run?: EstimateRun;
  error?: string;
  disabled: boolean;
  open: boolean;
  onEstimate: () => void;
  onUse: (value: number) => void;
  onToggle: () => void;
}) {
  if (run)
    return (
      <div className="est-running">
        <span className="row" style={{ gap: 6 }}><Loader2 size={14} className="spin" /> {run.status}</span>
        {run.last && <div className="muted small est-last" title={run.last}>{run.last}</div>}
      </div>
    );

  const e = asset.estimate;
  if (!e)
    return (
      <div>
        <button className="btn sm" disabled={disabled} onClick={onEstimate} title={L("Pesquisar anúncios de novos e usados para sugerir um valor", "Search new and used listings to suggest a value")}>
          <Sparkles size={14} /> {L("Estimar", "Estimate")}
        </button>
        {error && <div className="small" style={{ color: "var(--bad)", marginTop: 4 }}>{error}</div>}
      </div>
    );

  const diff = asset.value > 0 ? ((e.estimate - asset.value) / asset.value) * 100 : 0;
  const same = Math.round(e.estimate) === Math.round(asset.value);
  return (
    <div>
      <div className="row" style={{ gap: 6 }}>
        <b className="num">{amt(Math.round(e.estimate))}</b>
        {!same && asset.value > 0 && (
          <span className={"chip " + (Math.abs(diff) < 5 ? "" : diff < 0 ? "bad" : "ok")} title={L("Diferença para o valor registrado", "Difference from the recorded value")}>
            {diff > 0 ? "+" : ""}{diff.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}%
          </span>
        )}
      </div>
      <div className="muted small num">
        {amtCompact(e.low)}–{amtCompact(e.high)} · <span className={"chip " + CONF[e.confidence]}>{confLabel(e.confidence)}</span>
      </div>
      <div className="row" style={{ gap: 4, marginTop: 4 }}>
        <button className="btn sm" disabled={same} onClick={() => onUse(Math.round(e.estimate))} title={L("Usar a estimativa como valor do bem", "Use the estimate as the asset value")}>{L("Usar", "Use")}</button>
        <button className="btn ghost icon sm" disabled={disabled} onClick={onEstimate} title={L(`Estimar de novo (última: ${dateTime(e.at)})`, `Estimate again (last: ${dateTime(e.at)})`)} aria-label={L("Estimar de novo", "Estimate again")}>
          <RefreshCw size={13} />
        </button>
        <button className="btn ghost sm" onClick={onToggle} aria-expanded={open}>
          {L("detalhes", "details")} <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : undefined }} />
        </button>
      </div>
      {e.confidence === "baixa" && (
        <div className="small est-hint" title={ASSET_DETAIL_HINTS[asset.type].needs}>
          {L("Faltam detalhes — informe", "Missing details — add")} {ASSET_DETAIL_HINTS[asset.type].short} {L("na Observação e estime de novo.", "in Notes and estimate again.")}
        </div>
      )}
      {error && <div className="small" style={{ color: "var(--bad)", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

/** Linha expandida com premissas, resumo e anúncios usados como comparação. */
export function EstimateDetails({ e }: { e: AssetEstimate }) {
  return (
    <div className="est-details">
      <div className="row wrap" style={{ gap: 16, marginBottom: 8 }}>
        <span><span className="muted small">{L("Novo hoje", "New today")}</span><br /><b className="num">{e.newPrice != null ? amt(Math.round(e.newPrice)) : "—"}</b></span>
        <span><span className="muted small">{L("Usados (mediana)", "Used (median)")}</span><br /><b className="num">{e.usedPrice != null ? amt(Math.round(e.usedPrice)) : "—"}</b></span>
        <span><span className="muted small">{L("Sugerido", "Suggested")}</span><br /><b className="num">{amt(Math.round(e.estimate))}</b></span>
        <span className="muted small" style={{ alignSelf: "flex-end" }}>{dateTime(e.at)} · {e.searches} {L("buscas", "searches")} · {e.model}</span>
      </div>
      <p className="small prose">{e.summary}</p>
      <p className="small muted" style={{ marginTop: 4 }}>{L("Premissas", "Assumptions")}: {e.assumptions}</p>
      {e.comparables.length > 0 && (
        <ul className="est-comps">
          {e.comparables.map((c, i) => {
            const href = safeUrl(c.url);
            return (
              <li key={i}>
                <span className={"chip " + (c.condition === "novo" ? "ok" : c.condition === "usado" ? "" : "warn")}>{conditionLabel(c.condition)}</span>{" "}
                <b className="num">{amt(Math.round(c.price))}</b>{" "}
                {href ? <a href={href} target="_blank" rel="noreferrer noopener">{c.title} <ExternalLink size={11} /></a> : <span>{c.title}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small" style={{ marginTop: 6 }}>{L("Estimativa automática a partir de anúncios públicos — confira os links antes de usar o valor.", "Automatic estimate from public listings — check the links before using the value.")}</p>
    </div>
  );
}
