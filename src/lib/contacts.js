export function formatWaLabel(num) {
  const digits = String(num || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("7")) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return digits ? `+${digits}` : "";
}

export async function fetchContacts() {
  let res;
  try {
    res = await fetch("/api/contacts");
  } catch (err) {
    console.error(err);
    throw new Error("Не удалось загрузить контакты");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Не удалось загрузить контакты");
    console.error(error);
    throw error;
  }
  if (!data.whatsapp || !data.telegram || !data.email) {
    const error = new Error("Контакты на сервере не настроены");
    console.error(error);
    throw error;
  }
  const whatsapp = String(data.whatsapp);
  const telegram = String(data.telegram).replace(/^@/, "");
  return {
    whatsapp,
    whatsappUrl: data.whatsappUrl || `https://wa.me/${whatsapp}`,
    telegram,
    telegramUrl: data.telegramUrl || `https://t.me/${telegram}`,
    email: String(data.email),
  };
}
