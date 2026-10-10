import { execFile, spawn } from "node:child_process";
import { AiError } from "./types";
import { L } from "../../shared/i18n";

/** Roda um processo, envia `stdin`, entrega cada linha do stdout e devolve código + fim do stderr. */
export function runProcess(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; stdin?: string; signal?: AbortSignal; shell?: boolean; onLine?: (line: string) => void },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, windowsHide: true, shell: opts.shell ?? false });
    let stdout = "";
    let stderr = "";
    let buf = "";
    const onAbort = () => child.kill();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) opts.onLine?.(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (buf.trim()) opts.onLine?.(buf.trim());
      if (opts.signal?.aborted) reject(new AiError(L("Cancelado.", "Cancelled.")));
      else resolve({ code, stdout, stderr });
    });
    if (opts.stdin != null) child.stdin.end(opts.stdin, "utf8");
    else child.stdin.end();
  });
}

/** Executa um comando curto (status de login, versão) e devolve stdout+stderr; null se não existir. */
export function quickExec(cmd: string, args: string[], shell = false, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10_000, windowsHide: true, shell, env }, (err, stdout, stderr) => {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") return resolve(null);
      const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
      resolve(err && !out ? null : out);
    });
  });
}
