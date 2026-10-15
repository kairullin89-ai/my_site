import zlib from "node:zlib";

const MAX_BYTES = 4 * 1024 * 1024;
const TEXT_LIMIT = 12000;
const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 30;
const MAX_PDF_STREAMS = 40;

const TEXT_EXT = new Set([
  "txt", "md", "csv", "tsv", "json", "xml", "html", "htm", "css", "js", "ts", "tsx", "jsx",
  "log", "rtf", "svg", "yml", "yaml", "ini", "conf", "sql", "py", "sh", "bat",
]);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

function clip(value, max = TEXT_LIMIT) {
  const text = String(value || "").replace(/\u0000/g, "");
  if (text.length <= max) return text.trim();
  return `${text.slice(0, max).trim()}\n...[обрезано]`;
}

function extOf(name) {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function decodeDataUrl(value) {
  try {
    const raw = String(value || "");
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(raw);
    if (!match) return null;
    const mime = match[1] || "";
    const payload = match[3] || "";
    const bytes = match[2]
      ? Buffer.from(payload.replace(/\s/g, ""), "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { mime, bytes };
  } catch {
    return null;
  }
}

function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 3));
  if (sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

function looksLikeText(bytes) {
  if (!bytes.length) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
  let binary = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) binary += 1;
  }
  return binary / sample.length < 0.08;
}

function xmlText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function unzip(buffer) {
  const files = new Map();
  let eocd = -1;
  const start = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return files;
  const count = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  const limit = Math.min(count, MAX_ZIP_ENTRIES);
  for (let n = 0; n < limit && ptr + 46 <= buffer.length && total < MAX_TOTAL_BYTES; n += 1) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(ptr + 10);
    let compSize = buffer.readUInt32LE(ptr + 20);
    let uncompSize = buffer.readUInt32LE(ptr + 24);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    let localOff = buffer.readUInt32LE(ptr + 42);
    const name = buffer.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    const extra = buffer.subarray(ptr + 46 + nameLen, ptr + 46 + nameLen + extraLen);
    const sized = zip64Sizes(extra, compSize, uncompSize, localOff);
    compSize = sized.comp;
    uncompSize = sized.uncomp;
    localOff = sized.off;
    ptr += 46 + nameLen + extraLen + commentLen;
    if (localOff + 30 > buffer.length) continue;
    const localNameLen = buffer.readUInt16LE(localOff + 26);
    const localExtraLen = buffer.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compSize;
    if (compSize < 1 || dataEnd > buffer.length) continue;
    const compressed = buffer.subarray(dataStart, dataEnd);
    const data = inflateZip(method, compressed, uncompSize);
    if (data && data.length && total < MAX_TOTAL_BYTES) {
      const room = MAX_TOTAL_BYTES - total;
      const slice = data.length > room ? data.subarray(0, room) : data;
      total += slice.length;
      files.set(name.replace(/\\/g, "/").replace(/^\/+/, ""), slice);
    }
  }
  return files;
}

function zip64Sizes(extra, compSize, uncompSize, localOff) {
  let comp = compSize;
  let uncomp = uncompSize;
  let off = localOff;
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    const body = extra.subarray(cursor + 4, cursor + 4 + size);
    cursor += 4 + size;
    if (id !== 1 || body.length < 8) continue;
    let pos = 0;
    if (uncomp === 0xffffffff) {
      uncomp = Number(body.readBigUInt64LE(pos));
      pos += 8;
    }
    if (comp === 0xffffffff && pos + 8 <= body.length) {
      comp = Number(body.readBigUInt64LE(pos));
      pos += 8;
    }
    if (off === 0xffffffff && pos + 8 <= body.length) off = Number(body.readBigUInt64LE(pos));
  }
  return { comp, uncomp, off };
}

function inflateZip(method, compressed, uncompSize) {
  if (uncompSize > MAX_ENTRY_BYTES) return null;
  try {
    if (method === 0) return compressed.length > MAX_ENTRY_BYTES ? null : compressed;
    if (method !== 8) return null;
    const options = { maxOutputLength: MAX_ENTRY_BYTES };
    try {
      return zlib.inflateRawSync(compressed, options);
    } catch {
      return zlib.inflateSync(compressed, options);
    }
  } catch {
    if (uncompSize > 0 && uncompSize < 8 && compressed.length <= uncompSize) return compressed;
    return null;
  }
}

function markupToText(source) {
  const prepared = String(source || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:[\w.-]+:)?(?:p|tr|h1|h2|h3|li|div)>/gi, "\n")
    .replace(/<br\b[^>]*\/?>/gi, "\n")
    .replace(/<(?:[\w.-]+:)?tab\b[^>]*\/?>/gi, "\t");
  return xmlText(prepared)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function officePackageText(bytes) {
  const zip = unzip(bytes);
  if (!zip.size) return "";
  const names = [...zip.keys()].filter((name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".rels") || lower.includes("[content_types]")) return false;
    if (lower.startsWith("word/theme/") || lower.startsWith("xl/theme/")) return false;
    return /\.(xml|htm|html|txt)$/i.test(lower);
  });
  const rank = (name) => {
    const lower = name.toLowerCase();
    if (lower === "word/document.xml") return 0;
    if (lower.includes("/header")) return 1;
    if (lower.includes("/footer")) return 2;
    if (/\.html?$/.test(lower)) return 3;
    if (/footnote|endnote|comment/.test(lower)) return 4;
    return 6;
  };
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const chunks = [];
  for (const name of names) {
    let source = "";
    try {
      source = zip.get(name).toString("utf8");
    } catch {
      source = "";
    }
    const text = markupToText(source);
    if (text) chunks.push({ name: name.toLowerCase(), text });
  }
  if (!chunks.length) return "";
  const body = chunks.find((item) => item.name === "word/document.xml");
  if (body && body.text.length > 40) {
    const extra = chunks.filter((item) => item !== body && item.name.startsWith("word/") && !item.name.endsWith(".html") && !item.name.endsWith(".htm"));
    return [body.text, ...extra.map((item) => item.text)].join("\n\n");
  }
  return chunks.map((item) => item.text).join("\n\n");
}

function oleStrings(bytes) {
  const parts = [];
  let run = "";
  const push = () => {
    const text = run.replace(/\s+/g, " ").trim();
    if (text.length >= 4 && /[A-Za-zА-Яа-яЁё]{3}/.test(text)) parts.push(text);
    run = "";
  };
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    const printable = code === 9 || code === 10 || code === 13 || (code >= 32 && code < 0xfffe && (code < 0xd800 || code > 0xdfff));
    if (printable) run += String.fromCharCode(code);
    else push();
  }
  push();
  return [...new Set(parts)].join("\n");
}

function sharedStrings(xml) {
  const source = xml.toString("utf8");
  const items = [...source.matchAll(/<si\b[\s\S]*?<\/si>/gi)];
  return items.map((item) =>
    [...item[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((bit) => xmlText(bit[1])).join("")
  );
}

function sheetText(xml, strings) {
  const source = xml.toString("utf8");
  const rows = new Map();
  for (const cell of source.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
    const ref = /r="([A-Z]+)(\d+)"/i.exec(cell[1]);
    if (!ref) continue;
    const row = Number(ref[2]);
    let col = 0;
    for (const ch of ref[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
    const type = /t="([^"]+)"/i.exec(cell[1]);
    const kind = type ? type[1] : "";
    let value = "";
    if (kind === "inlineStr") {
      value = [...cell[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((bit) => xmlText(bit[1])).join("");
    } else {
      const raw = /<v>([\s\S]*?)<\/v>/i.exec(cell[2]);
      value = raw ? xmlText(raw[1]) : "";
      if (kind === "s") value = strings[Number(value)] ?? "";
      if (kind === "b") value = value === "1" ? "true" : "false";
    }
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push({ col, value });
  }
  return [...rows.keys()]
    .sort((a, b) => a - b)
    .map((row) =>
      rows
        .get(row)
        .sort((a, b) => a.col - b.col)
        .map((cell) => cell.value)
        .join("\t")
    )
    .join("\n");
}

function xlsxText(bytes) {
  const zip = unzip(bytes);
  const strings = sharedStrings(zip.get("xl/sharedStrings.xml") || Buffer.from(""));
  const sheets = [...zip.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => Number(/sheet(\d+)/i.exec(a)?.[1] || 0) - Number(/sheet(\d+)/i.exec(b)?.[1] || 0));
  return sheets
    .map((name) => sheetText(zip.get(name), strings))
    .filter(Boolean)
    .join("\n\n");
}

function readPdfLiteral(source, start) {
  let text = "";
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1] || "";
      if (/[0-7]/.test(next)) {
        let oct = next;
        if (/[0-7]/.test(source[i + 2] || "")) oct += source[i + 2];
        if (/[0-7]/.test(source[i + 3] || "") && oct.length < 3) oct += source[i + 3];
        text += String.fromCharCode(parseInt(oct, 8));
        i += 1 + oct.length;
        continue;
      }
      const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      text += map[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === ")") return { text, next: i + 1 };
    text += ch;
    i += 1;
  }
  return { text, next: source.length };
}

function decodePdfHex(hex) {
  const clean = hex.replace(/\s/g, "");
  if (clean.length < 4 || clean.length % 2) return "";
  const bytes = Buffer.from(clean, "hex");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return text;
  }
  return bytes.toString("latin1");
}

function utf16be(hex) {
  const clean = String(hex || "").replace(/\s/g, "");
  if (!clean || clean.length % 2) return "";
  if (clean.length <= 2) return String.fromCharCode(parseInt(clean, 16));
  const bytes = Buffer.from(clean, "hex");
  let text = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return text;
}

function parseCMap(text) {
  const map = new Map();
  let width = 2;
  const noteWidth = (hex) => {
    const size = String(hex || "").replace(/\s/g, "").length;
    if (size > width) width = size;
  };
  for (const block of text.match(/beginbfchar[\s\S]*?endbfchar/g) || []) {
    for (const pair of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      noteWidth(pair[1]);
      map.set(parseInt(pair[1], 16), utf16be(pair[2]));
    }
  }
  for (const block of text.match(/beginbfrange[\s\S]*?endbfrange/g) || []) {
    for (const range of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const start = parseInt(range[1], 16);
      noteWidth(range[1]);
      [...range[3].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((item, index) => {
        map.set(start + index, utf16be(item[1]));
      });
    }
    for (const range of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const start = parseInt(range[1], 16);
      const end = parseInt(range[2], 16);
      noteWidth(range[1]);
      const first = utf16be(range[3]).codePointAt(0) || 0;
      const last = Math.min(end, start + 255);
      for (let code = start; code <= last; code += 1) map.set(code, String.fromCodePoint(first + (code - start)));
    }
  }
  return { map, width: width >= 4 ? 4 : 2 };
}

function mapGlyphs(hex, cmap) {
  if (!cmap?.map.size) return decodePdfHex(hex);
  const clean = String(hex || "").replace(/\s/g, "");
  const width = cmap.width;
  if (!clean || clean.length % width !== 0) return decodePdfHex(hex);
  let out = "";
  let hits = 0;
  for (let i = 0; i < clean.length; i += width) {
    const code = parseInt(clean.slice(i, i + width), 16);
    if (cmap.map.has(code)) {
      out += cmap.map.get(code);
      hits += 1;
    }
  }
  return hits ? out : decodePdfHex(hex);
}

function pdfLiterals(source, cmap) {
  const found = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] === "(") {
      const read = readPdfLiteral(source, i);
      if (read.text.trim()) found.push(read.text);
      i = read.next;
      continue;
    }
    if (source[i] === "<" && source[i + 1] !== "<") {
      const end = source.indexOf(">", i + 1);
      if (end > i) {
        const text = mapGlyphs(source.slice(i + 1, end), cmap);
        if (text.trim()) found.push(text);
        i = end + 1;
        continue;
      }
    }
    i += 1;
  }
  return found.join(" ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function pdfStreamAt(source, match) {
  const from = match.index + match[0].length;
  const head = source.slice(Math.max(0, match.index - 400), match.index);
  const lengthMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(head);
  if (lengthMatch) {
    const len = Number(lengthMatch[1]);
    return {
      data: Buffer.from(source.slice(from, from + len), "latin1"),
      head,
      next: from + len,
    };
  }
  const end = source.indexOf("endstream", from);
  if (end < 0) return null;
  const slice = source.slice(from, end).replace(/(?:\r\n|\n|\r)$/, "");
  return { data: Buffer.from(slice, "latin1"), head, next: end + 9 };
}

function inflatePdf(data, head) {
  const options = { maxOutputLength: MAX_ENTRY_BYTES };
  let text = "";
  try {
    if (!/FlateDecode/.test(head)) text = data.length > MAX_ENTRY_BYTES ? "" : data.toString("latin1");
    else {
      try {
        text = zlib.inflateSync(data, options).toString("latin1");
      } catch {
        text = zlib.inflateRawSync(data, options).toString("latin1");
      }
    }
  } catch {
    text = "";
  }
  return text.length > MAX_ENTRY_BYTES ? text.slice(0, MAX_ENTRY_BYTES) : text;
}

function pdfStreams(bytes) {
  const source = bytes.toString("latin1");
  const streams = [];
  const re = /stream\r?\n/g;
  let match = re.exec(source);
  while (match && streams.length < MAX_PDF_STREAMS) {
    const found = pdfStreamAt(source, match);
    if (!found) break;
    streams.push(found);
    re.lastIndex = found.next;
    match = re.exec(source);
  }

  const cmap = { map: new Map(), width: 2 };
  const decoded = streams.map((item) => inflatePdf(item.data, item.head));
  for (const text of decoded) {
    if (!/beginbfchar|beginbfrange/.test(text)) continue;
    const parsed = parseCMap(text);
    parsed.map.forEach((value, key) => cmap.map.set(key, value));
    cmap.width = Math.max(cmap.width, parsed.width);
  }

  const chunks = [];
  for (const text of decoded) {
    if (!text || /beginbfchar|beginbfrange/.test(text)) continue;
    const extracted = pdfLiterals(text, cmap);
    if (extracted.trim()) chunks.push(extracted.trim());
  }
  const text = chunks.join("\n");
  const sample = text.slice(0, 2000);
  if (!sample.trim()) return "";
  let readable = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) readable += 1;
  }
  return readable / sample.length > 0.9 ? text : "";
}

function rtfText(source) {
  let out = "";
  let i = 0;
  const text = String(source || "");
  const cp1251 = new TextDecoder("windows-1251");
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{" || ch === "}") {
      i += 1;
      continue;
    }
    if (ch === "\\") {
      if (text[i + 1] === "'") {
        const hex = text.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) out += cp1251.decode(Buffer.from([parseInt(hex, 16)]));
        i += 4;
        continue;
      }
      const uni = /^\\u(-?\d+)\??/.exec(text.slice(i));
      if (uni) {
        let code = Number(uni[1]);
        if (code < 0) code += 65536;
        out += String.fromCodePoint(code);
        i += uni[0].length;
        continue;
      }
      if (/^\\par(?![A-Za-z])/.test(text.slice(i)) || /^\\line(?![A-Za-z])/.test(text.slice(i))) {
        out += "\n";
        i += text.startsWith("\\par", i) ? 4 : 5;
        continue;
      }
      const word = /^\\[a-zA-Z]+-?\d* ?/.exec(text.slice(i));
      if (word) {
        i += word[0].length;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function extractText(name, mime, bytes) {
  const ext = extOf(name);
  const head = bytes.subarray(0, 8).toString("latin1");
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return decodeText(bytes);
  if (head.startsWith("%PDF") || mime === "application/pdf" || ext === "pdf") return pdfStreams(bytes);
  if (head.startsWith("{\\rtf") || ext === "rtf" || mime === "application/rtf" || mime === "text/rtf") {
    return rtfText(decodeText(bytes));
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return oleStrings(bytes);
  if (head.startsWith("PK")) {
    if (ext === "xlsx" || mime.includes("spreadsheet")) {
      const sheet = xlsxText(bytes);
      if (sheet) return sheet;
    }
    const office = officePackageText(bytes);
    if (office) return office;
    if (ext === "xlsx" || mime.includes("spreadsheet")) return xlsxText(bytes);
    return "";
  }
  if (
    TEXT_EXT.has(ext) ||
    ext === "docx" ||
    ext === "xlsx" ||
    mime.startsWith("text/") ||
    mime.includes("word") ||
    mime.includes("xml") ||
    mime === "application/json" ||
    looksLikeText(bytes)
  ) {
    const decoded = decodeText(bytes);
    if (decoded.includes("<")) return markupToText(decoded) || decoded;
    return decoded;
  }
  return "";
}

function parseOne(item) {
  if (!item || typeof item !== "object") return null;
  const name = String(item.name || "file").slice(0, 180);
  const declared = String(item.mime || "");
  const ext = extOf(name);
  const packed = item.dataUrl ? decodeDataUrl(item.dataUrl) : null;
  const mime = (packed && packed.mime) || declared || "application/octet-stream";
  const bytes = packed ? packed.bytes : null;

  if (bytes && bytes.length > MAX_BYTES) {
    return { name, mime, kind: "file", text: "", dataUrl: "", note: "Файл больше 4 МБ и не был разобран." };
  }
  if (bytes && bytes.length === 0) {
    return { name, mime, kind: "file", text: "", dataUrl: "", note: `Файл «${name}» пустой.` };
  }

  const isImage = mime.startsWith("image/") || IMAGE_EXT.has(ext);
  if (isImage && item.dataUrl && String(item.dataUrl).startsWith("data:image/")) {
    return { name, mime, kind: "image", text: "", dataUrl: String(item.dataUrl), note: "" };
  }

  if (!bytes && item.text) {
    return { name, mime, kind: "text", text: clip(item.text), dataUrl: "", note: "" };
  }

  if (!bytes) {
    const note = String(item.note || "").trim();
    return note ? { name, mime, kind: "file", text: "", dataUrl: "", note } : null;
  }

  let text = "";
  try {
    text = extractText(name, mime, bytes);
  } catch {
    text = "";
  }
  text = clip(text);
  if (text) return { name, mime, kind: "text", text, dataUrl: "", note: "" };
  return {
    name,
    mime,
    kind: "file",
    text: "",
    dataUrl: "",
    note: `Файл «${name}» получен, но текст из формата ${ext || mime || "unknown"} извлечь не удалось.`,
  };
}

export function parseAttachments(list) {
  const parsed = [];
  for (const item of asArray(list)) {
    if (parsed.length >= 3) break;
    const file = parseOne(item);
    if (file) parsed.push(file);
  }
  return parsed;
}
