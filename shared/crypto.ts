import type { Position } from "./types";

/** Nomes comuns de criptomoedas → símbolo no Yahoo (para posições sem ticker). */
export const CRYPTO_BY_NAME: [RegExp, string][] = [
  [/\bbitcoin\b/i, "BTC-USD"],
  [/\bethereum\b|\bether\b/i, "ETH-USD"],
  [/\bsolana\b/i, "SOL-USD"],
];

/** Tickers de criptomoedas (como aparecem em exchanges). */
const COINS = new Set([
  "BTC", "ETH", "SOL", "USDT", "USDC", "BNB", "XRP", "ADA", "DOGE", "DOT", "AVAX", "LINK", "LTC", "TRX", "MATIC", "POL", "TON", "SHIB", "BCH", "XLM", "ATOM", "UNI", "NEAR", "APT", "ARB", "OP", "SUI", "PEPE",
]);

/** ETFs de cripto na B3 e nos EUA. */
const CRYPTO_ETFS = new Set([
  "HASH11", "QBTC11", "QETH11", "QSOL11", "BITH11", "ETHE11", "BITI11", "DEFI11", "WEB311", "NFTS11", "SOLH11", "XRPH11",
  "IBIT", "FBTC", "GBTC", "BITB", "ARKB", "BITO", "ETHA", "FETH",
]);

/** A posição é uma criptomoeda (ou ETF de cripto)? */
export function isCrypto(p: Pick<Position, "name" | "subtype"> & { ticker?: string | null }): boolean {
  const t = p.ticker?.trim().toUpperCase().replace(/\.SA$|-USD$|-BRL$/, "");
  if (t && (COINS.has(t) || CRYPTO_ETFS.has(t))) return true;
  if (/\bcripto|\bcrypto/i.test(p.subtype) || /\bcripto|\bcrypto/i.test(p.name)) return true;
  return CRYPTO_BY_NAME.some(([re]) => re.test(p.name));
}
