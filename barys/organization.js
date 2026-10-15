import { isAdminCredential } from "./adminAuth.js";

const TREATMENTS = ["STANDARD", "REDUCED", "ZERO", "EXEMPT", "CUSTOM"];
const REGIMES = ["GENERAL", "SIMPLIFIED", "OTHER"];
const STORED_KEYS = [
  "legalName",
  "shortName",
  "bin",
  "countryCode",
  "region",
  "city",
  "legalAddress",
  "phone",
  "email",
  "website",
  "bankName",
  "iban",
  "bic",
  "kbe",
  "bankCurrency",
  "taxRegime",
  "vatRegistered",
  "defaultVatRate",
  "defaultVatTreatment",
  "vatRegistrationDate",
  "vatRegistrationStatus",
  "isDemo",
];

export const DEMO_ORGANIZATION = {
  legalName: "ТОО «DEMO BETON SYSTEMS»",
  shortName: "DEMO BETON",
  bin: "DEMO-BIN-000001",
  countryCode: "KZ",
  region: "DEMO",
  city: "DEMO CITY",
  legalAddress: "DEMO ADDRESS — НЕСУЩЕСТВУЮЩИЙ АДРЕС",
  phone: "+7 XXX XXX XX XX",
  email: "demo@example.invalid",
  website: "",
  bankName: "DEMO BANK — НЕСУЩЕСТВУЮЩИЙ",
  iban: "DEMO-IBAN-KZ",
  bic: "DEMO-BIC",
  kbe: "DEMO",
  bankCurrency: "KZT",
  taxRegime: "GENERAL",
  vatRegistered: true,
  defaultVatRate: 16,
  defaultVatTreatment: "STANDARD",
  vatRegistrationDate: null,
  vatRegistrationStatus: "DEMO",
  isDemo: true,
};

export function ensureOrganizationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      legal_name TEXT NOT NULL,
      short_name TEXT NOT NULL DEFAULT '',
      bin TEXT NOT NULL,
      country_code TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      legal_address TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      iban TEXT NOT NULL DEFAULT '',
      bic TEXT NOT NULL DEFAULT '',
      kbe TEXT NOT NULL DEFAULT '',
      bank_currency TEXT NOT NULL DEFAULT 'KZT',
      tax_regime TEXT NOT NULL,
      vat_registered INTEGER NOT NULL,
      default_vat_rate REAL,
      default_vat_treatment TEXT NOT NULL,
      vat_registration_date TEXT,
      vat_registration_status TEXT NOT NULL DEFAULT '',
      prices_include_vat INTEGER,
      catalog_prices_confirmed INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  const names = new Set(db.prepare("PRAGMA table_info(organization_settings)").all().map((column) => column.name));
  if (!names.has("prices_include_vat")) {
    db.exec("ALTER TABLE organization_settings ADD COLUMN prices_include_vat INTEGER");
  }
  if (!names.has("catalog_prices_confirmed")) {
    db.exec("ALTER TABLE organization_settings ADD COLUMN catalog_prices_confirmed INTEGER NOT NULL DEFAULT 0");
  }
}

export const ORGANIZATION_NOT_CONFIGURED = "Организация не настроена";

export function invoiceOrganizationError(organization) {
  if (!organization || organization.isDemo === true) {
    return { status: 422, json: { error: ORGANIZATION_NOT_CONFIGURED } };
  }
  return null;
}

export function seedDemoOrganization(db) {
  ensureOrganizationSchema(db);
  const existing = db.prepare("SELECT id FROM organization_settings WHERE id = 1").get();
  if (existing) return false;
  insertOrganizationRow(db, publicToRow(DEMO_ORGANIZATION), new Date().toISOString());
  return true;
}

export function readOrganization(db) {
  ensureOrganizationSchema(db);
  const row = db.prepare("SELECT * FROM organization_settings WHERE id = 1").get();
  return row ? toPublic(row) : null;
}

function blankOrganization() {
  return {
    legalName: "",
    shortName: "",
    bin: "",
    countryCode: "",
    region: "",
    city: "",
    legalAddress: "",
    phone: "",
    email: "",
    website: "",
    bank: { name: "", iban: "", bic: "", kbe: "", currency: "" },
    tax: {
      regime: "",
      vatRegistered: false,
      defaultVatRate: null,
      defaultVatTreatment: "",
      vatRegistrationDate: null,
      vatRegistrationStatus: "",
      pricesIncludeVat: null,
      catalogPricesConfirmed: false,
    },
    isDemo: false,
  };
}

function publicToRow(org) {
  return {
    legalName: org.legalName,
    shortName: org.shortName || "",
    bin: org.bin,
    countryCode: org.countryCode,
    region: org.region || "",
    city: org.city || "",
    legalAddress: org.legalAddress,
    phone: org.phone || "",
    email: org.email || "",
    website: org.website || "",
    bankName: org.bankName || "",
    iban: org.iban || "",
    bic: org.bic || "",
    kbe: org.kbe || "",
    bankCurrency: org.bankCurrency || "KZT",
    taxRegime: org.taxRegime,
    vatRegistered: org.vatRegistered ? 1 : 0,
    defaultVatRate: org.defaultVatRate == null ? null : org.defaultVatRate,
    defaultVatTreatment: org.defaultVatTreatment,
    vatRegistrationDate: org.vatRegistrationDate || null,
    vatRegistrationStatus: org.vatRegistrationStatus || "",
    pricesIncludeVat: org.pricesIncludeVat == null ? null : org.pricesIncludeVat ? 1 : 0,
    catalogPricesConfirmed: org.catalogPricesConfirmed ? 1 : 0,
    isDemo: org.isDemo ? 1 : 0,
  };
}

function insertOrganizationRow(db, row, now) {
  db.prepare(
    `INSERT INTO organization_settings (
      id, legal_name, short_name, bin, country_code, region, city, legal_address,
      phone, email, website, bank_name, iban, bic, kbe, bank_currency,
      tax_regime, vat_registered, default_vat_rate, default_vat_treatment,
      vat_registration_date, vat_registration_status, prices_include_vat, catalog_prices_confirmed, is_demo, created_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.legalName,
    row.shortName,
    row.bin,
    row.countryCode,
    row.region,
    row.city,
    row.legalAddress,
    row.phone,
    row.email,
    row.website,
    row.bankName,
    row.iban,
    row.bic,
    row.kbe,
    row.bankCurrency,
    row.taxRegime,
    row.vatRegistered,
    row.defaultVatRate,
    row.defaultVatTreatment,
    row.vatRegistrationDate,
    row.vatRegistrationStatus,
    row.pricesIncludeVat,
    row.catalogPricesConfirmed,
    row.isDemo,
    now,
    now
  );
}

function updateOrganizationRow(db, next, now) {
  db.prepare(
    `UPDATE organization_settings SET
      legal_name = ?, short_name = ?, bin = ?, country_code = ?, region = ?, city = ?, legal_address = ?,
      phone = ?, email = ?, website = ?, bank_name = ?, iban = ?, bic = ?, kbe = ?, bank_currency = ?,
      tax_regime = ?, vat_registered = ?, default_vat_rate = ?, default_vat_treatment = ?,
      vat_registration_date = ?, vat_registration_status = ?, prices_include_vat = ?, catalog_prices_confirmed = ?, is_demo = ?, updated_at = ?
     WHERE id = 1`
  ).run(
    next.legalName,
    next.shortName,
    next.bin,
    next.countryCode,
    next.region,
    next.city,
    next.legalAddress,
    next.phone,
    next.email,
    next.website,
    next.bankName,
    next.iban,
    next.bic,
    next.kbe,
    next.bankCurrency,
    next.taxRegime,
    next.vatRegistered ? 1 : 0,
    next.defaultVatRate,
    next.defaultVatTreatment,
    next.vatRegistrationDate,
    next.vatRegistrationStatus,
    next.pricesIncludeVat == null ? null : next.pricesIncludeVat ? 1 : 0,
    next.catalogPricesConfirmed ? 1 : 0,
    next.isDemo ? 1 : 0,
    now
  );
}

function withOrganizationTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* rollback itself failed; the original error is the one to surface */
    }
    throw err;
  }
}

export function writeOrganization(db, body) {
  ensureOrganizationSchema(db);
  const stored = readOrganization(db);
  const current = stored || blankOrganization();
  const next = mergeOrganization(current, body);
  const now = new Date().toISOString();
  withOrganizationTransaction(db, () => {
    if (stored) updateOrganizationRow(db, next, now);
    else insertOrganizationRow(db, publicToRow(next), now);
    if (body.confirmCatalogPrices === true) {
      db.prepare(
        `UPDATE products
         SET vat_status = CASE WHEN vat_rate_source = 'PRODUCT' THEN 'CONFIGURED' ELSE 'INHERIT' END
         WHERE vat_status = 'VAT_NOT_CONFIGURED'`
      ).run();
    }
  });
  return readOrganization(db);
}

export function handleOrganization({ db, method, raw, env, adminHeader }) {
  if (!isAdmin(env, adminHeader)) return { status: 401, body: { error: "unauthorized" } };
  if (method === "GET") return { status: 200, body: readOrganization(db) };
  if (method !== "PUT") return { status: 405, body: { error: "method not allowed" } };
  let parsed;
  try {
    parsed = raw && String(raw).trim() ? JSON.parse(raw) : {};
  } catch {
    return { status: 400, body: { error: "invalid json" } };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: 400, body: { error: "invalid json" } };
  }
  try {
    return { status: 200, body: writeOrganization(db, parsed) };
  } catch (err) {
    const status = err && Number.isInteger(err.status) ? err.status : 500;
    if (status >= 500) {
      console.error(err && err.message ? err.message : err);
      return { status: 500, body: { error: "organization failed" } };
    }
    return { status, body: { error: err && err.message ? err.message : "organization failed" } };
  }
}

export function organizationToInvoiceCompany(org) {
  const source = org || {};
  const bank = source.bank || {};
  return {
    isDemo: source.isDemo === true,
    name: String(source.legalName || ""),
    bin: String(source.bin || ""),
    iban: String(bank.iban || ""),
    bic: String(bank.bic || ""),
    bankName: String(bank.name || ""),
    kbe: String(bank.kbe || ""),
    address: String(source.legalAddress || ""),
    phone: String(source.phone || ""),
    email: String(source.email || ""),
  };
}

export function organizationToFacturaSeller(org) {
  const source = org || {};
  const bank = source.bank || {};
  const tax = source.tax || {};
  return {
    isDemo: source.isDemo === true,
    name: String(source.legalName || ""),
    bin: String(source.bin || ""),
    address: String(source.legalAddress || ""),
    countryCode: String(source.countryCode || ""),
    bankName: String(bank.name || ""),
    iban: String(bank.iban || ""),
    bic: String(bank.bic || ""),
    kbe: String(bank.kbe || ""),
    vatRegistered: tax.vatRegistered === true,
    vatRegistrationData: tax.vatRegistrationDate ? String(tax.vatRegistrationDate) : "",
    defaultVatRate: typeof tax.defaultVatRate === "number" ? tax.defaultVatRate : null,
    defaultVatTreatment: String(tax.defaultVatTreatment || ""),
  };
}

function toPublic(row) {
  return {
    legalName: row.legal_name,
    shortName: row.short_name,
    bin: row.bin,
    countryCode: row.country_code,
    region: row.region,
    city: row.city,
    legalAddress: row.legal_address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    bank: {
      name: row.bank_name,
      iban: row.iban,
      bic: row.bic,
      kbe: row.kbe,
      currency: row.bank_currency,
    },
    tax: {
      regime: row.tax_regime,
      vatRegistered: row.vat_registered === 1,
      defaultVatRate: row.default_vat_rate == null ? null : Number(row.default_vat_rate),
      defaultVatTreatment: row.default_vat_treatment,
      vatRegistrationDate: row.vat_registration_date || null,
      vatRegistrationStatus: row.vat_registration_status,
      pricesIncludeVat: row.prices_include_vat == null ? null : row.prices_include_vat === 1,
      catalogPricesConfirmed: row.catalog_prices_confirmed === 1,
    },
    isDemo: row.is_demo === 1,
  };
}

function mergeOrganization(current, body) {
  const unknown = Object.keys(body).filter(
    (key) => key !== "confirmProduction" && key !== "confirmCatalogPrices" && !STORED_KEYS.includes(key) && key !== "bank" && key !== "tax"
  );
  if (unknown.length) fail(400, "unknown field");
  if (body.bank && typeof body.bank !== "object") fail(400, "invalid bank");
  if (body.tax && typeof body.tax !== "object") fail(400, "invalid tax");
  const bank = body.bank || {};
  const tax = body.tax || {};
  for (const key of Object.keys(bank)) {
    if (!["name", "iban", "bic", "kbe", "currency"].includes(key)) fail(400, "unknown field");
  }
  for (const key of Object.keys(tax)) {
    if (!["regime", "vatRegistered", "defaultVatRate", "defaultVatTreatment", "vatRegistrationDate", "vatRegistrationStatus", "pricesIncludeVat"].includes(key)) {
      fail(400, "unknown field");
    }
  }
  const next = {
    legalName: pickText(body, "legalName", current.legalName, 200),
    shortName: pickText(body, "shortName", current.shortName, 80),
    bin: pickText(body, "bin", current.bin, 32),
    countryCode: pickText(body, "countryCode", current.countryCode, 2).toUpperCase(),
    region: pickText(body, "region", current.region, 80),
    city: pickText(body, "city", current.city, 80),
    legalAddress: pickText(body, "legalAddress", current.legalAddress, 400),
    phone: pickText(body, "phone", current.phone, 40),
    email: pickText(body, "email", current.email, 120),
    website: pickText(body, "website", current.website, 160),
    bankName: pickText(bank, "name", current.bank.name, 160, body.bankName),
    iban: pickText(bank, "iban", current.bank.iban, 42, body.iban),
    bic: pickText(bank, "bic", current.bank.bic, 16, body.bic),
    kbe: pickText(bank, "kbe", current.bank.kbe, 16, body.kbe),
    bankCurrency: pickText(bank, "currency", current.bank.currency, 3, body.bankCurrency).toUpperCase(),
    taxRegime: pickText(tax, "regime", current.tax.regime, 20, body.taxRegime).toUpperCase(),
    vatRegistered: pickBool(tax, "vatRegistered", current.tax.vatRegistered, body.vatRegistered),
    defaultVatRate: pickRate(tax, current.tax.defaultVatRate, body.defaultVatRate),
    defaultVatTreatment: pickText(tax, "defaultVatTreatment", current.tax.defaultVatTreatment, 20, body.defaultVatTreatment).toUpperCase(),
    vatRegistrationDate: pickDate(tax, current.tax.vatRegistrationDate, body.vatRegistrationDate),
    vatRegistrationStatus: pickText(tax, "vatRegistrationStatus", current.tax.vatRegistrationStatus, 40, body.vatRegistrationStatus),
    pricesIncludeVat: pickPriceMode(body, tax, current),
    catalogPricesConfirmed: body.confirmCatalogPrices === true ? true : current.tax.catalogPricesConfirmed === true,
    isDemo: pickBool({ isDemo: body.isDemo }, "isDemo", current.isDemo),
  };
  next.iban = next.iban.toUpperCase().replace(/\s+/g, "");
  next.bic = next.bic.toUpperCase().replace(/\s+/g, "");
  if (!next.isDemo && next.vatRegistrationStatus.toUpperCase() === "DEMO") next.vatRegistrationStatus = "";
  if (current.isDemo && next.isDemo === false && body.confirmProduction !== true) {
    fail(400, "production confirmation required");
  }
  validateOrganization(next);
  return next;
}

function validateOrganization(org) {
  if (!org.legalName) fail(400, "legal name required");
  if (!org.bin) fail(400, "bin required");
  if (!/^[A-Z]{2}$/.test(org.countryCode)) fail(400, "invalid country");
  if (!org.legalAddress) fail(400, "address required");
  if (org.email && !/^[^\s@]+@[^\s@]+$/.test(org.email)) fail(400, "invalid email");
  if (!REGIMES.includes(org.taxRegime)) fail(400, "invalid tax regime");
  if (!TREATMENTS.includes(org.defaultVatTreatment)) fail(400, "invalid vat treatment");
  if (!/^[A-Z]{3}$/.test(org.bankCurrency)) fail(400, "invalid currency");
  if (org.vatRegistered && (typeof org.defaultVatRate !== "number" || org.defaultVatRate < 0 || org.defaultVatRate > 100)) {
    fail(400, "invalid vat rate");
  }
  if (!org.vatRegistered && org.defaultVatRate != null && (org.defaultVatRate < 0 || org.defaultVatRate > 100)) {
    fail(400, "invalid vat rate");
  }
  if (org.isDemo) return;
  if (/demo/i.test(org.legalName)) fail(400, "invalid name");
  if (/demo|несуществующ/i.test(org.legalAddress)) fail(400, "invalid address");
  if (/demo/i.test(org.region) || /demo/i.test(org.city)) fail(400, "invalid city");
  if (org.phone === "+7 XXX XXX XX XX" || /X{2,}/.test(org.phone)) fail(400, "invalid phone");
  if (/\.invalid$/i.test(org.email) || /demo@example/i.test(org.email)) fail(400, "invalid email");
  if (!/^\d{12}$/.test(org.bin) || /demo/i.test(org.bin)) fail(400, "invalid bin");
  if (!org.bankName || /demo/i.test(org.bankName)) fail(400, "invalid bank");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(org.iban) || /demo/i.test(org.iban)) fail(400, "invalid iban");
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(org.bic) || /demo/i.test(org.bic)) fail(400, "invalid bic");
  if (/demo/i.test(org.kbe)) fail(400, "invalid kbe");
  if (/demo/i.test(org.vatRegistrationStatus)) fail(400, "invalid vat status");
}

function pickText(source, key, fallback, max, flat) {
  const value = source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : flat;
  if (value == null) return String(fallback || "");
  return String(value).trim().slice(0, max);
}

function pickPriceMode(body, tax, current) {
  const fromBody = Object.prototype.hasOwnProperty.call(body, "pricesIncludeVat");
  const fromTax = tax && Object.prototype.hasOwnProperty.call(tax, "pricesIncludeVat");
  const value = fromBody ? body.pricesIncludeVat : fromTax ? tax.pricesIncludeVat : null;
  if (body.confirmCatalogPrices === true) {
    if (value !== true && value !== false) fail(400, "price mode required");
    return value;
  }
  if (value == null) return current.tax.pricesIncludeVat == null ? null : current.tax.pricesIncludeVat === true;
  if (value !== true && value !== false) fail(400, "invalid price mode");
  return value;
}

function pickBool(source, key, fallback, flat) {
  const value = source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : flat;
  if (value == null) return Boolean(fallback);
  return value === true || value === 1;
}

function pickRate(tax, fallback, flat) {
  const hasTax = tax && Object.prototype.hasOwnProperty.call(tax, "defaultVatRate");
  const value = hasTax ? tax.defaultVatRate : flat;
  if (value == null || value === "") return hasTax || flat === null ? null : fallback;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) fail(400, "invalid vat rate");
  return number;
}

function pickDate(tax, fallback, flat) {
  const hasTax = tax && Object.prototype.hasOwnProperty.call(tax, "vatRegistrationDate");
  const value = hasTax ? tax.vatRegistrationDate : flat;
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(400, "invalid vat date");
  const stamp = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== text) fail(400, "invalid vat date");
  return text;
}

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function isAdmin(env, header) {
  return isAdminCredential(env, header, null);
}
