import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closeDatabase, createOrder, getOrder, openDatabase } from "../barys/db.js";
import { handleChat } from "../barys/handle.js";
import { readOrganization } from "../barys/organization.js";
import { handleInvoicePdfRequest } from "../barys/pdf/invoiceTemplate.js";

const green = (msg) => `\x1b[32m${msg}\x1b[0m`;
const red = (msg) => `\x1b[31m${msg}\x1b[0m`;
const blue = (msg) => `\x1b[34m${msg}\x1b[0m`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const port = 3999;
const adminPassword = "secure_password";
const limitMessage = "Превышен лимит запросов к ИИ-ассистенту. Пожалуйста, подождите";
let failed = 0;

function mark(ok, success, failure) {
  if (ok) console.log(green(`  ✓ ${success}`));
  else {
    failed += 1;
    console.log(red(`  ✗ ${failure}`));
  }
}

function request(method, urlPath, { headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = {};
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode, json, raw });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function checkStartup() {
  console.log("[1/3] Проверка валидации .env при старте...");
  const startup = spawnSync(
    node,
    ["--import", pathToFileURL(path.join(root, "scripts", "blank-dotenv-hook.mjs")).href, path.join(root, "barys", "worker.js")],
    {
      cwd: root,
      env: { PATH: process.env.PATH || "", SMOKE_BLANK_ENV: "1" },
      encoding: "utf-8",
      timeout: 15000,
    }
  );
  const exitCode = startup.status;
  const output = `${startup.stderr || ""}\n${startup.stdout || ""}`;
  const blocked = exitCode === 1 && output.includes("SUPPORT_EMAIL") && output.includes("Не заданы переменные окружения");
  mark(
    blocked,
    `Приложение заблокировало старт с кодом выхода ${exitCode} и перечислило SUPPORT_EMAIL.`,
    `Приложение не упало или не сообщило о недостающих переменных (код: ${exitCode}, signal: ${startup.signal || "none"}).`
  );
  if (!blocked && output.trim()) {
    console.log(red(output.trim().slice(0, 800)));
  }
}

async function runTests() {
  console.log(blue("\n=== ЗАПУСК SMOKE-ТЕСТОВ БЕЗОПАСНОСТИ И ФОЛБЕКОВ ===\n"));
  checkStartup();

  console.log("\n[2/3] Счёт без организации (422)...");
  console.log("[3/3] Лимит OpenAI (429)...");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "izim-smoke-"));
  const opened = openDatabase(tempRoot);
  const created = createOrder(opened.db, {
    id: "smoke-order-1",
    name: "Smoke",
    phone: "+77777777777",
    items: [{ id: "p1", qty: 1 }],
  });
  const orderId = created.order.id;
  const organization = readOrganization(opened.db);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.openai.com")) {
      return {
        status: 429,
        ok: false,
        text: async () => '{"error":{"message":"rate limit"}}',
      };
    }
    return originalFetch(url);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === "/api/documents/invoice") {
        const result = await handleInvoicePdfRequest({
          method: req.method,
          searchParams: url.searchParams,
          adminHeader: req.headers["x-admin-password"],
          env: { ADMIN_PASSWORD: adminPassword },
          getOrderById: (id) => getOrder(opened.db, id),
          getOrganization: () => readOrganization(opened.db),
          root,
        });
        const status = result.pdf ? 200 : result.status;
        const payload = result.pdf ? { error: "unexpected pdf" } : result.json;
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/barys") {
        const result = await handleChat({
          message: "сколько стоит плита",
          products: [],
          contacts: { whatsapp: "77777777777", telegram: "test_tg", email: "test@example.com" },
          apiKey: "sk-test-key",
          model: "gpt-4o",
          root,
        });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (err) {
      const status = err && Number.isInteger(err.status) ? err.status : 500;
      const message = status === 429
        ? (err && err.message ? err.message : limitMessage)
        : status >= 500
          ? "Internal Server Error"
          : err && err.message
            ? err.message
            : "error";
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: message }));
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  try {
    if (organization) {
      mark(false, "", "Временная база уже содержит организацию, проверка 422 нечистая.");
    }

    const invoice = await request(
      "GET",
      `/api/documents/invoice?id=${encodeURIComponent(orderId)}`,
      { headers: { "X-Admin-Password": adminPassword } }
    );
    mark(
      invoice.status === 422 && invoice.json.error === "Организация не настроена",
      "Эндпоинт счёта вернул 422 и текст «Организация не настроена».",
      `Ожидался 422 «Организация не настроена», получен ${invoice.status}: ${invoice.raw}`
    );

    const chatBody = JSON.stringify({ message: "сколько стоит плита" });
    const chat = await request("POST", "/api/barys", {
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(chatBody) },
      body: chatBody,
    });
    const catalogFallback = Boolean(chat.json && chat.json.fallback);
    mark(
      chat.status === 429 && chat.json.error === limitMessage && !catalogFallback,
      "Чат вернул 429 и текст лимита, без ответа по каталогу.",
      `Ожидался 429 без fallback, получен ${chat.status}: ${chat.raw}`
    );
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    closeDatabase(opened.db);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(blue("\n=== ТЕСТИРОВАНИЕ ЗАВЕРШЕНО ===\n"));
  if (failed) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error(red(err && err.stack ? err.stack : String(err)));
  process.exit(1);
});
