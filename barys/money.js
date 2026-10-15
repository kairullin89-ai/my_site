export const RATES = {
  kzt: { perKzt: 1, symbol: "₸", code: "KZT" },
  usd: { perKzt: 1 / 510, symbol: "$", code: "USD" },
  rub: { perKzt: 1 / 5.2, symbol: "₽", code: "RUB" },
};

export function parseAmount(price) {
  const n = Number(String(price).replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function parseKzt(price) {
  return parseAmount(price);
}

function currencyKeyOf(currency) {
  return RATES[currency] ? currency : "kzt";
}

export function roundedAmount(priceKzt, currency) {
  const key = currencyKeyOf(currency);
  return Math.round(parseKzt(priceKzt) * RATES[key].perKzt);
}

export function formatRounded(amount, currency) {
  const key = currencyKeyOf(currency);
  const text =
    key === "usd"
      ? amount.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : Math.round(amount).toLocaleString("ru-RU");
  return `${text} ${RATES[key].symbol}`;
}

export function formatKztString(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function toKzt(amount, fromCurrency) {
  const key = RATES[fromCurrency] ? fromCurrency : "kzt";
  const value = parseAmount(amount) / RATES[key].perKzt;
  return formatKztString(value);
}

export function fromKzt(priceKzt, toCurrency) {
  const key = RATES[toCurrency] ? toCurrency : "kzt";
  const value = parseKzt(priceKzt) * RATES[key].perKzt;
  if (key === "usd") return String(Math.round(value));
  return formatKztString(value);
}

export function formatPrice(priceKzt, currency) {
  return formatRounded(roundedAmount(priceKzt, currency), currency);
}

export function currencyAsked(text) {
  const t = String(text || "").toLowerCase().replace(/ё/g, "е");
  if (/доллар|\busd\b|бакс/.test(t)) return "usd";
  if (/рубл|\brub\b/.test(t)) return "rub";
  if (/тенге|\bkzt\b/.test(t)) return "kzt";
  return "";
}
