import { PROVIDERS, aiFor, aiSettings, type AiTaskName } from "../../shared/ai";
import { useStore } from "../store";
import { L } from "../../shared/i18n";

/** Nome curto do provedor ativo e rótulo do modelo usado em cada tarefa. */
export function useAi() {
  const { state, config } = useStore();
  const ai = aiSettings(state!.settings);
  const name = ai.provider === "codex" ? "Codex" : PROVIDERS[ai.provider].label;
  const modelLabel = (task: AiTaskName) => {
    const t = aiFor(state!.settings, task);
    if (ai.provider === "claude") return config?.models.find((m) => m.id === t.model)?.label ?? t.model ?? name;
    return t.model ? `${name} · ${t.model}` : L(`${name} (modelo padrão)`, `${name} (default model)`);
  };
  return { ai, name, modelLabel, viaApi: ai.auth === "apiKey" };
}
