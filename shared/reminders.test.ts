import { test } from "node:test";
import assert from "node:assert/strict";
import { clearStaleFor, daysSince, isReviewDue, isStale, markStale, unmarkStale } from "./reminders";

const NOW = "2026-10-10T12:00:00.000Z";

test("marcar/desmarcar instituição desatualizada por titular, sem duplicar", () => {
  let list = markStale([], "Itaú", "PF", NOW);
  list = markStale(list, "itau", "PF", NOW);
  assert.equal(list.length, 1, "mesma instituição (sem acento/caixa) não duplica");
  list = markStale(list, "Itaú", "PJ", NOW);
  assert.equal(list.length, 2);
  assert.ok(isStale({ staleInstitutions: list }, "ITAU", "PJ"));
  list = unmarkStale(list, "Itaú", "PF");
  assert.deepEqual(list.map((m) => m.owner), ["PJ"]);
});

test("importar dados da instituição limpa a marcação só daquele titular", () => {
  const list = [
    { institution: "Banco Inter", owner: "PJ" as const, markedAt: NOW },
    { institution: "Banco Inter", owner: "PF" as const, markedAt: NOW },
    { institution: "Nubank", owner: "PF" as const, markedAt: NOW },
  ];
  const out = clearStaleFor(list, [{ institution: "banco inter", owner: "PJ" }]);
  assert.deepEqual(out.map((m) => `${m.institution}/${m.owner}`), ["Banco Inter/PF", "Nubank/PF"]);
});

test("revisão periódica: semanal, quinzenal, desligada e primeira vez", () => {
  const now = new Date(NOW);
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  assert.equal(isReviewDue({ reviewIntervalDays: 7, lastReviewAt: ago(6) }, now), false);
  assert.equal(isReviewDue({ reviewIntervalDays: 7, lastReviewAt: ago(7) }, now), true);
  assert.equal(isReviewDue({ reviewIntervalDays: 14, lastReviewAt: ago(10) }, now), false);
  assert.equal(isReviewDue({ reviewIntervalDays: 14, lastReviewAt: ago(15) }, now), true);
  assert.equal(isReviewDue({ reviewIntervalDays: 0, lastReviewAt: ago(100) }, now), false, "desligado");
  assert.equal(isReviewDue({ reviewIntervalDays: 7, lastReviewAt: null }, now), false, "primeira vez não pergunta");
  assert.equal(isReviewDue({ reviewIntervalDays: 7, lastReviewAt: "lixo" }, now), true);
});

test("daysSince", () => {
  assert.equal(daysSince("2026-10-01T12:00:00.000Z", new Date(NOW)), 9);
});
