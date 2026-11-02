import fs from "node:fs";
import path from "node:path";
import type { AppState } from "../shared/types";
import { brDay } from "../shared/history";
import { categorize, fromPluggyCategory, normDesc, type BankTx, type Bill } from "../shared/cashflow";
import { EMPTY_LEDGER, type InvestTxRecord, type LedgerData, type LoanRecord } from "../shared/ledger";
import { institutionName, openFinanceSettings, tickerOf, type OpenFinanceConnection, type PluggyTransaction } from "../shared/openFinance";
import { planningOf } from "../shared/planning";
import { mapPool } from "./pool";
import type { Holding } from "../shared/tax";
import type { PluggyClient } from "./pluggy";

/** Arquivo do razão (transações, faturas, empréstimos, movimentações). */
export function ledgerStore(file: string) {
  let cache: LedgerData | null = null;
  const read = (): LedgerData => {
    if (cache) return cache;
    try {
      cache = { ...EMPTY_LEDGER, ...(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LedgerData>) };
    } catch {
      cache = structuredClone(EMPTY_LEDGER);
    }
    return cache;
  };
  return {
    get: read,
    set(data: LedgerData) {
      cache = data;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(data));
      fs.renameSync(file + ".tmp", file);
    },
  };
}
export type LedgerStore = ReturnType<typeof ledgerStore>;

const DAY = 86_400_000;
/** 2 = transações com a fatura em que caem (billMonth). */
export const LEDGER_VERSION = 2;
/** Muda quando as instruções da IA para categorias mudam: o que ela decidiu antes é refeito. */
export const AI_CATEGORIES_VERSION = 2;

/** Transação da Pluggy → do app. No cartão a compra vem positiva; aqui saída é sempre negativa. */
export function toBankTx(t: PluggyTransaction, acc: { id: string; name: string; type: "BANK" | "CREDIT" }, ctx: { itemId: string; institution: string; owner: "PF" | "PJ" }): BankTx {
  const out = (t.type ?? "").toUpperCase() === "DEBIT";
  const cc = t.creditCardMetadata;
  return {
    id: t.id,
    itemId: ctx.itemId,
    accountId: acc.id,
    accountName: acc.name,
    accountType: acc.type,
    institution: ctx.institution,
    owner: ctx.owner,
    date: brDay(new Date(t.date)),
    description: t.description,
    amount: out ? -Math.abs(t.amount) : Math.abs(t.amount),
    currency: t.currencyCode ?? "BRL",
    pluggyCategory: t.category ?? null,
    merchant: t.merchant?.businessName || t.merchant?.name || null,
    pending: (t.status ?? "").toUpperCase() === "PENDING",
    installment: cc?.installmentNumber && cc.totalInstallments && cc.totalInstallments > 1 ? { n: cc.installmentNumber, total: cc.totalInstallments } : null,
    billMonth: /^\d{4}-\d{2}/.test(cc?.billForecastDate ?? "") ? cc!.billForecastDate!.slice(0, 7) : null,
  };
}

/**
 * Sincroniza as conexões do Open Finance: transações (incremental, 10 dias de folga para pegar o que mudou de
 * "pendente" para "lançado"), faturas e — 1x por dia — empréstimos e movimentações de ações/FIIs/ETFs.
 */
export async function syncLedger(
  client: PluggyClient,
  state: AppState,
  prev: LedgerData,
  opts: { now?: Date; slow?: boolean; signal?: AbortSignal } = {},
): Promise<LedgerData> {
  const now = opts.now ?? new Date();
  const today = brDay(now);
  const of = openFinanceSettings(state.settings.openFinance);
  const known = [...new Set(state.positions.map((p) => p.institution))];
  const data: LedgerData = structuredClone(prev);
  // Formato novo (fatura de cada lançamento): busca as transações do zero uma vez. A versão já fica gravada:
  // conta que falhar agora não tem lastTxSync e busca do zero sozinha na próxima — sem refazer as outras.
  if ((prev.version ?? 1) < LEDGER_VERSION) {
    data.lastTxSync = {};
    data.version = LEDGER_VERSION;
  }
  const slow = opts.slow ?? (!prev.lastSlowSync || now.getTime() - Date.parse(prev.lastSlowSync) >= 20 * 3_600_000);
  const errors: string[] = [];

  await mapPool(of.connections, 2, async (conn: OpenFinanceConnection) => {
    try {
      const [item, accounts] = await Promise.all([client.getItem(conn.itemId, opts.signal).catch(() => null), client.accounts(conn.itemId, opts.signal)]);
      const institution = institutionName(conn, item, known, { accounts, investments: [] });
      const ctx = { itemId: conn.itemId, institution, owner: conn.owner };
      for (const acc of accounts) {
        const type = (acc.type ?? "").toUpperCase() === "CREDIT" ? "CREDIT" : "BANK";
        const a = { id: acc.id, name: acc.marketingName || acc.name || type, type } as const;
        // Primeira vez: ~13 meses. Depois: desde a última sincronização, com 10 dias de folga.
        const last = data.lastTxSync[acc.id];
        const from = last ? brDay(new Date(Date.parse(`${last}T12:00:00Z`) - 10 * DAY)) : `${brDay(new Date(now.getTime() - 400 * DAY)).slice(0, 7)}-01`;
        const txs = (await client.transactions(acc.id, from, opts.signal)).map((t) => toBankTx(t, a, ctx));
        // Troca a janela inteira (pendentes viram lançadas com outro id).
        data.bankTx = [...data.bankTx.filter((t) => t.accountId !== acc.id || t.date < from), ...txs];
        data.lastTxSync[acc.id] = today;
        if (type === "CREDIT") {
          // Falha passageira não apaga o que já estava guardado (fica o anterior e o erro aparece).
          try {
            const closed = await client.bills(acc.id, opts.signal);
            const bills: (Bill & { open?: boolean })[] = closed.map((b) => ({ id: b.id, accountId: acc.id, accountName: a.name, institution, owner: conn.owner, dueDate: b.dueDate.slice(0, 10), total: b.totalAmount, minimum: b.minimumPaymentAmount ?? null }));
            // A fatura aberta sai das transações (cardBills): o saldo do cartão é o total devedor, com parcelas futuras.
            data.bills = [...data.bills.filter((b) => b.accountId !== acc.id), ...bills];
          } catch (e) {
            errors.push(`${a.name} (faturas): ${(e as Error).message}`);
          }
        }
      }
      if (slow) {
        const loans = await client.loans(conn.itemId, opts.signal).catch((e: unknown) => {
          errors.push(`${institution} (empréstimos): ${(e as Error).message}`);
          return null;
        });
        if (loans) data.loans = [
          ...data.loans.filter((l) => l.itemId !== conn.itemId),
          ...loans.map((l): LoanRecord => {
            const rate = l.interestRates?.find((r) => r.preFixedRate != null)?.preFixedRate ?? null;
            const remaining = l.installments?.dueInstallments ?? null;
            const balance = l.outstandingBalance ?? l.contractAmount ?? 0;
            return {
              id: l.id, itemId: conn.itemId, institution, owner: conn.owner,
              name: l.productName || l.type || "Empréstimo", balance, currency: l.currencyCode ?? "BRL",
              ratePct: rate != null ? (rate < 1 ? rate * 100 : rate) : null,
              installment: remaining && remaining > 0 ? balance / remaining : null,
              remaining, dueDate: l.dueDate?.slice(0, 10) ?? null,
            };
          }),
        ];
        const allInvs = await client.investments(conn.itemId, opts.signal);
        // Custo de aquisição de tudo (Bens e Direitos): a última sincronização do ano vale como 31/12.
        const year = today.slice(0, 4);
        const holdings: Holding[] = allInvs
          .filter((i) => i.status !== "TOTAL_WITHDRAWAL" && (i.balance ?? 0) > 0)
          .map((i) => ({
            itemId: conn.itemId, ticker: tickerOf(i.code), name: i.name,
            kind: `${(i.type ?? "").toUpperCase()}/${(i.subtype ?? "").toUpperCase()}`, quantity: i.quantity ?? null,
            cost: (i as { amountOriginal?: number | null }).amountOriginal ?? null, value: i.balance ?? 0,
            institution, owner: conn.owner, isin: (i as { isin?: string | null }).isin ?? null, dueDate: i.dueDate?.slice(0, 10) ?? null,
          }));
        data.holdingsByYear = { ...data.holdingsByYear, [year]: [...(data.holdingsByYear?.[year] ?? []).filter((h) => h.itemId !== conn.itemId), ...holdings] };
        // Movimentações de ações, FIIs, ETFs e BDRs (para preço médio e IR).
        const invs = allInvs.filter((i) => ["EQUITY", "ETF"].includes((i.type ?? "").toUpperCase()));
        const records: InvestTxRecord[] = [];
        const failed = new Set<string>();
        await mapPool(invs, 4, async (inv) => {
          const txs = await client.investmentTransactions(inv.id, opts.signal).catch(() => {
            failed.add(inv.id);
            return [];
          });
          for (const t of txs) {
            const kind = (t.type ?? "").toUpperCase();
            const quantity = Math.abs(t.quantity ?? 0);
            if (!quantity) continue;
            const amount = Math.abs(t.amount ?? (t.value ?? 0) * quantity);
            records.push({
              id: t.id, investmentId: inv.id, itemId: conn.itemId, institution, owner: conn.owner,
              ticker: inv.code ?? null, name: inv.name, kind: `${(inv.type ?? "").toUpperCase()}/${(inv.subtype ?? "").toUpperCase()}`,
              type: kind === "BUY" ? "BUY" : kind === "SELL" ? "SELL" : "OTHER",
              // Data do pregão vem como meia-noite UTC (é o dia em si, não um instante).
              date: (t.tradeDate ?? t.date ?? now.toISOString()).slice(0, 10),
              quantity, price: t.value ?? (quantity ? amount / quantity : 0), amount,
              fees: Math.abs(Number(t.expenses?.brokerageFee ?? 0)) || 0,
            });
          }
        });
        // Investimento cuja consulta falhou mantém as movimentações que já tinha.
        data.investTx = [...data.investTx.filter((t) => t.itemId !== conn.itemId || failed.has(t.investmentId)), ...records];
        if (failed.size) errors.push(`${institution}: ${failed.size} investimentos sem movimentações agora`);
      }
    } catch (e) {
      errors.push(`${conn.itemId.slice(0, 8)}: ${(e as Error).message}`);
    }
  });

  data.bankTx.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (slow && !errors.length) data.lastSlowSync = now.toISOString();
  data.syncedAt = now.toISOString();
  data.error = errors.length ? errors.join(" · ") : null;
  return data;
}

/** Descrições que nem regra, nem IA, nem a categoria da Pluggy resolvem — vão para a IA (as mais frequentes primeiro). */
export function needsAi(data: LedgerData, state: AppState, limit = 150): { desc: string; sample: string; amount: number; pluggyCategory: string | null; count: number }[] {
  const rules = planningOf(state.planning).categoryRules;
  const seen = new Map<string, { desc: string; sample: string; amount: number; pluggyCategory: string | null; count: number }>();
  for (const t of data.bankTx) {
    if (fromPluggyCategory(t.pluggyCategory)) continue;
    const d = normDesc(t.description);
    // Categoria da IA de instruções antigas é refeita (e continua valendo até a nova chegar).
    const fresh = data.aiCategories[d] && (data.aiCatVersion?.[d] ?? 1) >= AI_CATEGORIES_VERSION;
    if (!d || fresh || categorize(t, rules, {}).source === "rule") continue;
    const s = seen.get(d);
    if (s) s.count += 1;
    else seen.set(d, { desc: d, sample: t.description, amount: t.amount, pluggyCategory: t.pluggyCategory, count: 1 });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
