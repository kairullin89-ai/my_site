import { useEffect, useRef, useState } from "react";
import {
  BARYS_GREETING,
  buildHandoffUrl,
  buildTelegramUrl,
  looksLikeHandoff,
  runLocal,
  wantsHuman,
} from "../lib/barysReply.js";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const WIDTH_KEY = "barys-panel-width";
const HEIGHT_KEY = "barys-panel-height";
const WIDTH_MIN = 300;
const WIDTH_MAX = 720;
const HEIGHT_MIN = 320;
const HEIGHT_MAX = 900;

let messageSeq = 0;
function nextId() {
  messageSeq += 1;
  return `m${messageSeq}`;
}

function RichText({ text, email }) {
  const lines = String(text || "").split("\n");
  return lines.map((line, index) => (
    <span key={index}>
      {index > 0 ? <br /> : null}
      <LineParts text={line} email={email} />
    </span>
  ));
}

function linkParts(raw) {
  const trimmed = String(raw || "").replace(/[),.;:!?]+$/, "");
  return { href: trimmed, tail: String(raw || "").slice(trimmed.length) };
}

function allowedHttpHref(raw) {
  const { href, tail } = linkParts(raw);
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    const allowed = url.protocol === "https:" && (host === "wa.me" || host === "t.me" || host === "telegram.me");
    return allowed ? { href: url.href, tail } : null;
  } catch {
    return null;
  }
}

function LineParts({ text, email }) {
  const re = /(https?:\/\/[^\s<]+)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const nodes = [];
  let last = 0;
  let match = re.exec(text);
  let key = 0;
  while (match) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1]) {
      const safe = allowedHttpHref(match[1]);
      if (safe) {
        nodes.push(
          <a key={key} href={safe.href} target="_blank" rel="noopener noreferrer">
            {safe.href}
          </a>
        );
        if (safe.tail) nodes.push(safe.tail);
      } else {
        nodes.push(match[1]);
      }
    } else if (email && match[2].toLowerCase() === String(email).toLowerCase()) {
      nodes.push(
        <a key={key} href={`mailto:${match[2]}`}>
          {match[2]}
        </a>
      );
    } else {
      nodes.push(match[2]);
    }
    key += 1;
    last = match.index + match[0].length;
    match = re.exec(text);
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function extOf(name) {
  const i = String(name || "").lastIndexOf(".");
  return i >= 0 ? String(name).slice(i + 1).toLowerCase() : "";
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function resizeImageFile(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        const scale = Math.min(1, maxSide / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mime, quality);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось открыть изображение"));
    };
    img.src = url;
  });
}

async function prepareAttachment(file) {
  if (!file) return null;
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Файл больше 4 МБ. Сожмите или выберите другой.");
  }
  const name = file.name || "file";
  const mime = file.type || "application/octet-stream";
  const ext = extOf(name);
  const isImage = mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext);
  if (["heic", "heif"].includes(ext) || mime === "image/heic" || mime === "image/heif") {
    throw new Error("Фото HEIC с телефона не открывается. Сохраните его как JPG или PNG.");
  }

  if (isImage) {
    const dataUrl = await resizeImageFile(file);
    return {
      kind: "image",
      name,
      mime: mime.startsWith("image/") ? mime : "image/jpeg",
      size: file.size,
      dataUrl,
      previewUrl: dataUrl,
      api: { name, mime: dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg", dataUrl },
    };
  }

  const dataUrl = await readAsDataUrl(file);
  return {
    kind: "file",
    name,
    mime,
    size: file.size,
    previewUrl: "",
    api: { name, mime: mime || "application/octet-stream", dataUrl },
  };
}

const FOLLOW_IMAGE = /фото|картин|изображ|черт[её]ж|снимок|на\s*фото|что\s*на|размер\s*на/i;
const CHAT_TIMEOUT_MS = 120000;

export default function BarysChat({ products, currency, contacts, pricesIncludeVat = false }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const openedOnce = useRef(false);
  const historyRef = useRef([]);
  const productsRef = useRef(products);
  const currencyRef = useRef(currency);
  const contactsRef = useRef(contacts);
  const pricesIncludeVatRef = useRef(pricesIncludeVat);
  const lastImageRef = useRef(null);
  const busyRef = useRef(false);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const fileRef = useRef(null);
  const plusRef = useRef(null);
  const plusOpenRef = useRef(false);
  const handleXRef = useRef(null);
  const handleYRef = useRef(null);
  const closeTimer = useRef(0);

  plusOpenRef.current = plusOpen;

  productsRef.current = products;
  currencyRef.current = currency;
  contactsRef.current = contacts;
  pricesIncludeVatRef.current = pricesIncludeVat === true;

  useEffect(() => {
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (document.body.classList.contains("order-modal-open")) return;
      if (document.body.classList.contains("cart-open")) return;
      if (plusOpenRef.current) {
        setPlusOpen(false);
        return;
      }
      closeChat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  useEffect(() => {
    const root = rootRef.current;
    const box = messagesRef.current;
    const input = inputRef.current;
    if (!root || !box) return undefined;

    const onWheel = (e) => {
      const panel = panelRef.current;
      if (!panel || !panel.classList.contains("is-open") || !panel.contains(e.target)) return;
      e.preventDefault();
      if (box.contains(e.target) || e.target === box) {
        box.scrollTop += e.deltaY;
      }
    };
    const onTouch = (e) => {
      const panel = panelRef.current;
      if (!panel || !panel.classList.contains("is-open")) return;
      if (e.target === input || input?.contains(e.target)) return;
      if (box.contains(e.target) || e.target === box) return;
      if (!panel.contains(e.target)) return;
      e.preventDefault();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("touchmove", onTouch, { passive: false });
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchmove", onTouch);
    };
  }, [open]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !mounted) return undefined;

    const clampWidth = (px) => {
      const maxByViewport = Math.max(WIDTH_MIN, window.innerWidth - 48);
      return Math.round(Math.min(WIDTH_MAX, maxByViewport, Math.max(WIDTH_MIN, px)));
    };
    const clampHeight = (px) => {
      const maxByViewport = Math.max(HEIGHT_MIN, window.innerHeight - 80);
      return Math.round(Math.min(HEIGHT_MAX, maxByViewport, Math.max(HEIGHT_MIN, px)));
    };

    try {
      const savedW = Number(localStorage.getItem(WIDTH_KEY));
      const savedH = Number(localStorage.getItem(HEIGHT_KEY));
      if (savedW && savedW >= WIDTH_MIN) panel.style.setProperty("--barys-w", `${clampWidth(savedW)}px`);
      if (savedH && savedH >= HEIGHT_MIN) panel.style.setProperty("--barys-h", `${clampHeight(savedH)}px`);
    } catch {
      /* ignore */
    }

    const cleanups = [];
    const bind = (handle, axis) => {
      if (!handle) return;
      let dragging = false;
      let startPos = 0;
      let startSize = 0;

      const onMove = (event) => {
        if (!dragging) return;
        if (axis === "x") {
          const w = clampWidth(startSize + (startPos - event.clientX));
          panel.style.setProperty("--barys-w", `${w}px`);
        } else {
          const h = clampHeight(startSize + (startPos - event.clientY));
          panel.style.setProperty("--barys-h", `${h}px`);
        }
      };
      const stop = () => {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove("is-resizing", "is-resizing-x", "is-resizing-y");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          if (axis === "x") {
            const px = Number.parseFloat(getComputedStyle(panel).getPropertyValue("--barys-w"));
            if (px) localStorage.setItem(WIDTH_KEY, String(clampWidth(px)));
          } else {
            const px = Number.parseFloat(getComputedStyle(panel).getPropertyValue("--barys-h"));
            if (px) localStorage.setItem(HEIGHT_KEY, String(clampHeight(px)));
          }
        } catch {
          /* ignore */
        }
      };
      const onDown = (event) => {
        if (event.button != null && event.button !== 0) return;
        event.preventDefault();
        dragging = true;
        const rect = panel.getBoundingClientRect();
        if (axis === "x") {
          startPos = event.clientX;
          startSize = rect.width;
          panel.classList.add("is-resizing", "is-resizing-x");
          document.body.style.cursor = "ew-resize";
        } else {
          startPos = event.clientY;
          startSize = rect.height;
          panel.classList.add("is-resizing", "is-resizing-y");
          document.body.style.cursor = "ns-resize";
        }
        document.body.style.userSelect = "none";
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
      };

      handle.addEventListener("pointerdown", onDown);
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
      window.addEventListener("blur", stop);
      cleanups.push(() => {
        handle.removeEventListener("pointerdown", onDown);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        window.removeEventListener("blur", stop);
      });
    };

    bind(handleXRef.current, "x");
    bind(handleYRef.current, "y");
    return () => {
      cleanups.forEach((fn) => fn());
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [mounted]);

  function openChat() {
    clearTimeout(closeTimer.current);
    setMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setOpen(true);
        if (!openedOnce.current) {
          openedOnce.current = true;
          setMessages([{ id: nextId(), kind: "bubble", who: "bot", text: BARYS_GREETING }]);
        }
        inputRef.current?.focus();
      });
    });
  }

  function closeChat() {
    setPlusOpen(false);
    setOpen(false);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMounted(false), 400);
  }

  useEffect(() => {
    if (!plusOpen) return undefined;
    const onPointer = (event) => {
      if (plusRef.current?.contains(event.target)) return;
      setPlusOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [plusOpen]);

  function pushMessage(message) {
    setMessages((list) => [...list, { id: nextId(), ...message }]);
  }

  function resizeInput(el) {
    const node = el || inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 120)}px`;
  }

  async function onFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      setPending(await prepareAttachment(file));
    } catch (err) {
      setPending(null);
      pushMessage({
        kind: "bubble",
        who: "bot",
        text: err && err.message ? String(err.message) : "Не удалось прикрепить файл.",
      });
    }
    setPlusOpen(false);
    inputRef.current?.focus();
  }

  function openPicker(accept) {
    setPlusOpen(false);
    const input = fileRef.current;
    if (!input) return;
    input.accept = accept;
    input.value = "";
    input.click();
  }

  async function sendMessage() {
    if (busyRef.current) return;
    const value = draft.trim();
    const attachment = pending;
    if (!value && !attachment) return;
    busyRef.current = true;
    setBusy(true);

    const meta = attachment ? { name: attachment.name, previewUrl: attachment.previewUrl || "" } : null;
    pushMessage({
      kind: "bubble",
      who: "user",
      text: value || (attachment ? "Вложение" : ""),
      meta,
    });
    setDraft("");
    setPending(null);
    if (fileRef.current) fileRef.current.value = "";
    resizeInput();

    const followImage = !attachment && lastImageRef.current && FOLLOW_IMAGE.test(value);
    const apiAttachments = attachment ? [attachment.api] : followImage ? [lastImageRef.current] : [];
    if (attachment?.kind === "image") lastImageRef.current = attachment.api;
    else if (attachment) lastImageRef.current = null;
    if (followImage) lastImageRef.current = null;
    const historyLabel = attachment ? `${value ? `${value}\n` : ""}[вложение: ${attachment.name}]` : value;
    const topic = value || (attachment && attachment.name) || "";
    const rememberedUser = (digest) => {
      const text = digest ? `${historyLabel}\n${digest}` : historyLabel;
      return text.length > 1200 ? text.slice(0, 1200) : text;
    };

    const finishLocal = (prefix, local, handoff, digest = "") => {
      historyRef.current.push({ role: "user", content: rememberedUser(digest) });
      historyRef.current.push({ role: "assistant", content: local });
      pushMessage({ kind: "bubble", who: "bot", text: prefix ? `${prefix}\n\n${local}` : local });
      if (handoff) pushMessage({ kind: "handoff", topic });
    };

    try {
      const res = await fetch("/api/barys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: value,
          attachments: apiAttachments,
          history: historyRef.current.slice(-8),
          currency: currencyRef.current,
        }),
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(CHAT_TIMEOUT_MS) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        pushMessage({
          kind: "bubble",
          who: "bot",
          text: data.error || "Превышен лимит запросов к ИИ-ассистенту. Пожалуйста, подождите",
        });
        return;
      }
      if (!res.ok) throw new Error(data.error || `Ошибка API (${res.status})`);
      if (!data.reply) throw new Error("Пустой ответ");
      const reply = String(data.reply);
      const handoff = Boolean(data.handoff) || wantsHuman(value) || looksLikeHandoff(reply);
      if (data.fallback === "no_key") {
        finishLocal(
          "AI временно без ключа OpenAI — отвечаю по каталогу локально.",
          reply,
          Boolean(data.handoff) || wantsHuman(value) || /контакт|связ|whatsapp|telegram/i.test(value || ""),
          data.fileDigest || ""
        );
        return;
      }
      if (data.fallback) {
        finishLocal("AI сейчас недоступен. Отвечаю по каталогу:", reply, handoff, data.fileDigest || "");
        return;
      }
      historyRef.current.push({ role: "user", content: rememberedUser(data.fileDigest || "") });
      historyRef.current.push({ role: "assistant", content: reply });
      pushMessage({ kind: "bubble", who: "bot", text: reply });
      if (handoff) pushMessage({ kind: "handoff", topic: data.topic || topic });
    } catch (err) {
      const msg = err && err.message ? String(err.message) : "";
      if (/Превышен лимит запросов|Слишком много запросов/i.test(msg)) {
        console.warn("Барыс API:", msg);
        pushMessage({ kind: "bubble", who: "bot", text: msg });
        return;
      }
      const localResult = runLocal({
        raw: value || (attachment ? attachment.name : ""),
        products: productsRef.current,
        currency: currencyRef.current,
        contacts: contactsRef.current,
        pricesIncludeVat: pricesIncludeVatRef.current,
      });
      const local = localResult?.text || "";
      const askedHuman = Boolean(localResult?.handoff) || wantsHuman(value);
      const isKey = /OPENAI_API_KEY|пуст|empty/i.test(msg);
      const isNetwork =
        /Failed to fetch|NetworkError|Load failed|fetch|aborted|timeout/i.test(msg) ||
        err instanceof TypeError ||
        err?.name === "AbortError" ||
        err?.name === "TimeoutError";
      if (isKey) {
        finishLocal(
          "AI временно без ключа OpenAI — отвечаю по каталогу локально.",
          local,
          askedHuman || /контакт|связ|whatsapp|telegram/i.test(value || "")
        );
      } else if (isNetwork) {
        console.warn("Барыс API:", msg || err);
        finishLocal(
          "Сервер Барыс недоступен — локальный ответ по каталогу. Для полного AI запустите server.ps1.",
          local,
          askedHuman
        );
      } else {
        console.warn("Барыс API:", msg || err);
        const shown = /слишком много|подождите/i.test(msg) ? `${msg} ` : "";
        finishLocal(`${shown}AI сейчас недоступен. Отвечаю по каталогу:`, local, askedHuman || looksLikeHandoff(local));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const sizeKb = pending ? Math.max(1, Math.round(pending.size / 1024)) : 0;
  const pendingLabel =
    pending?.kind === "image" ? "изображение" : pending?.kind === "text" ? "текст" : "файл";
  const mail = contacts && contacts.email ? contacts.email : "";

  return (
    <div className="barys" id="barysChat" ref={rootRef}>
      <div
        className={`barys__panel${open ? " is-open" : ""}`}
        id="barysPanel"
        ref={panelRef}
        role="dialog"
        aria-labelledby="barysTitle"
        aria-hidden={!open}
        hidden={!mounted}
      >
        <button
          type="button"
          className="barys__resize barys__resize--x"
          ref={handleXRef}
          aria-label="Изменить ширину чата"
          title="Потяните, чтобы изменить ширину"
        ></button>
        <button
          type="button"
          className="barys__resize barys__resize--y"
          ref={handleYRef}
          aria-label="Изменить высоту чата"
          title="Потяните, чтобы изменить высоту"
        ></button>
        <header className="barys__head">
          <div className="barys__identity">
            <span className="barys__avatar" aria-hidden="true"></span>
            <div>
              <h2 id="barysTitle">Барыс</h2>
              <p className="barys__status">
                <span className="dot"></span> AI-консультант
              </p>
            </div>
          </div>
          <button type="button" className="barys__close" aria-label="Закрыть чат" onClick={closeChat}>
            ✕
          </button>
        </header>
        <div className="barys__messages" ref={messagesRef} role="log" aria-live="polite">
          {messages.map((message) =>
            message.kind === "handoff" ? (
              <HandoffCard key={message.id} topic={message.topic} contacts={contacts} mail={mail} />
            ) : (
              <div key={message.id} className={`barys__bubble barys__bubble--${message.who}`}>
                {message.meta?.previewUrl ? (
                  <img className="barys__bubble-media" src={message.meta.previewUrl} alt={message.meta.name || "изображение"} />
                ) : message.meta?.name ? (
                  <span className="barys__bubble-file">📎 {message.meta.name}</span>
                ) : null}
                {message.text ? (
                  <p>
                    <RichText text={message.text} email={mail} />
                  </p>
                ) : (
                  <p></p>
                )}
              </div>
            )
          )}
          {busy ? (
            <div className="barys__typing" aria-hidden="true">
              <i></i>
              <i></i>
              <i></i>
            </div>
          ) : null}
        </div>
        <div className="barys__composer">
          {pending ? (
            <div className="barys__pending">
              {pending.previewUrl ? (
                <img className="barys__pending-thumb" src={pending.previewUrl} alt="" />
              ) : (
                <span className="barys__pending-thumb" aria-hidden="true" style={{ display: "grid", placeItems: "center", fontSize: "1.1rem" }}>
                  📎
                </span>
              )}
              <div className="barys__pending-meta">
                <strong>{pending.name}</strong>
                <span>
                  {pendingLabel} · {sizeKb} КБ
                </span>
              </div>
              <button type="button" className="barys__pending-remove" aria-label="Убрать файл" onClick={() => setPending(null)}>
                ×
              </button>
            </div>
          ) : null}
          <form
            className="barys__form"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
          >
            <input
              ref={fileRef}
              type="file"
              className="visually-hidden"
              onChange={onFile}
            />
            <label className="visually-hidden" htmlFor="barysInput">
              Сообщение
            </label>
            <div className="barys__field">
              <div className="barys__plus" ref={plusRef}>
                {plusOpen ? (
                  <div className="barys__plus-menu" id="barysPlusMenu" role="menu" aria-label="Вложения">
                    <button type="button" role="menuitem" onClick={() => openPicker("image/*")}>
                      <span>Отправить изображение</span>
                      <small>Фото, до 4 МБ</small>
                    </button>
                    <button type="button" role="menuitem" onClick={() => openPicker("")}>
                      <span>Отправить файл</span>
                      <small>Любой тип, до 4 МБ</small>
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="barys__attach"
                  aria-label="Вложения"
                  aria-haspopup="menu"
                  aria-expanded={plusOpen}
                  aria-controls="barysPlusMenu"
                  title="Вложения"
                  onClick={() => setPlusOpen((value) => !value)}
                >
                  +
                </button>
              </div>
              <textarea
                id="barysInput"
                ref={inputRef}
                name="message"
                rows={1}
                autoComplete="off"
                placeholder="Спросите про ЖБИ, цены, заказ…"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  resizeInput(e.target);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
            </div>
            <button type="submit" className="barys__send" aria-label="Отправить">
              →
            </button>
          </form>
        </div>
      </div>
      <button
        type="button"
        className="barys__fab"
        aria-expanded={open}
        aria-controls="barysPanel"
        onClick={() => (open ? closeChat() : openChat())}
      >
        <span className="barys__fab-label">Барыс</span>
        <span className="barys__fab-hint">AI</span>
      </button>
    </div>
  );
}

function HandoffCard({ topic, contacts, mail }) {
  const tgUrl = buildTelegramUrl(topic, contacts);
  return (
    <div className="barys__handoff">
      <p className="barys__handoff-text">Готов передать запрос Барысу — директору по производству.</p>
      {buildHandoffUrl(topic, contacts) ? (
        <a className="barys__handoff-btn" href={buildHandoffUrl(topic, contacts)} target="_blank" rel="noopener">
          Написать в WhatsApp
        </a>
      ) : null}
      {tgUrl ? (
        <a className="barys__handoff-btn barys__handoff-btn--tg" href={tgUrl} target="_blank" rel="noopener">
          Написать в Telegram
        </a>
      ) : null}
      {mail ? (
        <a className="barys__handoff-mail" href={`mailto:${mail}?subject=${encodeURIComponent("Запрос с сайта Барыс")}`}>
          Или на почту
        </a>
      ) : null}
    </div>
  );
}
