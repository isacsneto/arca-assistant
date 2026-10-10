import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { CLASS_META, type AssetClass } from "../../shared/types";

export function ClassDot({ c }: { c: AssetClass }) {
  return <span className="dot" style={{ background: CLASS_META[c].color }} />;
}

export function ClassLabel({ c }: { c: AssetClass }) {
  return (
    <span className="row" style={{ gap: 7 }}>
      <ClassDot c={c} />
      {CLASS_META[c].label}
    </span>
  );
}

export function Banner({ kind = "info", children }: { kind?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  const Icon = kind === "ok" ? CheckCircle2 : kind === "info" ? Info : AlertTriangle;
  return (
    <div className={`banner ${kind === "info" ? "" : kind}`}>
      <Icon size={18} />
      <div className="grow">{children}</div>
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row wrap page-actions">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function ClassSelect({
  value,
  onChange,
  className = "cell",
}: {
  value: AssetClass;
  onChange: (c: AssetClass) => void;
  className?: string;
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value as AssetClass)}>
      {(Object.keys(CLASS_META) as AssetClass[]).map((c) => (
        <option key={c} value={c}>
          {CLASS_META[c].label}
        </option>
      ))}
    </select>
  );
}
