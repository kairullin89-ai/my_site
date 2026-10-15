export const REQUIRED_ENV = [
  "SUPPORT_EMAIL",
  "TELEGRAM_USERNAME",
  "WHATSAPP_NUMBER",
  "ADMIN_PASSWORD",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
];

export function missingEnvKeys(env) {
  const source = env || {};
  return REQUIRED_ENV.filter((key) => !String(source[key] || "").trim());
}

export function assertRuntimeConfig(env) {
  const missing = missingEnvKeys(env);
  if (!missing.length) return;
  console.error(`Не заданы переменные окружения: ${missing.join(", ")}`);
  process.exit(1);
}
