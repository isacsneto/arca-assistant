// npm run demo  — sobe o app com uma carteira 100% fictícia, separada dos seus dados.
//   node scripts/demo.mjs [--reset] [--port 3101]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildDemoState } from "./demo-seed.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const args = process.argv.slice(2);
const port = args.includes("--port") ? args[args.indexOf("--port") + 1] : "3101";
const dataDir = path.join(root, "demo-data");
const stateFile = path.join(dataDir, "state.json");

if (args.includes("--reset") || !fs.existsSync(stateFile)) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(buildDemoState(), null, 2));
  console.log("Carteira fictícia criada em demo-data/");
}

console.log("Compilando o front-end…");
const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const build = spawnSync(process.execPath, [vite, "build", "--logLevel", "warn"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const tsx = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const server = spawn(process.execPath, [tsx, "server/index.ts"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ARCA_DATA_DIR: "demo-data", PORT: port },
});
console.log(`\nDemo em http://localhost:${port}  (Ctrl+C para sair)\n`);
server.on("exit", (code) => process.exit(code ?? 0));
