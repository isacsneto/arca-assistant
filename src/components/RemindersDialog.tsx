import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, CalendarCheck, Check, Upload, X } from "lucide-react";
import type { Owner } from "../../shared/types";
import { daysSince, isReviewDue, markStale, unmarkStale } from "../../shared/reminders";
import { useStore } from "../store";

/**
 * Aviso ao abrir o app: instituições marcadas como desatualizadas e,
 * a cada 1 ou 2 semanas, a pergunta "está tudo atualizado?".
 */
export function RemindersDialog({ onUpdate }: { onUpdate: (target: { institution: string; owner: Owner }) => void }) {
  const { state, update } = useStore();
  const settings = state!.settings;
  const now = useMemo(() => new Date(), []);
  // Decide uma vez por carregamento da página: "Depois" fecha até o próximo refresh.
  const [open, setOpen] = useState(() => settings.staleInstitutions.length > 0 || isReviewDue(settings, now));
  const [reviewDone, setReviewDone] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const firstButton = useRef<HTMLButtonElement>(null);

  const stale = settings.staleInstitutions;
  const reviewDue = isReviewDue(settings, now) && !reviewDone;

  /** Instituições da carteira, por titular, para a revisão periódica. */
  const institutions = useMemo(() => {
    const seen = new Map<string, { institution: string; owner: Owner }>();
    for (const p of state!.positions) seen.set(`${p.institution}|${p.owner}`, { institution: p.institution, owner: p.owner });
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state]);

  useEffect(() => {
    if (!open) return;
    firstButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Nada mais a mostrar: fecha sozinho.
  useEffect(() => {
    if (open && stale.length === 0 && !reviewDue) setOpen(false);
  }, [open, stale.length, reviewDue]);

  if (!open) return null;

  const setSettings = (patch: Partial<typeof settings>) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const unmark = (institution: string, owner: Owner) => setSettings({ staleInstitutions: unmarkStale(stale, institution, owner) });
  const confirmReview = () => {
    setSettings({ lastReviewAt: new Date().toISOString() });
    setReviewDone(true);
  };
  const savePicked = () => {
    const ts = new Date().toISOString();
    let list = stale;
    for (const key of picked) {
      const it = institutions.find(([k]) => k === key)?.[1];
      if (it) list = markStale(list, it.institution, it.owner, ts);
    }
    setSettings({ staleInstitutions: list, lastReviewAt: ts });
    setReviewDone(true);
    setPicking(false);
  };
  const lastReview = settings.lastReviewAt ? daysSince(settings.lastReviewAt, now) : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rem-title">
        <div className="row spread" style={{ marginBottom: 12 }}>
          <h2 id="rem-title" className="row"><BellRing size={18} /> Lembretes de atualização</h2>
          <button className="btn ghost icon sm" onClick={() => setOpen(false)} aria-label="Fechar"><X size={16} /></button>
        </div>

        {stale.length > 0 && (
          <section style={{ marginBottom: reviewDue ? 18 : 0 }}>
            <p className="muted small" style={{ marginBottom: 8 }}>
              {stale.length === 1 ? "Esta instituição está marcada" : "Estas instituições estão marcadas"} como desatualizada{stale.length === 1 ? "" : "s"}:
            </p>
            <div className="stack" style={{ gap: 8 }}>
              {stale.map((m, i) => (
                <div className="reminder-row" key={`${m.institution}|${m.owner}`}>
                  <div className="grow">
                    <b>{m.institution}</b> <span className={"chip owner-" + m.owner}>{m.owner}</span>
                    <div className="muted small">marcada há {daysSince(m.markedAt, now)} dia{daysSince(m.markedAt, now) === 1 ? "" : "s"}</div>
                  </div>
                  <button ref={i === 0 ? firstButton : undefined} className="btn sm primary" onClick={() => { setOpen(false); onUpdate(m); }}>
                    <Upload size={14} /> Atualizar agora
                  </button>
                  <button className="btn sm" onClick={() => unmark(m.institution, m.owner)} title="Desmarcar">
                    <Check size={14} /> Já atualizei
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {reviewDue && (
          <section className="review-box">
            <h3 className="row" style={{ marginBottom: 6 }}><CalendarCheck size={16} /> Está tudo atualizado?</h3>
            <p className="muted small" style={{ marginBottom: 10 }}>
              {lastReview != null ? `Faz ${lastReview} dias desde a última revisão. ` : ""}Os valores de todas as instituições estão em dia?
            </p>
            {!picking ? (
              <div className="row wrap">
                <button ref={stale.length === 0 ? firstButton : undefined} className="btn primary sm" onClick={confirmReview}><Check size={14} /> Sim, tudo atualizado</button>
                <button className="btn sm" onClick={() => setPicking(true)}>Não — escolher o que está desatualizado</button>
              </div>
            ) : (
              <>
                <div className="pick-list">
                  {institutions.map(([key, it]) => (
                    <label className="check small" key={key}>
                      <input type="checkbox" checked={picked.has(key)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(key); else n.delete(key); return n; })} />
                      {it.institution} <span className={"chip owner-" + it.owner}>{it.owner}</span>
                    </label>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn primary sm" disabled={!picked.size} onClick={savePicked}>Marcar {picked.size || ""} como desatualizada{picked.size === 1 ? "" : "s"}</button>
                  <button className="btn sm" onClick={() => setPicking(false)}>Voltar</button>
                </div>
              </>
            )}
          </section>
        )}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn ghost sm" onClick={() => setOpen(false)}>Lembrar depois</button>
        </div>
      </div>
    </div>
  );
}
