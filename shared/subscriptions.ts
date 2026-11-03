import type { BankTx } from "./cashflow";
import { normDesc } from "./cashflow";
import { detectRecurring } from "./ledger";
import { L } from "./i18n";

/*
 * Assinaturas: a lista de serviços que você assina (como a aba de assinaturas da planilha), cruzada com
 * as faturas dos cartões e a conta. O que bate mostra a cobrança real ao lado; o que não bate (Pix, Wise,
 * cartão de outro banco…) fica manual, exatamente como você deixou.
 */

/** Ativa (cobra todo mês), paga adiantado (anual/pacote) ou parada. */
export type SubStatus = "ativa" | "anual" | "inativa";
export const SUB_STATUSES: SubStatus[] = ["ativa", "anual", "inativa"];
export const SUB_STATUS_LABEL = (): Record<SubStatus, string> => ({
  ativa: L("Ativa", "Active"),
  anual: L("Paga adiantado", "Prepaid"),
  inativa: L("Parada", "Stopped"),
});

export interface Subscription {
  id: string;
  service: string;
  /** Conta/login usado no serviço (ex.: qual e-mail). */
  account?: string | null;
  status: SubStatus;
  /** Quanto custa para você por mês (a sua parte, se é dividida). */
  amount?: number | null;
  currency: "BRL" | "USD";
  /** Como é pago (texto livre: cartão, Pix, Wise…). */
  payment?: string | null;
  note?: string | null;
  /** Como a cobrança aparece no extrato; vazio = o app deduz pelo nome do serviço. */
  keywords?: string[] | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function subsOf(raw: unknown): Subscription[] {
  return (Array.isArray(raw) ? raw : []).filter((s) => s && typeof s.id === "string" && typeof s.service === "string" && s.service.trim()).map((s) => ({
    id: s.id,
    service: s.service.trim().slice(0, 120),
    account: text(s.account),
    status: SUB_STATUSES.includes(s.status) ? s.status : "ativa",
    amount: num(s.amount),
    currency: s.currency === "USD" ? "USD" : "BRL",
    payment: text(s.payment),
    note: text(s.note, 500),
    keywords: Array.isArray(s.keywords) ? s.keywords.filter((k: unknown): k is string => typeof k === "string" && normDesc(k).length >= 3).map(normDesc) : null,
  }));
}

/*
 * Como os serviços conhecidos aparecem na fatura. A chave é procurada no nome do serviço; os valores, na
 * descrição do lançamento. Serviço fora da lista usa as palavras do próprio nome.
 */
const ALIASES: [RegExp, string[]][] = [
  [/icloud|apple (tv|music|one)/, ["apple com bill", "applecombill", "apple com"]],
  [/amazon prime|prime video/, ["amazon prime", "amazonprime", "prime video", "primevideo"]],
  [/youtube/, ["youtubepremium", "youtube premium"]],
  [/google (storage|one|drive)/, ["google one", "googleone", "google storage"]],
  [/meli|mercado livre/, ["melimais", "meli+", "meli mais"]],
  [/psn|playstation/, ["sonyplay", "playstation", "psn"]],
  [/hbo|^max$/, ["hbomax", "hbo max", "hbo"]],
  [/chatgpt|openai/, ["openai", "chatgpt"]],
  [/claude|anthropic/, ["anthropic", "claude"]],
  [/disney/, ["disney"]],
  [/spotify/, ["spotify"]],
  [/netflix/, ["netflix"]],
  [/nintendo/, ["nintendo"]],
  [/linked ?i?n|linkedln/, ["linkedin"]],
  [/jetbrains|intellij/, ["jetbrains"]],
  [/crunchyroll/, ["crunchyroll"]],
  [/dazn/, ["dazn"]],
  [/ufc/, ["ufc fight", "fightpass", "ufc"]],
  [/globoplay/, ["globoplay", "globo"]],
  [/paramount/, ["paramount"]],
  [/deezer/, ["deezer"]],
];
/** Palavras genéricas que não identificam um serviço sozinhas. */
const GENERIC = new Set(["plus", "premium", "extra", "pass", "fight", "storage", "socio", "assinatura", "plano", "mensal", "anual", "basic", "standard", "family", "familia", "the", "and", "com", "app"]);

export function subKeywords(s: Pick<Subscription, "service" | "keywords">): string[] {
  if (s.keywords?.length) return s.keywords;
  const name = normDesc(s.service);
  const alias = ALIASES.find(([re]) => re.test(name));
  if (alias) return alias[1].map(normDesc);
  const words = name.split(" ").filter((w) => w.length >= 4 && !GENERIC.has(w));
  // "Sócio Clube Atlético" → "clube atletico" (a frase sem as palavras genéricas).
  return words.length ? [words.join(" ")] : [name];
}

export interface SubCharge {
  id: string;
  date: string;
  amount: number;
  account: string;
  institution: string;
  card: boolean;
}

export interface SubMatch {
  charges: SubCharge[];
  /** Valor típico da cobrança (o mais frequente; ou o da planilha, quando bate). */
  typical: number | null;
  last: SubCharge | null;
  /** Mensal, anual ou irregular (pelo intervalo entre cobranças). */
  cadence: "mensal" | "anual" | "irregular" | null;
  /** Leitura do que o banco mostra frente ao que está na lista. */
  flag: "ok" | "dividida" | "valor-diferente" | "sem-cobranca-recente" | "cobrada-mas-parada" | "outro-meio" | "nao-encontrada";
  /** Dividida: quantas pessoas (cobrança = sua parte × n). */
  split?: number;
}

/** O meio de pagamento da lista é o cartão de onde veio a cobrança? ("Visa Gold (final 1234)" × "BANCO X VISA GOLD"). */
function samePayment(payment: string | null | undefined, c: SubCharge): boolean | null {
  const words = (x: string) => new Set(normDesc(x).split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w)));
  if (!payment?.trim()) return null;
  const a = words(payment);
  const b = words(`${c.account} ${c.institution}`);
  return [...a].some((w) => b.has(w));
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY);
const near = (a: number, b: number, pct: number) => Math.abs(a - b) <= Math.max(0.5, b * pct);

/**
 * Procura as cobranças de cada assinatura nos últimos 13 meses: descrição com a palavra-chave e valor
 * perto do da lista (ou, se não bate, do valor mais frequente — assinatura dividida custa a sua parte,
 * mas a fatura mostra o total). Um lançamento conta para uma assinatura só: duas assinaturas com a mesma
 * descrição (Apple) se separam pelo valor.
 */
export function matchSubscriptions(subs: Subscription[], txs: BankTx[], today: string): Record<string, SubMatch> {
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 400 * DAY).toISOString().slice(0, 10);
  const pool = txs.filter((t) => t.amount < 0 && t.date >= since && t.date <= today && !t.installment).map((t) => ({ t, d: normDesc(t.description) }));
  const used = new Set<string>();
  const out: Record<string, SubMatch> = {};
  // Primeiro quem tem valor na lista (separa as que dividem a mesma descrição), depois o resto.
  const order = [...subs].sort((a, b) => (b.amount != null && b.currency === "BRL" ? 1 : 0) - (a.amount != null && a.currency === "BRL" ? 1 : 0));
  const keyed = new Map(subs.map((s) => [s.id, subKeywords(s)]));
  // Descrição que serve a mais de uma assinatura (ex.: Apple): aí o valor tem que bater.
  const shared = (k: string) => subs.filter((s) => keyed.get(s.id)!.includes(k)).length > 1;

  for (const s of order) {
    const keys = keyed.get(s.id)!;
    const cands = pool.filter(({ t, d }) => !used.has(t.id) && keys.some((k) => d.includes(k) || d.replace(/ /g, "").includes(k.replace(/ /g, ""))));
    const mine = s.amount != null && s.currency === "BRL" ? s.amount : null;
    let anchor: number | null = null;
    if (mine != null && cands.some(({ t }) => near(-t.amount, mine, 0.1))) anchor = mine;
    else if (!keys.some(shared) || mine == null) {
      // Valor mais frequente (as compras avulsas na mesma loja ficam de fora).
      const counts = new Map<number, number>();
      for (const { t } of cands) counts.set(Math.round(-t.amount * 2) / 2, (counts.get(Math.round(-t.amount * 2) / 2) ?? 0) + 1);
      const best = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
      anchor = best ? best[0] : null;
    }
    const charges = anchor == null ? [] : cands.filter(({ t }) => near(-t.amount, anchor!, 0.15)).map(({ t }) => ({
      id: t.id, date: t.date, amount: -t.amount, account: t.accountName, institution: t.institution, card: t.accountType === "CREDIT",
    })).sort((a, b) => (a.date < b.date ? 1 : -1));
    charges.forEach((c) => used.add(c.id));
    const last = charges[0] ?? null;
    const gaps = charges.slice(0, -1).map((c, i) => days(c.date, charges[i + 1].date));
    const avgGap = gaps.length ? gaps.reduce((x, y) => x + y, 0) / gaps.length : null;
    const cadence = !charges.length ? null : avgGap == null ? null : avgGap <= 40 ? "mensal" : avgGap >= 300 ? "anual" : "irregular";
    const recent = last ? days(today, last.date) <= (cadence === "anual" ? 380 : 45) : false;
    const typical = last ? (anchor === mine ? mine : last.amount) : null;
    let flag: SubMatch["flag"];
    let split: number | undefined;
    const k = last && mine != null && mine > 0 ? last.amount / mine : 0;
    if (k >= 1.9 && Math.abs(k - Math.round(k)) <= 0.03 * k && Math.round(k) <= 8) split = Math.round(k);
    if (!last) flag = "nao-encontrada";
    // Paga hoje por outro meio (Pix, Wise, conta PJ…): o que achei é de antes — fica manual.
    else if (samePayment(s.payment, last) === false && days(today, last.date) > 45) flag = "outro-meio";
    else if (s.status === "inativa" && days(today, last.date) <= 45) flag = "cobrada-mas-parada";
    else if (s.status !== "inativa" && !recent && s.status !== "anual") flag = "sem-cobranca-recente";
    else if (split) flag = "dividida";
    else if (mine != null && !near(last.amount, mine, 0.02)) flag = "valor-diferente";
    else flag = "ok";
    out[s.id] = { charges, typical, last, cadence, flag, ...(split && { split }) };
  }
  return out;
}

export interface SubSuggestion {
  label: string;
  amount: number;
  lastDate: string;
  account: string;
  months: number;
}

/** Cobranças recorrentes de assinatura (pela categoria) que não estão na lista. */
export function subSuggestions(subs: Subscription[], matched: Record<string, SubMatch>, txs: (BankTx & { category: string })[], today: string): SubSuggestion[] {
  const taken = new Set(Object.values(matched).flatMap((m) => m.charges.map((c) => c.id)));
  const keys = subs.flatMap((s) => subKeywords(s));
  return detectRecurring(txs, today)
    .filter((r) => r.category === "assinaturas" && days(today, r.lastDate) <= 45)
    .filter((r) => !keys.some((k) => normDesc(r.label).includes(k)))
    .filter((r) => !txs.some((t) => taken.has(t.id) && normDesc(t.description) === normDesc(r.label)))
    .map((r) => ({ label: r.label, amount: r.amount, lastDate: r.lastDate, account: r.account, months: r.months }));
}

/** Total por mês do que não está parado (como na planilha: a paga adiantado entra pelo valor mensal); dólar convertido. */
export function subsMonthly(subs: Subscription[], usdBrl: number): { brl: number; usd: number; total: number; count: number } {
  const act = subs.filter((s) => s.status !== "inativa" && s.amount != null);
  const brl = act.filter((s) => s.currency === "BRL").reduce((x, s) => x + s.amount!, 0);
  const usd = act.filter((s) => s.currency === "USD").reduce((x, s) => x + s.amount!, 0);
  return { brl, usd, total: brl + usd * usdBrl, count: subs.filter((s) => s.status !== "inativa").length };
}
