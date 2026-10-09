import { ChevronDown, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { AssetEstimate, PhysicalAsset } from "../../shared/assets";
import { brl, dateTime, safeUrl } from "../lib/format";

export interface EstimateRun {
  status: string;
  last?: string;
}

const compact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const CONF = { alta: "ok", media: "warn", baixa: "bad" } as const;

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
        <button className="btn sm" disabled={disabled} onClick={onEstimate} title="Pesquisar anúncios de novos e usados para sugerir um valor">
          <Sparkles size={14} /> Estimar
        </button>
        {error && <div className="small" style={{ color: "var(--bad)", marginTop: 4 }}>{error}</div>}
      </div>
    );

  const diff = asset.value > 0 ? ((e.estimate - asset.value) / asset.value) * 100 : 0;
  const same = Math.round(e.estimate) === Math.round(asset.value);
  return (
    <div>
      <div className="row" style={{ gap: 6 }}>
        <b className="num">{brl(Math.round(e.estimate))}</b>
        {!same && asset.value > 0 && (
          <span className={"chip " + (Math.abs(diff) < 5 ? "" : diff < 0 ? "bad" : "ok")} title="Diferença para o valor registrado">
            {diff > 0 ? "+" : ""}{diff.toFixed(1).replace(".", ",")}%
          </span>
        )}
      </div>
      <div className="muted small num">
        {compact.format(e.low)}–{compact.format(e.high)} · <span className={"chip " + CONF[e.confidence]}>conf. {e.confidence}</span>
      </div>
      <div className="row" style={{ gap: 4, marginTop: 4 }}>
        <button className="btn sm" disabled={same} onClick={() => onUse(Math.round(e.estimate))} title="Usar a estimativa como valor do bem">Usar</button>
        <button className="btn ghost icon sm" disabled={disabled} onClick={onEstimate} title={`Estimar de novo (última: ${dateTime(e.at)})`} aria-label="Estimar de novo">
          <RefreshCw size={13} />
        </button>
        <button className="btn ghost sm" onClick={onToggle} aria-expanded={open}>
          detalhes <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : undefined }} />
        </button>
      </div>
      {error && <div className="small" style={{ color: "var(--bad)", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

/** Linha expandida com premissas, resumo e anúncios usados como comparação. */
export function EstimateDetails({ e }: { e: AssetEstimate }) {
  return (
    <div className="est-details">
      <div className="row wrap" style={{ gap: 16, marginBottom: 8 }}>
        <span><span className="muted small">Novo hoje</span><br /><b className="num">{e.newPrice != null ? brl(Math.round(e.newPrice)) : "—"}</b></span>
        <span><span className="muted small">Usados (mediana)</span><br /><b className="num">{e.usedPrice != null ? brl(Math.round(e.usedPrice)) : "—"}</b></span>
        <span><span className="muted small">Sugerido</span><br /><b className="num">{brl(Math.round(e.estimate))}</b></span>
        <span className="muted small" style={{ alignSelf: "flex-end" }}>{dateTime(e.at)} · {e.searches} buscas · {e.model}</span>
      </div>
      <p className="small prose">{e.summary}</p>
      <p className="small muted" style={{ marginTop: 4 }}>Premissas: {e.assumptions}</p>
      {e.comparables.length > 0 && (
        <ul className="est-comps">
          {e.comparables.map((c, i) => {
            const href = safeUrl(c.url);
            return (
              <li key={i}>
                <span className={"chip " + (c.condition === "novo" ? "ok" : c.condition === "usado" ? "" : "warn")}>{c.condition}</span>{" "}
                <b className="num">{brl(Math.round(c.price))}</b>{" "}
                {href ? <a href={href} target="_blank" rel="noreferrer noopener">{c.title} <ExternalLink size={11} /></a> : <span>{c.title}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small" style={{ marginTop: 6 }}>Estimativa automática a partir de anúncios públicos — confira os links antes de usar o valor.</p>
    </div>
  );
}
