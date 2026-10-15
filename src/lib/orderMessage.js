export function buildOrderMessage(order) {
  const channelLabel = order.channel === "telegram" ? "Telegram" : "WhatsApp";
  const lines = [
    "Здравствуйте! Хочу оформить заказ с сайта Барыс.",
    "",
    `Заказ: ${order.id}`,
    `Имя: ${order.name}`,
    `Телефон: ${order.phone}`,
    `Канал: ${channelLabel}`,
    order.comment ? `Комментарий: ${order.comment}` : "",
    "",
    "Состав заказа:",
    ...order.items.map(
      (item) => `• ${item.name} — ${item.qty} ${item.unit} × ${item.price} = ${item.lineTotal}`
    ),
    ...(order.pricesIncludeVat === false && order.subtotalWithoutVatText
      ? ["", `Стоимость без НДС: ${order.subtotalWithoutVatText}`]
      : []),
    ...(Array.isArray(order.taxLines) ? order.taxLines : [])
      .filter((line) => line && line.treatment !== "NOT_APPLICABLE" && line.vatText)
      .map((line) => `${order.pricesIncludeVat ? `в том числе ${line.caption}` : line.caption}: ${line.vatText}`),
    "",
    `Итого: ${order.total}`,
  ].filter((line) => line !== "");

  return lines.join("\n");
}

export function buildMessengerUrl(order, contacts) {
  const text = buildOrderMessage(order);
  const source = contacts || {};
  if (order.channel === "telegram") {
    const user = String(source.telegram || "").replace(/^@/, "").trim();
    if (!user) return "";
    return `https://t.me/${user}`;
  }
  const number = String(source.whatsapp || "").replace(/\D/g, "");
  if (!number) return "";
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function openMessenger(order, contacts) {
  const url = buildMessengerUrl(order, contacts);
  if (!url) return "";
  if (order.channel === "telegram") {
    const text = buildOrderMessage(order);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch {
      /* ignore */
    }
  }
  window.open(url, "_blank", "noopener");
  return url;
}
