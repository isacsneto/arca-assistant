import { useSyncExternalStore } from "react";

/* Alto contraste: lembrado por aparelho (como o olho de privacidade) e aplicado no <html data-contrast="high">. */
const KEY = "arca:contrast";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "high";
  } catch {
    return false;
  }
}
let current = read();

/** Aplica no documento (chamado já na carga, antes da primeira pintura). */
export function applyContrast(high = current) {
  if (high) document.documentElement.dataset.contrast = "high";
  else delete document.documentElement.dataset.contrast;
}

export function setHighContrast(high: boolean) {
  current = high;
  try {
    localStorage.setItem(KEY, high ? "high" : "normal");
  } catch {
    /* sem storage: vale só até recarregar */
  }
  applyContrast(high);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** [alto contraste?, alternar] */
export function useHighContrast(): [boolean, () => void] {
  const high = useSyncExternalStore(subscribe, () => current);
  return [high, () => setHighContrast(!current)];
}
