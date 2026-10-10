// npm run local — deixa o app rodando (compila o front-end, sobe o servidor e reinicia se ele cair).
// É o que a tarefa do Windows ("npm run local:install") executa ao fazer login.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const port = process.env.PORT || "3001";
const logDir = path.join(root, "data", "logs");
const logFile = path.join(logDir, "server.log");
const pidFile = path.join(root, "data", "local.pid");
fs.mkdirSync(logDir, { recursive: true });

// Log simples com rotação (um arquivo antigo de até 5 MB).
if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + ".1");
const out = fs.openSync(logFile, "a");
const log = (msg) => {
  const line = `[${new Date().toLocaleString("pt-BR")}] ${msg}\n`;
  fs.writeSync(out, line);
  process.stdout.write(line);
};

// Já tem um app respondendo nesta porta? Não sobe outro (dois servidores no mesmo data/ se sobrescreveriam).
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(2000) });
  if (r.ok) {
    log(`Já existe um Arca Assistant na porta ${port}; nada a fazer.`);
    process.exit(0);
  }
} catch {
  /* porta livre */
}

fs.writeFileSync(pidFile, String(process.pid));
const cleanup = () => {
  try {
    if (fs.readFileSync(pidFile, "utf8") === String(process.pid)) fs.rmSync(pidFile);
  } catch {
    /* já removido */
  }
};
process.on("exit", cleanup);

log("Compilando o front-end…");
const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const build = spawnSync(process.execPath, [vite, "build", "--logLevel", "error"], { cwd: root, stdio: ["ignore", out, out] });
if (build.status !== 0) {
  if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
    log("Falha ao compilar e não há versão anterior em dist/. Veja o erro acima.");
    process.exit(1);
  }
  log("Falha ao compilar; usando a versão anterior de dist/.");
}

const tsx = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
let child = null;
let stopping = false;
let failures = 0;

function start() {
  const startedAt = Date.now();
  child = spawn(process.execPath, [tsx, "--env-file-if-exists=.env", "server/index.ts"], {
    cwd: root,
    env: { ...process.env, PORT: port },
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  log(`Servidor iniciado (pid ${child.pid}) em http://127.0.0.1:${port}`);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    // Caiu: reinicia com espera crescente (zera se tinha ficado de pé por 1 min).
    failures = Date.now() - startedAt > 60_000 ? 1 : failures + 1;
    const wait = Math.min(60, 2 ** failures) * 1000;
    log(`Servidor parou (código ${code ?? signal}). Reiniciando em ${wait / 1000}s…`);
    setTimeout(start, wait);
  });
}

for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(sig, () => {
    stopping = true;
    log("Encerrando.");
    child?.kill();
    process.exit(0);
  });
}

start();
