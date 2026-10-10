// npm run local:install | local:stop | local:uninstall — escolhe o jeito de cada sistema:
//   Windows: tarefa no Agendador (scripts/windows/*.ps1)
//   macOS:   LaunchAgent · Linux: serviço systemd do usuário (scripts/unix/service.sh)
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const action = process.argv[2] ?? "install";
if (!["install", "stop", "uninstall"].includes(action)) {
  console.error("uso: node scripts/service.mjs install|stop|uninstall");
  process.exit(1);
}

const run =
  process.platform === "win32"
    ? spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts", "windows", action === "install" ? "install.ps1" : "stop.ps1"),
        ...(action === "uninstall" ? ["-Uninstall"] : [])], { stdio: "inherit" })
    : spawnSync("bash", [path.join(root, "scripts", "unix", "service.sh"), action], { stdio: "inherit" });
process.exit(run.status ?? 1);
