export const TAX_CALCULATION_VERSION = 1;

export const PRODUCT_TREATMENTS = ["STANDARD", "ZERO", "EXEMPT", "NOT_APPLICABLE", "CUSTOM"];

const NO_VAT = new Set(["ZERO", "EXEMPT", "NOT_APPLICABLE"]);

export function parsePriceToTiyn(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/₸/g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const tiyn = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(tiyn)) return null;
  return tiyn;
}

export function formatTiyn(tiyn) {
  const amount = Number(tiyn);
  if (!Number.isSafeInteger(amount)) return "";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  if (frac === 0) return `${sign}${grouped} ₸`;
  return `${sign}${grouped},${String(frac).padStart(2, "0")} ₸`;
}

export function percentToBasisPoints(value) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", "."));
  if (!Number.isFinite(number) || number < 0 || number > 100) return null;
  const text = number.toFixed(2);
  const points = Number(text.replace(".", ""));
  return Number.isSafeInteger(points) ? points : null;
}

export function basisPointsToPercent(points) {
  if (points == null) return null;
  const number = Number(points);
  if (!Number.isSafeInteger(number) || number < 0 || number > 10000) return null;
  return (number / 100).toFixed(2);
}

export function roundDiv(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error("invalid money division");
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function splitGross(gross, rateBp) {
  if (!Number.isSafeInteger(gross) || gross < 0) throw new Error("invalid gross");
  if (rateBp == null || rateBp === 0) return { net: gross, vat: 0, gross };
  const net = roundDiv(gross * 10000, 10000 + rateBp);
  return { net, vat: gross - net, gross };
}

export function addVat(net, rateBp) {
  if (!Number.isSafeInteger(net) || net < 0) throw new Error("invalid net");
  if (rateBp == null || rateBp === 0) return { net, vat: 0, gross: net };
  const vat = roundDiv(net * rateBp, 10000);
  return { net, vat, gross: net + vat };
}

export function vatCaption(treatment, ratePercent) {
  if (treatment === "EXEMPT") return "Освобождено";
  if (treatment === "NOT_APPLICABLE") return "НДС не применяется";
  if (treatment === "ZERO") return "НДС 0%";
  if (!ratePercent) return "НДС";
  const shown = String(ratePercent).replace(/\.00$/, "").replace(".", ",");
  return `НДС ${shown}%`;
}

export function resolveLineTax(product, org) {
  const registered = org && org.vatRegistered === true;
  const source = product && product.vatRateSource === "PRODUCT" ? "PRODUCT" : "ORGANIZATION";
  if (!registered) return { treatment: "NOT_APPLICABLE", rateBp: null };
  if (source === "ORGANIZATION") {
    return rateForTreatment(org.defaultVatTreatment || "STANDARD", null, org.defaultVatRate);
  }
  return rateForTreatment(product.vatTreatment, product.vatRateBp, org.defaultVatRate);
}

function rateForTreatment(treatment, ownRate, orgRate) {
  const kind = String(treatment || "").toUpperCase();
  if (!PRODUCT_TREATMENTS.includes(kind) && kind !== "REDUCED") {
    throw Object.assign(new Error("invalid vat treatment"), { status: 400 });
  }
  if (NO_VAT.has(kind)) return { treatment: kind, rateBp: kind === "ZERO" ? 0 : null };
  const points = ownRate == null ? percentToBasisPoints(orgRate) : Number(ownRate);
  if (!Number.isSafeInteger(points) || points < 0 || points > 10000) {
    throw Object.assign(new Error("invalid vat rate"), { status: 400 });
  }
  return { treatment: kind, rateBp: points };
}

export function calculateLine({ qty, unitPriceTiyn, pricesIncludeVat, treatment, rateBp }) {
  if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
    throw Object.assign(new Error("invalid qty"), { status: 400 });
  }
  if (!Number.isSafeInteger(unitPriceTiyn) || unitPriceTiyn < 0) {
    throw Object.assign(new Error("invalid price"), { status: 400 });
  }
  const taxable = treatment === "STANDARD" || treatment === "CUSTOM" || treatment === "REDUCED";
  const applied = taxable ? rateBp : treatment === "ZERO" ? 0 : null;
  if (taxable && (applied == null || applied < 0)) {
    throw Object.assign(new Error("invalid vat rate"), { status: 400 });
  }
  const unit = pricesIncludeVat ? splitGross(unitPriceTiyn, applied) : addVat(unitPriceTiyn, applied);
  const lineBase = unitPriceTiyn * qty;
  if (!Number.isSafeInteger(lineBase)) {
    throw Object.assign(new Error("invalid price"), { status: 400 });
  }
  const line = pricesIncludeVat ? splitGross(lineBase, applied) : addVat(lineBase, applied);
  if (unit.net + unit.vat !== unit.gross || line.net + line.vat !== line.gross) {
    throw new Error("vat invariant failed");
  }
  return {
    qty,
    treatment,
    rateBp: applied,
    pricesIncludeVat: pricesIncludeVat === true,
    unitPrice: unitPriceTiyn,
    unitNet: unit.net,
    unitVat: unit.vat,
    unitGross: unit.gross,
    lineNet: line.net,
    lineVat: line.vat,
    lineGross: line.gross,
  };
}

export function sumLines(lines) {
  return lines.reduce(
    (sum, line) => ({
      net: sum.net + line.lineNet,
      vat: sum.vat + line.lineVat,
      gross: sum.gross + line.lineGross,
    }),
    { net: 0, vat: 0, gross: 0 }
  );
}

export function groupVat(lines) {
  const groups = new Map();
  for (const line of lines) {
    const rate = basisPointsToPercent(line.rateBp);
    const key = `${line.treatment}|${rate || ""}`;
    const current = groups.get(key) || {
      treatment: line.treatment,
      rate,
      caption: vatCaption(line.treatment, rate),
      net: 0,
      vat: 0,
    };
    current.net += line.lineNet;
    current.vat += line.lineVat;
    groups.set(key, current);
  }
  return [...groups.values()];
}
