import { useSyncExternalStore } from "react";

/* Olho de privacidade: lembrado por aparelho (o celular pode ficar oculto e o PC não). */
const KEY = "arca:hideValues";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
let current = read();

export function setHideValues(h: boolean) {
  current = h;
  try {
    localStorage.setItem(KEY, h ? "1" : "0");
  } catch {
    /* sem storage: vale só até recarregar */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** [oculto?, alternar] */
export function useHideValues(): [boolean, () => void] {
  const hidden = useSyncExternalStore(subscribe, () => current);
  return [hidden, () => setHideValues(!current)];
}
