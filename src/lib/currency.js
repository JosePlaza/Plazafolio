/**
 * Returns the currency symbol for a given ticker.
 * European tickers (containing '.') use €, all others use $.
 */
export function getCurrencySymbol(ticker) {
  if (!ticker) return '$'
  return ticker.includes('.') ? '€' : '$'
}
