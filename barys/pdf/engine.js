import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { isAdminCredential } from "../adminAuth.js";

const fontsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");

export function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isAdminRequest(env, header, body) {
  return isAdminCredential(env, header, body);
}

export function renderToBuffer(draw, info = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      autoFirstPage: false,
      bufferPages: info.bufferPages === true,
      info: {
        Title: info.title || "Catalog",
        Author: "Барыс",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      applyFonts(doc);
      draw(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function applyFonts(doc) {
  const regular = path.join(fontsDir, "NotoSans-Regular.ttf");
  const bold = path.join(fontsDir, "NotoSans-Bold.ttf");
  if (!fs.existsSync(regular) || !fs.existsSync(bold)) {
    throw Object.assign(new Error("catalog font missing"), { status: 500 });
  }
  doc.registerFont("Noto", regular);
  doc.registerFont("Noto-Bold", bold);
}

function sniffImage(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(8);
    const read = fs.readSync(fd, head, 0, 8, 0);
    if (read < 3) return "";
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
    if (read >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "png";
    return "";
  } catch {
    return "";
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function localFile(root, relative, parentParts) {
  const value = String(relative || "").trim().replace(/\\/g, "/");
  if (!value || value.includes("\0") || path.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return "";
  const clean = value.replace(/^\/+/, "");
  const full = path.resolve(root, clean);
  const parent = path.resolve(root, ...parentParts);
  if (!isInside(parent, full)) return "";
  let stat;
  try {
    stat = fs.lstatSync(full);
  } catch {
    return "";
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return "";
  return sniffImage(full) ? full : "";
}

export function resolveLogo(root) {
  return localFile(root, "public/logo.png", ["public"]);
}

export function resolveProductImage(root, image) {
  const value = String(image || "").trim();
  if (!value || value.startsWith("data:") || /^https?:\/\//i.test(value) || value.startsWith("//")) return "";
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("assets/products/")) return "";
  return localFile(root, normalized, ["assets", "products"]);
}
