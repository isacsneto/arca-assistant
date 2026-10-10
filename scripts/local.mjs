// npm run local — deixa o app rodando (compila o front-end, sobe o servidor e reinicia se ele cair
// ou travar). Com --service é o que o serviço do sistema roda ("npm run local:install"): tarefa do
// Windows, LaunchAgent do macOS ou systemd do Linux, que por sua vez religam este script se ele sair.
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

// --service: chamado pelo serviço do sistema (tarefa do Windows, LaunchAgent, systemd).
const service = process.argv.includes("--service");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = async (timeout = 2000) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(timeout) })).ok;
  } catch {
    return false;
  }
};

// Já tem um app respondendo nesta porta? Não sobe outro (dois servidores no mesmo data/ se sobrescreveriam).
// Como serviço, fica de reserva: se aquele parar de responder, assume (sem reiniciar sem parar).
if (await alive()) {
  if (!service) {
    log(`Já existe um Arca Assistant na porta ${port}; nada a fazer.`);
    process.exit(0);
  }
  log(`Já existe um Arca Assistant na porta ${port}; fico de reserva e assumo se ele parar.`);
  for (let down = 0; down < 2; ) {
    await sleep(15_000);
    down = (await alive(5000)) ? 0 : down + 1;
  }
  log("O outro servidor parou de responder; assumindo.");
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
let startedAt = 0;
let stopping = false;
let failures = 0;

function start() {
  startedAt = Date.now();
  child = spawn(process.execPath, [tsx, "--env-file-if-exists=.env", "server/index.ts"], {
    cwd: root,
    env: { ...process.env, PORT: port },
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  log(`Servidor iniciado (pid ${child.pid}) em http://127.0.0.1:${port}`);
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return;
    // Caiu: reinicia com espera crescente (zera se tinha ficado de pé por 1 min).
    failures = Date.now() - startedAt > 60_000 ? 1 : failures + 1;
    const wait = Math.min(60, 2 ** failures) * 1000;
    log(`Servidor parou (código ${code ?? signal}). Reiniciando em ${wait / 1000}s…`);
    setTimeout(start, wait);
  });
}

// Vivo mas travado (não responde): mata, e o "exit" acima reinicia. Dá 90 s para subir.
let misses = 0;
setInterval(async () => {
  if (!child || stopping || Date.now() - startedAt < 90_000) return;
  misses = (await alive(10_000)) ? 0 : misses + 1;
  if (misses >= 4 && child) {
    log(`Servidor sem responder há ~2 min; reiniciando (pid ${child.pid}).`);
    misses = 0;
    treeKill(child.pid);
  }
}, 30_000).unref();

/** Mata o processo e os filhos: o tsx roda o servidor num processo filho, que ficaria segurando a porta. */
function treeKill(pid, signal = "SIGKILL") {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  const kids = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).stdout?.split(/\s+/).filter(Boolean) ?? [];
  for (const k of kids) treeKill(Number(k), signal);
  try {
    process.kill(pid, signal);
  } catch {
    /* já saiu */
  }
}

// SIGHUP: terminal/console fechado (no Windows, fechar a janela).
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  process.on(sig, () => {
    stopping = true;
    log(`Encerrando (${sig}).`);
    if (child) treeKill(child.pid, "SIGTERM");
    process.exit(0);
  });
}

start();
