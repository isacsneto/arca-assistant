import { norm } from "./importMerge";
import type { Owner, Settings, StaleMark } from "./types";

const DAY = 86_400_000;

const same = (m: Pick<StaleMark, "institution" | "owner">, institution: string, owner: Owner) =>
  m.owner === owner && norm(m.institution) === norm(institution);

export function isStale(settings: Pick<Settings, "staleInstitutions">, institution: string, owner: Owner): boolean {
  return settings.staleInstitutions.some((m) => same(m, institution, owner));
}

export function markStale(list: StaleMark[], institution: string, owner: Owner, now: string): StaleMark[] {
  return list.some((m) => same(m, institution, owner)) ? list : [...list, { institution, owner, markedAt: now }];
}

export function unmarkStale(list: StaleMark[], institution: string, owner: Owner): StaleMark[] {
  return list.filter((m) => !same(m, institution, owner));
}

/** Ao importar dados de uma instituição, ela deixa de estar desatualizada. */
export function clearStaleFor(list: StaleMark[], touched: { institution: string; owner: Owner }[]): StaleMark[] {
  return list.filter((m) => !touched.some((t) => same(m, t.institution, t.owner)));
}

/** Hora de perguntar "está tudo atualizado?" — nunca na primeira vez (sem data registrada). */
export function isReviewDue(settings: Pick<Settings, "reviewIntervalDays" | "lastReviewAt">, now: Date): boolean {
  if (!settings.reviewIntervalDays || !settings.lastReviewAt) return false;
  const last = Date.parse(settings.lastReviewAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= settings.reviewIntervalDays * DAY;
}

export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY));
}
