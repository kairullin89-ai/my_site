import { formatTiyn } from "../finance/vat.js";
import { demoFacturaBuyer, demoFacturaSeller } from "./invoiceFacturaDemo.js";
import { organizationToFacturaSeller } from "../organization.js";

export function accountingNumber(orderId) {
  return `SF-${String(orderId || "")}`;
}

export function esfRegistrationText(document, notRegistered) {
  const status = document && document.status;
  const number = document && document.esfRegistrationNumber != null ? String(document.esfRegistrationNumber).trim() : "";
  if (status === "registered" && number) return number;
  return notRegistered;
}

export function buildInvoiceFacturaData(order, options = {}) {
  const source = order && typeof order === "object" ? order : {};
  const sellerInput = options.seller || (options.organization ? organizationToFacturaSeller(options.organization) : demoFacturaSeller());
  const buyerInput = options.buyer || demoFacturaBuyer();
  const now = options.now instanceof Date ? options.now : new Date();
  const id = String(source.id || "");
  const items = Array.isArray(source.items) ? source.items : [];
  return {
    document: {
      type: "ordinary",
      status: "preliminary",
      accountingNumber: accountingNumber(id),
      esfRegistrationNumber: null,
      issueDate: now.toISOString(),
      turnoverDate: null,
      paperIssueDate: null,
    },
    seller: party(sellerInput, "bin"),
    buyer: party(buyerInput, "binIin"),
    orderId: id,
    orderPhone: String(source.phone || "").trim(),
    orderComment: String(source.comment || "").trim(),
    items: items.map((item, index) => ({
      index: index + 1,
      description: String(item && item.name ? item.name : ""),
      unit: String(item && item.unit ? item.unit : ""),
      quantity: item && item.qty != null ? String(item.qty) : "",
      unitPrice: item && item.price != null ? String(item.price) : "",
      lineTotal: item && item.lineTotal != null ? String(item.lineTotal) : "",
      amountWithoutVat: moneyText(source, item, "amountWithoutVat"),
      vatRate: source.taxDataStatus === "SNAPSHOT" ? storedRate(item) : null,
      vatRateLabel: source.taxDataStatus === "SNAPSHOT" ? rateLabel(item) : null,
      vatAmount: moneyText(source, item, "vatAmount"),
      amountWithVat: moneyText(source, item, "amountWithVat"),
      productCode: null,
      origin: null,
    })),
    totals: {
      orderTotal: String(source.total ?? ""),
      amountWithoutVat: source.taxDataStatus === "SNAPSHOT" ? String(source.subtotalWithoutVatText || "") : null,
      vatAmount: source.taxDataStatus === "SNAPSHOT" ? String(source.vatTotalText || "") : null,
      amountWithVat: source.taxDataStatus === "SNAPSHOT" ? String(source.grandTotalText || source.total || "") : null,
    },
    hasTaxSnapshot: source.taxDataStatus === "SNAPSHOT",
  };
}

function moneyText(source, item, key) {
  if (!source || source.taxDataStatus !== "SNAPSHOT" || !item || item[key] == null) return null;
  return formatTiyn(item[key]);
}

function storedRate(item) {
  if (!item || item.vatRateBp == null) return null;
  const text = String(item.vatRateBp).padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

function rateLabel(item) {
  if (!item) return null;
  if (item.vatTreatment === "EXEMPT" || item.vatTreatment === "NOT_APPLICABLE") return "—";
  if (item.vatRateBp == null) return "—";
  const text = String(item.vatRateBp).padStart(3, "0");
  const whole = text.slice(0, -2);
  const frac = text.slice(-2);
  return `${frac === "00" ? whole : `${whole},${frac}`}%`;
}

function party(input, idKey) {
  const source = input && typeof input === "object" ? input : {};
  const rate = source.defaultVatRate;
  return {
    isDemo: source.isDemo === true,
    name: String(source.name || ""),
    identifier: String(source[idKey] || ""),
    address: String(source.address || ""),
    countryCode: String(source.countryCode || ""),
    bankName: String(source.bankName || ""),
    iban: String(source.iban || ""),
    bic: String(source.bic || ""),
    kbe: String(source.kbe || ""),
    vatRegistered: source.vatRegistered == null ? null : source.vatRegistered === true,
    vatRegistrationData: String(source.vatRegistrationData || ""),
    defaultVatRate: typeof rate === "number" && Number.isFinite(rate) ? rate : null,
    defaultVatTreatment: String(source.defaultVatTreatment || ""),
  };
}
