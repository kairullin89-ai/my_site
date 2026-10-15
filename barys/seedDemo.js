import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, openDatabase } from "./db.js";
import { seedDemoOrganization } from "./organization.js";

if (process.env.NODE_ENV === "production") {
  console.error("seed:demo заблокирован при NODE_ENV=production");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const opened = openDatabase(root);
try {
  const seeded = seedDemoOrganization(opened.db);
  if (seeded) console.log("Демо-организация создана");
  else console.log("Организация уже есть, запись не изменена");
} finally {
  closeDatabase(opened.db);
}
