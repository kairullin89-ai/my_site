import { parseAttachments } from "./files.js";
import { looksLikeHandoff, wantsHuman } from "./handoff.js";
import { runLocal, runTool, toolDefs } from "./kernel.js";
import { chatComplete } from "./llm.js";
import { loadSystemPrompt } from "./prompt.js";
import { normalize } from "./text.js";
import "./skills/index.js";

const HISTORY_LIMIT = 12;
const CONTENT_LIMIT = 1200;
const TEXT_FILE_LIMIT = 12000;
const MODEL_TIMEOUT_MS = 30000;

function asksCatalog(text) {
  return /цен|стоим|сколько|поч[её]м|прайс|каталог|ассортимент|какие\s*(?:товар|жби|издели)|номенклатур|что\s*есть/.test(
    normalize(text)
  );
}

function rememberAmount(set, raw) {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits || digits.length > 9) return;
  if (/^(?:19|20)\d{2}$/.test(digits)) return;
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return;
  set.add(value);
}

function moneyAmounts(text) {
  const found = new Set();
  const source = String(text || "").replace(/[\u00a0\u202f]/g, " ");
  const currency =
    /(?:[$₽₸]\s*)(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)|(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)(?:\s*(?:[$₽₸]|тенге|тг\b|руб\p{L}*|usd|kzt|долл\p{L}*))/giu;
  const thousands = /(\d+(?:[.,]\d+)?)\s*тыс/giu;
  let match;
  while ((match = currency.exec(source))) rememberAmount(found, match[1] || match[2]);
  while ((match = thousands.exec(source))) {
    const value = Number(String(match[1]).replace(",", "."));
    if (Number.isFinite(value) && value > 0) found.add(Math.round(value * 1000));
  }
  const grouped = /\d{1,3}(?: \d{3})+/g;
  while ((match = grouped.exec(source))) rememberAmount(found, match[0]);
  const plain = /(?<![\d])(\d{4,9})(?![\d])/g;
  while ((match = plain.exec(source))) rememberAmount(found, match[1]);
  return found;
}

function pricesAgree(reply, notes) {
  const allowed = moneyAmounts(notes.join("\n"));
  for (const value of moneyAmounts(reply)) {
    if (!allowed.has(value)) return false;
  }
  return true;
}

function clip(value, max) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return text.slice(0, max);
}

export function acceptHistory(history) {
  const accepted = [];
  for (const item of asArray(history).slice(-HISTORY_LIMIT)) {
    const role = String(item?.role || "");
    const content = textOf(item?.content);
    if ((role !== "user" && role !== "assistant") || !content) continue;
    accepted.push({ role, content: clip(content, CONTENT_LIMIT) });
  }
  return accepted;
}

export function textOf(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function fileDigest(files) {
  const parts = [];
  for (const file of asArray(files)) {
    if (file.kind === "image") parts.push(`[Изображение: ${file.name}]`);
    else if (file.text) parts.push(`[Файл ${file.name}] ${clip(file.text, 700)}`);
    else parts.push(`[Файл ${file.name}] текст не извлечён`);
  }
  return parts.join("\n").slice(0, 900);
}

function withFile(result, files) {
  const digest = fileDigest(files);
  return digest ? { ...result, fileDigest: digest } : result;
}

function localResult(ctx, fallback) {
  const local = runLocal(ctx);
  const excerpts = asArray(ctx.files)
    .map((file) => {
      if (file.text) return `«${file.name}»:\n${clip(file.text, 800)}`;
      if (file.kind === "image") return `Изображение «${file.name}» получено. Локальный режим его не разбирает.`;
      return "";
    })
    .filter(Boolean);
  const reply = excerpts.length ? `${local.text}\n\nИз вложения:\n${excerpts.join("\n\n")}` : local.text;
  return withFile(
    {
      reply,
      handoff: Boolean(local.handoff || wantsHuman(ctx.raw)),
      topic: local.topic || ctx.raw || "",
      fallback,
    },
    ctx.files
  );
}

function buildUserMessage(message, attachments) {
  const textChunks = [];
  if (message) textChunks.push(message);
  const imageUrls = [];

  for (const file of asArray(attachments)) {
    if (!file) continue;
    const name = file.name ? String(file.name) : "file";
    if (file.kind === "image") {
      const url = String(file.dataUrl || "");
      if (url.startsWith("data:image/")) {
        imageUrls.push(url);
        textChunks.push(`[Изображение: ${name}]\nПосмотри изображение и ответь по нему. Не описывай то, чего на нём нет.`);
      }
      continue;
    }
    const body = clip(file.text, TEXT_FILE_LIMIT);
    if (body) {
      textChunks.push(
        `--- Файл: ${name} ---\nТекст уже извлечён. Опирайся на него и не проси прислать файл ещё раз.\n${body}\n--- конец файла ---`
      );
      continue;
    }
    textChunks.push(`--- Файл: ${name} ---\n${clip(file.note || "Текст из файла извлечь не удалось.", 1000)}`);
  }

  if (!textChunks.length && !imageUrls.length) return null;

  if (imageUrls.length) {
    const joined = textChunks.join("\n\n") || "Посмотри вложение и ответь по делу.";
    return {
      role: "user",
      content: [
        { type: "text", text: joined },
        ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    };
  }

  return { role: "user", content: textChunks.join("\n\n") };
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return {};
  }
}

export async function handleChat({
  message = "",
  history = [],
  attachments = [],
  products = [],
  currency = "kzt",
  contacts = {},
  pricesIncludeVat = false,
  apiKey = "",
  model = "gpt-5.4-mini",
  root,
}) {
  const userText = clip(String(message || "").trim(), 4000);
  const files = parseAttachments(attachments);
  const raw = userText || files.map((file) => file.name).filter(Boolean).join(", ");
  const ctx = {
    raw,
    products: Array.isArray(products) ? products : [],
    currency: currency || "kzt",
    contacts,
    pricesIncludeVat: pricesIncludeVat === true,
    attachments: files,
    files,
  };

  if (!String(apiKey || "").trim()) return localResult(ctx, "no_key");

  const userMessage = buildUserMessage(userText, files);
  if (!userMessage) return localResult(ctx, "openai");

  const messages = [{ role: "system", content: loadSystemPrompt(root, contacts) }, ...acceptHistory(history), userMessage];

  const tools = toolDefs();
  const maxTokens = files.length ? 900 : 500;
  let handoff = wantsHuman(userText);
  let topic = userText;
  let usedCatalog = false;
  const catalogNotes = [];

  try {
    for (let round = 0; round < 3; round += 1) {
      const replyMessage = await chatComplete({
        apiKey: String(apiKey).trim(),
        model: model || "gpt-5.4-mini",
        messages,
        tools,
        maxTokens,
        timeoutMs: MODEL_TIMEOUT_MS,
      });
      if (!replyMessage) throw new Error("Empty model reply");

      const calls = asArray(replyMessage.tool_calls);
      if (!calls.length) {
        let reply = textOf(replyMessage.content);
        if (!reply) throw new Error("Empty model reply");
        const hasAttachment = asArray(files).some((file) => file && (file.kind === "image" || file.text));
        if (catalogNotes.length && !pricesAgree(reply, catalogNotes)) reply = catalogNotes.join("\n\n");
        if (!hasAttachment && !usedCatalog && asksCatalog(userText)) {
          const local = runLocal(ctx);
          if (local && local.source === "catalog" && local.text) {
            return withFile(
              {
                reply: local.text,
                handoff: Boolean(local.handoff || wantsHuman(userText)),
                topic: local.topic || topic || userText,
              },
              files
            );
          }
        }
        return withFile(
          {
            reply,
            handoff: Boolean(handoff || looksLikeHandoff(reply)),
            topic: topic || userText,
          },
          files
        );
      }

      messages.push({
        role: "assistant",
        content: replyMessage.content ?? null,
        tool_calls: calls,
      });

      for (const call of calls) {
        const name = call?.function?.name || call?.name || "";
        const args = parseArgs(call?.function?.arguments ?? call?.arguments);
        const result = await runTool(name, args, ctx);
        if (result.source === "catalog" && result.text) {
          usedCatalog = true;
          catalogNotes.push(result.text);
        }
        if (result.handoff) handoff = true;
        if (result.topic) topic = result.topic;
        messages.push({
          role: "tool",
          tool_call_id: call.id || `call_${round}_${name}`,
          content: clip(result.text || "", 8000),
        });
      }
    }
  } catch (err) {
    if (err && Number(err.status) === 429) throw err;
    const message = err && err.message ? err.message : "unknown";
    console.error(`barys chat: ${String(message).slice(0, 300)}`);
    return localResult(ctx, "openai");
  }

  return localResult(ctx, "openai");
}
