import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerAndName, planFromSheets, subsFromSheets, type Sheet, type SheetCell } from "./planImport";

const c = (v: unknown, fill: string | null = null): SheetCell => ({ v, fill });
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const row = (name: string, vals: (number | null)[], fills: (string | null)[] = []) => [c(name), ...MESES.map((_, i) => (vals[i] == null ? null : c(vals[i], fills[i] ?? null)))];

test("dono e nome: prefixo PF/PJ/LLC; colchetes viram observação", () => {
  assert.deepEqual(ownerAndName("PF - Escola"), { owner: "PF", name: "Escola", note: null });
  assert.deepEqual(ownerAndName("LLC - Equipe"), { owner: "LLC", name: "Equipe", note: null });
  assert.deepEqual(ownerAndName("PF Casa - Conta de luz"), { owner: "PF", name: "Casa - Conta de luz", note: null });
  assert.deepEqual(ownerAndName("PF - Carro [parcela 3 de 10]"), { owner: "PF", name: "Carro", note: "parcela 3 de 10" });
  assert.deepEqual(ownerAndName("PJ"), { owner: "PJ", name: "PJ", note: null });
  assert.deepEqual(ownerAndName("Netflix"), { owner: "PF", name: "Netflix", note: null });
});

test("lê a aba do ano: cor = status (pela legenda), pago e passado ficam como digitados, total confere", () => {
  const sheet: Sheet = {
    name: "2026",
    rows: [
      [c("Gastos")],
      [null, ...MESES.map(() => null), null, c("1% Patrimonio")],
      [c("Despesa"), ...MESES.map((m) => c(m)), null, c("Contencao")],
      [...row("PF - Escola", [2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000], [...Array(11).fill("00FF00"), "ABCDEF"]), null, c(1500), null, c(null, "ABCDEF"), c("Previsto Pagamento")],
      [...row("PF - Luz", [850, null, null, null, null, null, null, null, null, 800, 800, 800], [null, null, null, null, null, null, null, null, null, "00FF00"]), null, c(600)],
      row("OUTRO", Array(12).fill(0)),
      row("OUTRO", Array(12).fill(0)),
      row("PF - Presente", [4000, 0]),
      row("PF - Presente", [0, 1000]),
      row("Total pago por mês", [6850, 3000]),
      row("Renda por mês", [20000, 20000, null, null, null, null, null, null, null, 30000, 25000, 25000]),
      [c("Gasto total do ano"), c(32250)],
      [null, c("Dividendos PJ")],
      [null, ...[100, 200].map((v) => c(v))],
      [null, c("Total")],
    ],
  };
  const r = planFromSheets([sheet, { name: "Subs", rows: [] }], "2026-11-03T12:00:00Z");
  const by = (n: string) => r.plan.lines.find((l) => l.name === n)!;
  assert.deepEqual(r.skipped, ["Subs"]);
  assert.deepEqual(by("Escola").cells["2026-10"], { amount: 2000, status: "pago", manual: true });
  assert.deepEqual(by("Escola").cells["2026-12"], { amount: 2000, status: "previsto" }, "cor da legenda da própria planilha");
  assert.equal(by("Escola").contention, 1500);
  assert.deepEqual(by("Luz").cells["2026-11"], { amount: 800 }, "futuro sem cor = planejado (o banco pode substituir)");
  assert.deepEqual(by("Luz").cells["2026-01"], { amount: 850, manual: true }, "passado = o que aconteceu");
  assert.ok(!r.plan.lines.some((l) => l.name === "OUTRO"), "linha-modelo vazia fica de fora");
  assert.deepEqual([by("Presente").cells["2026-01"].amount, by("Presente (2)").cells["2026-02"].amount], [4000, 1000], "mesmo nome = duas contas");
  assert.equal(by("Renda").kind, "income");
  assert.deepEqual([by("Dividendos PJ 1").kind, by("Dividendos PJ 1").cells["2026-02"].amount], ["info", 200]);
  assert.deepEqual([r.years[0].expenses, r.years[0].sheetExpenses], [32250, 32250]);
});

test("aba de assinaturas: cor da coluna Ativo vira status; dólar na observação vira valor em USD; para no Total", () => {
  const subs = subsFromSheets([{ name: "Subs", rows: [
    [],
    [null, c("Email"), c("Servico"), c("Ativo"), c("Valor"), c("Cartao"), c("Obs")],
    [null, c("conta A"), c("Streaming"), c(null, "D9EAD3"), c(39.9), c("Visa Gold"), null],
    [null, c("conta A"), c("Clube"), c(null, "B6D7A8"), c(99.9), c("Pix"), c("Pago até 12/2027")],
    [null, c("conta B"), c("Jogos"), c(null, "FFF2CC"), null, null, null],
    [null, c("conta B"), c("IDE"), c(null, "D9EAD3"), null, c("Wise"), c("20 USD")],
    [null, c("Total"), null, c(159.8)],
    [null, c("x"), c("Depois do total"), null, c(1)],
  ] }]);
  assert.deepEqual(subs.map((s) => [s.service, s.status, s.amount, s.currency]), [
    ["Streaming", "ativa", 39.9, "BRL"], ["Clube", "anual", 99.9, "BRL"], ["Jogos", "inativa", null, "BRL"], ["IDE", "ativa", 20, "USD"],
  ]);
  assert.deepEqual([subs[0].account, subs[0].payment, subs[1].note], ["conta A", "Visa Gold", "Pago até 12/2027"]);
});
