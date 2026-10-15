export const DEMO_FACTURA_SELLER = {
  isDemo: true,
  name: "ТОО «БАРЫС» (DEMO)",
  bin: "DEMO-BIN",
  address: "DEMO — укажите юридический адрес",
  countryCode: "",
  bankName: "DEMO BANK",
  iban: "DEMO-IBAN",
  bic: "DEMO-BIC",
  kbe: "DEMO-KBE",
  vatRegistered: null,
  vatRegistrationData: "",
};

export const DEMO_FACTURA_BUYER = {
  isDemo: true,
  name: "DEMO BUYER",
  binIin: "DEMO",
  address: "DEMO — адрес получателя не указан",
  countryCode: "",
};

export function demoFacturaSeller() {
  return { ...DEMO_FACTURA_SELLER, isDemo: true, vatRegistered: null };
}

export function demoFacturaBuyer() {
  return { ...DEMO_FACTURA_BUYER, isDemo: true };
}
