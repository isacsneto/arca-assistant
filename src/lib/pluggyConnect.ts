import { api } from "../api";
import { getLang } from "../../shared/i18n";

export interface ConnectedItem {
  id: string;
  name: string | null;
}

/**
 * Abre o widget Pluggy Connect (tela da própria Pluggy): o usuário escolhe o banco — ou o conector
 * MeuPluggy — e faz login lá; a senha nunca passa pelo Arca. Resolve com a conexão criada/renovada,
 * ou null se o usuário fechar sem conectar. Com `itemId`, renova o login daquela conexão.
 */
export async function openPluggyConnect(itemId?: string): Promise<ConnectedItem | null> {
  const { accessToken } = await api.openFinanceConnectToken(itemId);
  // SDK carregado só quando usado: fica fora do bundle principal.
  const { PluggyConnect } = await import("pluggy-connect-sdk");
  return new Promise((resolve, reject) => {
    let result: ConnectedItem | null = null;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const widget = new PluggyConnect({
      connectToken: accessToken,
      updateItem: itemId,
      countries: ["BR"],
      language: getLang() === "pt" ? "pt" : "en",
      theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      // A Pluggy mostra a tela de sucesso e o usuário fecha; resolvemos já no sucesso.
      onSuccess: ({ item }) => {
        result = { id: item.id, name: item.connector?.name ?? null };
        finish(() => resolve(result));
      },
      onError: (e) => finish(() => reject(new Error(e.message))),
      onClose: () => finish(() => resolve(result)),
    });
    widget.init().catch((e: unknown) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))));
  });
}
