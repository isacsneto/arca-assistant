import type { Owner } from "./types";
import type { CategoryRule } from "./planning";
import { L } from "./i18n";

/*
 * Gastos e receitas a partir das transações da conta e do cartão (Open Finance). A categoria sai, nesta
 * ordem: regra do usuário (as correções dele) → categoria escolhida pela IA → categoria da Pluggy →
 * "Outros". Transferências entre contas, pagamento de fatura e aplicação/resgate não são gasto nem receita.
 */

export interface BankTx {
  id: string;
  itemId: string;
  accountId: string;
  accountName: string;
  accountType: "BANK" | "CREDIT";
  institution: string;
  owner: Owner;
  /** AAAA-MM-DD. */
  date: string;
  description: string;
  /** Negativo = saída; positivo = entrada. */
  amount: number;
  currency: string;
  pluggyCategory: string | null;
  merchant?: string | null;
  pending?: boolean;
  /** Parcela (cartão): n de total. */
  installment?: { n: number; total: number } | null;
}

export interface Bill {
  id: string;
  accountId: string;
  accountName: string;
  institution: string;
  owner: Owner;
  dueDate: string;
  total: number;
  minimum?: number | null;
}

export type CategoryKind = "expense" | "income" | "ignore";

export interface Category {
  id: string;
  kind: CategoryKind;
  label: () => string;
}

export const CATEGORIES: Category[] = [
  { id: "moradia", kind: "expense", label: () => L("Moradia", "Housing") },
  { id: "contas", kind: "expense", label: () => L("Contas da casa", "Utilities") },
  { id: "mercado", kind: "expense", label: () => L("Mercado", "Groceries") },
  { id: "restaurantes", kind: "expense", label: () => L("Restaurantes e delivery", "Eating out") },
  { id: "transporte", kind: "expense", label: () => L("Transporte", "Transportation") },
  { id: "saude", kind: "expense", label: () => L("Saúde", "Health") },
  { id: "educacao", kind: "expense", label: () => L("Educação", "Education") },
  { id: "lazer", kind: "expense", label: () => L("Lazer", "Leisure") },
  { id: "viagem", kind: "expense", label: () => L("Viagem", "Travel") },
  { id: "compras", kind: "expense", label: () => L("Compras", "Shopping") },
  { id: "assinaturas", kind: "expense", label: () => L("Assinaturas e serviços", "Subscriptions & services") },
  { id: "impostos", kind: "expense", label: () => L("Impostos e taxas", "Taxes & fees") },
  { id: "seguros", kind: "expense", label: () => L("Seguros", "Insurance") },
  { id: "pets", kind: "expense", label: () => L("Pets", "Pets") },
  { id: "pessoal", kind: "expense", label: () => L("Cuidados pessoais", "Personal care") },
  { id: "doacoes", kind: "expense", label: () => L("Presentes e doações", "Gifts & donations") },
  { id: "outros", kind: "expense", label: () => L("Outros gastos", "Other expenses") },
  { id: "salario", kind: "income", label: () => L("Salário e pró-labore", "Salary") },
  { id: "rendimentos", kind: "income", label: () => L("Rendimentos e dividendos", "Investment income") },
  { id: "outras-receitas", kind: "income", label: () => L("Outras receitas", "Other income") },
  { id: "transferencia", kind: "ignore", label: () => L("Transferência entre contas", "Transfer between accounts") },
  { id: "fatura", kind: "ignore", label: () => L("Pagamento de fatura", "Credit card payment") },
  { id: "investimento", kind: "ignore", label: () => L("Aplicação / resgate", "Investment in/out") },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES.find((c) => c.id === "outros")!;

/** Categoria da Pluggy (em inglês) → categoria do Arca. Ordem importa: a primeira que casar vale. */
const PLUGGY_MAP: [RegExp, string][] = [
  [/credit card payment/i, "fatura"],
  [/same person transfer|transfer - internal|own account/i, "transferencia"],
  // Impostos antes de receitas: "Income taxes" e "Taxes on investments" são gasto.
  [/tax|fee|interests? charged|late payment|iof/i, "impostos"],
  [/investment|fixed income|variable income|stocks|mutual fund|pension/i, "investimento"],
  [/salary|payroll|retirement|pro.?labore/i, "salario"],
  [/dividend|proceeds|yield/i, "rendimentos"],
  [/income|refund|cashback|loans received/i, "outras-receitas"],
  [/rent|housing|condominium|mortgage|real estate/i, "moradia"],
  [/electricity|water|^gas$|utilities|telecommunication|internet|mobile|phone|tv/i, "contas"],
  [/groceries|supermarket/i, "mercado"],
  [/eating out|restaurant|food delivery|bars|coffee/i, "restaurantes"],
  [/transport|taxi|ride|gas station|fuel|parking|toll|vehicle|automotive/i, "transporte"],
  [/health|pharmac|hospital|clinic|doctor|dentist|optometry|gym|fitness|wellness/i, "saude"],
  [/education|school|course|university|book/i, "educacao"],
  [/leisure|entertainment|gaming|games|cinema|theater|concert|stadium|arena|ticket|events|sports|culture|bet/i, "lazer"],
  [/travel|airline|airport|hotel|lodging|accom+odation|tourism/i, "viagem"],
  [/digital service|streaming|software|subscription|online platforms/i, "assinaturas"],
  [/insurance/i, "seguros"],
  [/pet/i, "pets"],
  [/beauty|personal care|clothing|apparel/i, "pessoal"],
  [/donation|gift|charity/i, "doacoes"],
  [/shopping|electronics|department|marketplace|houseware|home|furniture|retail|kids|toys|office/i, "compras"],
];

export function fromPluggyCategory(cat: string | null | undefined): string | null {
  if (!cat) return null;
  return PLUGGY_MAP.find(([re]) => re.test(cat))?.[1] ?? null;
}

/** Descrição normalizada: sem parcela ("18/18"), datas, números longos e espaços repetidos. */
export function normDesc(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ")
    .replace(/\d{3,}/g, " ")
    .replace(/[^a-z0-9*& ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

export type CategorySource = "rule" | "ai" | "pluggy" | "default";

/** Categoria final de uma transação + de onde veio. */
export function categorize(tx: Pick<BankTx, "description" | "pluggyCategory" | "amount">, rules: CategoryRule[], aiMap: Record<string, string>): { category: string; source: CategorySource } {
  const d = normDesc(tx.description);
  const rule = rules.find((r) => d.includes(normDesc(r.match)));
  if (rule && CATEGORY_IDS.includes(rule.category)) return { category: rule.category, source: "rule" };
  const ai = aiMap[d];
  if (ai && CATEGORY_IDS.includes(ai)) return { category: ai, source: "ai" };
  const p = fromPluggyCategory(tx.pluggyCategory);
  if (p) {
    // Categoria de receita num débito (ou o contrário) não faz sentido: cai no genérico do sinal.
    const kind = categoryOf(p).kind;
    if (kind === "ignore" || (kind === "income") === tx.amount > 0) return { category: p, source: "pluggy" };
  }
  return { category: tx.amount > 0 ? "outras-receitas" : "outros", source: "default" };
}

export interface MonthFlow {
  month: string;
  income: number;
  expenses: number;
  net: number;
  /** Gasto por categoria (positivo). */
  byCategory: Record<string, number>;
  /** Receita por categoria. */
  incomeByCategory: Record<string, number>;
}

/** Totais por mês (só transações já feitas; parcelas futuras ficam de fora). */
export function monthlyFlows(txs: (BankTx & { category: string })[], today: string): MonthFlow[] {
  const map = new Map<string, MonthFlow>();
  for (const t of txs) {
    if (t.date > today) continue;
    const kind = categoryOf(t.category).kind;
    if (kind === "ignore") continue;
    const month = t.date.slice(0, 7);
    let m = map.get(month);
    if (!m) map.set(month, (m = { month, income: 0, expenses: 0, net: 0, byCategory: {}, incomeByCategory: {} }));
    if (kind === "income") {
      m.income += t.amount;
      m.incomeByCategory[t.category] = (m.incomeByCategory[t.category] ?? 0) + t.amount;
    } else {
      // Estorno (positivo) numa categoria de gasto reduz o gasto.
      m.expenses -= t.amount;
      m.byCategory[t.category] = (m.byCategory[t.category] ?? 0) - t.amount;
    }
    m.net = m.income - m.expenses;
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** Quanto sobra por mês, em média, nos últimos `n` meses completos (o mês corrente não entra). */
export function savingsCapacity(flows: MonthFlow[], currentMonth: string, n = 3): { average: number; months: string[] } | null {
  const done = flows.filter((f) => f.month < currentMonth).slice(-n);
  if (!done.length) return null;
  return { average: done.reduce((s, f) => s + f.net, 0) / done.length, months: done.map((f) => f.month) };
}
