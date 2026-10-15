export function mediaSrc(src) {
  const value = String(src || "").trim();
  if (!value) return "/assets/products/plant.jpg";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return value;
  return `/${value.replace(/^\/+/, "")}`;
}
