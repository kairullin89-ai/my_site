import {
  TAX_CALCULATION_VERSION,
  basisPointsToPercent,
  calculateLine,
  formatTiyn,
  groupVat,
  parsePriceToTiyn,
  resolveLineTax,
  sumLines,
  vatCaption,
} from "./vat.js";

export function collectOrderItems(requested) {
  const source = Array.isArray(requested) ? requested : [];
  if (!source.length) throw Object.assign(new Error("items required"), { status: 400 });
  const merged = new Map();
  for (const item of source) {
    const id = String(item && item.id ? item.id : "").trim();
    if (!id) throw Object.assign(new Error("unknown product"), { status: 400 });
    const raw = item && item.qty;
    const qty = Number.isInteger(raw) ? raw : Number(raw);
    if (!Number.isInteger(qty) || qty < 1) throw Object.assign(new Error("invalid qty"), { status: 400 });
    const next = (merged.get(id) || 0) + qty;
    if (next > 999) throw Object.assign(new Error("invalid qty"), { status: 400 });
    merged.set(id, next);
    if (merged.size > 50) throw Object.assign(new Error("items required"), { status: 400 });
  }
  return [...merged.entries()].map(([id, qty]) => ({ id, qty }));
}

export function quoteOrderLines(requested, products, org) {
  const tax = org && org.tax ? org.tax : {};
  if (tax.catalogPricesConfirmed !== true) return null;
  const byId = new Map((products || []).map((product) => [product.id, product]));
  const source = collectOrderItems(requested);
  const lines = source.map((item) => {
    const product = byId.get(item.id);
    if (!product) throw Object.assign(new Error("unknown product"), { status: 400 });
    const qty = item.qty;
    const unitPriceTiyn = parsePriceToTiyn(product.price);
    if (unitPriceTiyn == null) throw Object.assign(new Error("invalid price"), { status: 400 });
    const resolved = resolveLineTax(product, tax);
    const calc = calculateLine({
      qty,
      unitPriceTiyn,
      pricesIncludeVat: tax.pricesIncludeVat === true,
      treatment: resolved.treatment,
      rateBp: resolved.rateBp,
    });
    return { product, calc };
  });
  const totals = sumLines(lines.map((line) => line.calc));
  if (totals.net + totals.vat !== totals.gross) throw new Error("vat invariant failed");
  const groups = groupVat(lines.map((line) => line.calc));
  return {
    version: TAX_CALCULATION_VERSION,
    pricesIncludeVat: tax.pricesIncludeVat === true,
    totals,
    groups,
    lines,
  };
}

export function presentQuote(quote) {
  if (!quote) return null;
  return {
    taxDataStatus: "SNAPSHOT",
    taxCalculationVersion: quote.version,
    pricesIncludeVat: quote.pricesIncludeVat,
    subtotalWithoutVat: quote.totals.net,
    vatTotal: quote.totals.vat,
    grandTotal: quote.totals.gross,
    subtotalWithoutVatText: formatTiyn(quote.totals.net),
    vatTotalText: formatTiyn(quote.totals.vat),
    grandTotalText: formatTiyn(quote.totals.gross),
    taxLines: quote.groups.map((group) => ({
      treatment: group.treatment,
      rate: group.rate,
      caption: group.caption,
      net: group.net,
      vat: group.vat,
      netText: formatTiyn(group.net),
      vatText: formatTiyn(group.vat),
    })),
    items: quote.lines.map(({ product, calc }) => ({
      id: product.id,
      name: product.name,
      unit: product.unit || "шт",
      qty: calc.qty,
      price: formatTiyn(calc.pricesIncludeVat ? calc.unitGross : calc.unitNet),
      lineTotal: formatTiyn(calc.pricesIncludeVat ? calc.lineGross : calc.lineNet),
      vatTreatment: calc.treatment,
      vatRate: basisPointsToPercent(calc.rateBp),
      vatCaption: vatCaption(calc.treatment, basisPointsToPercent(calc.rateBp)),
      priceIncludesVat: calc.pricesIncludeVat,
      unitPrice: calc.unitPrice,
      unitPriceWithoutVat: calc.unitNet,
      unitVatAmount: calc.unitVat,
      unitPriceWithVat: calc.unitGross,
      amountWithoutVat: calc.lineNet,
      vatAmount: calc.lineVat,
      amountWithVat: calc.lineGross,
      amountWithoutVatText: formatTiyn(calc.lineNet),
      vatAmountText: formatTiyn(calc.lineVat),
      amountWithVatText: formatTiyn(calc.lineGross),
    })),
  };
}
