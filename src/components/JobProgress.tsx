import { Loader2, Square } from "lucide-react";
import type { JobState } from "../lib/useJob";

export function JobProgress({ job, onCancel }: { job: JobState<unknown>; onCancel: () => void }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row spread">
        <div className="row">
          <Loader2 size={16} className="spin" />
          <b>{job.status}</b>
          {job.searches > 0 && <span className="muted small">· {job.searches} buscas</span>}
        </div>
        <button className="btn sm" onClick={onCancel}>
          <Square size={12} /> Parar
        </button>
      </div>
      {job.feed.length > 0 && (
        <div className="feed" style={{ marginTop: 10 }}>
          {job.feed.map((l, i) => (
            <div className="line" key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
