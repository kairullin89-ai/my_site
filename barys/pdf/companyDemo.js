export const DEMO_COMPANY = {
  isDemo: true,
  name: "ТОО «БАРЫС» (DEMO)",
  bin: "DEMO-BIN",
  iban: "DEMO-IBAN",
  bic: "DEMO-BIC",
  bankName: "DEMO BANK",
  address: "DEMO — укажите юридический адрес",
  phone: "+7 XXX XXX XX XX",
  email: "demo@example.com",
  paymentPurpose: "",
};

export function demoCompany() {
  return { ...DEMO_COMPANY, isDemo: true };
}
