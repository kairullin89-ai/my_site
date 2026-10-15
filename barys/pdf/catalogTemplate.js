import { formatPrice } from "../money.js";
import { isAdminRequest, renderToBuffer, resolveLogo, resolveProductImage } from "./engine.js";
import { catalogFileName, catalogLabels, formatCatalogDate } from "./labels.js";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const PAPER = "#fbf6ee";
const INK = "#1c1712";
const MUTE = "#6d5c4e";
const HOT = "#c6531a";
const FRAME = "#e6e5df";
const LINE = "#c9cac4";
const MAX_IDS = 2000;
const MARGIN = 48;
const HEADER_Y = 38;
const HEADER_LINE_Y = 56;
const CONTENT_TOP = 74;
const FOOTER_LINE_Y = PAGE_H - 68;
const FOOTER_TEXT_Y = PAGE_H - 50;

export { catalogFileName, isAdminRequest };

export function parseCatalogRequest(body) {
  const lang = body.lang == null || body.lang === "" ? "ru" : String(body.lang);
  if (lang !== "ru" && lang !== "kk") return { error: "invalid lang" };
  const currency = body.currency == null || body.currency === "" ? "kzt" : String(body.currency);
  if (currency !== "kzt" && currency !== "usd" && currency !== "rub") return { error: "invalid currency" };
  if (body.ids == null) return { lang, currency, ids: null };
  if (!Array.isArray(body.ids)) return { error: "invalid ids" };
  if (body.ids.length > MAX_IDS) return { error: "too many products" };
  const ids = [];
  for (const item of body.ids) {
    if (typeof item !== "string" && typeof item !== "number") return { error: "invalid ids" };
    const id = String(item).trim();
    if (!id || id.length > 64) return { error: "invalid ids" };
    ids.push(id);
  }
  return { lang, currency, ids };
}

export function selectCatalogProducts(products, ids) {
  const list = Array.isArray(products) ? products : [];
  if (ids == null || ids.length === 0) return { products: list };
  const known = new Set(list.map((item) => item.id));
  for (const id of ids) {
    if (!known.has(id)) return { error: "unknown product" };
  }
  const wanted = new Set(ids);
  return { products: list.filter((item) => wanted.has(item.id)) };
}

export function renderCatalogPdf({ root, products, lang, currency, contacts, now }) {
  const labels = catalogLabels(lang === "kk" ? "kk" : "ru");
  const stamp = now instanceof Date ? now : new Date();
  const money = currency === "usd" || currency === "rub" ? currency : "kzt";
  const list = Array.isArray(products) ? products : [];
  return renderToBuffer(
    (doc) => {
      const ctx = {
        root,
        labels,
        now: stamp,
        currency: money,
        contacts: contacts || {},
      };
      drawCover(doc, ctx);
      if (!list.length) {
        drawEmpty(doc, ctx);
        return;
      }
      list.forEach((product, index) => {
        drawProduct(doc, product, index + 1, ctx);
      });
    },
    { title: labels.documentTitle }
  ).then((buffer) => ({ buffer, filename: catalogFileName(stamp) }));
}

function drawCover(doc, ctx) {
  const { labels, now, root } = ctx;
  doc.addPage({ size: "A4", margin: 0 });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(PAPER);

  const x = 56;
  const width = PAGE_W - 112;
  const logo = resolveLogo(root);
  if (logo) {
    try {
      doc.image(logo, x, 48, { fit: [64, 64], align: "center", valign: "center" });
    } catch {
      /* cover still prints without a logo */
    }
  }

  doc.fillColor(INK).font("Noto-Bold").fontSize(13);
  doc.text(labels.brand, x, 132, { characterSpacing: 4.2, lineBreak: false });

  const lines = Array.isArray(labels.coverLines) ? labels.coverLines : [];
  const longest = lines.reduce((best, line) => (String(line).length > best.length ? String(line) : best), "");
  const titleSize = fitSize(doc, longest || labels.brand, "Noto-Bold", 34, width, 0.6);
  let y = 214;
  doc.fillColor(INK).font("Noto-Bold").fontSize(titleSize);
  for (const line of lines) {
    doc.text(String(line), x, y, { width, characterSpacing: 0.6, lineBreak: false });
    y += titleSize + 4;
  }

  y += 14;
  doc.moveTo(x, y).lineTo(x + 72, y).lineWidth(1.6).strokeColor(HOT).stroke();
  y += 26;

  doc.fillColor(MUTE).font("Noto").fontSize(11);
  for (const line of labels.coverKicker || []) {
    doc.text(String(line), x, y, { characterSpacing: 2.4, lineBreak: false });
    y += 18;
  }

  doc.fillColor(INK).font("Noto").fontSize(44);
  doc.text(String(now.getFullYear()), x, PAGE_H - 176, {
    width,
    align: "right",
    lineBreak: false,
  });

  doc.fillColor(MUTE).font("Noto").fontSize(10);
  doc.text(formatCatalogDate(now), x, PAGE_H - 64, { lineBreak: false });
}

function drawEmpty(doc, ctx) {
  doc.addPage({ size: "A4", margin: 0 });
  paintPage(doc);
  drawChrome(doc, 1, ctx);
  doc.fillColor(MUTE).font("Noto").fontSize(14);
  doc.text(ctx.labels.empty, 48, 360, {
    width: PAGE_W - 96,
    align: "center",
    height: 40,
    ellipsis: true,
  });
}

function drawProduct(doc, product, pageNo, ctx) {
  doc.addPage({ size: "A4", margin: 0 });
  paintPage(doc);
  drawChrome(doc, pageNo, ctx);

  const layout = measureProduct(doc, product, ctx);
  drawPicture(
    doc,
    resolveProductImage(ctx.root, product.image),
    layout.x,
    CONTENT_TOP,
    layout.width,
    layout.photoH,
    ctx.labels.noImage
  );

  doc.fillColor(INK).font("Noto-Bold").fontSize(layout.nameSize);
  doc.text(layout.name, layout.x, layout.nameY, {
    width: layout.width,
    lineGap: 2,
  });

  if (layout.description) {
    doc.fillColor(MUTE).font("Noto").fontSize(layout.descSize);
    doc.text(layout.description, layout.x, layout.descY, {
      width: layout.textWidth,
      lineGap: layout.descGap,
    });
  }

  drawPriceBand(doc, layout, ctx.labels);
}

function paintPage(doc) {
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(PAPER);
}

function drawChrome(doc, pageNo, ctx) {
  const x = MARGIN;
  const width = PAGE_W - MARGIN * 2;
  doc.fillColor(MUTE).font("Noto").fontSize(8.5);
  doc.text(ctx.labels.brand, x, HEADER_Y, { characterSpacing: 1.1, lineBreak: false });
  doc.text(`${ctx.labels.headerCatalog} ${ctx.now.getFullYear()}`, x, HEADER_Y, {
    width,
    align: "right",
    characterSpacing: 1.1,
    lineBreak: false,
  });
  doc.moveTo(x, HEADER_LINE_Y).lineTo(x + width, HEADER_LINE_Y).lineWidth(0.6).strokeColor(LINE).stroke();

  doc.moveTo(x, FOOTER_LINE_Y).lineTo(x + width, FOOTER_LINE_Y).lineWidth(0.6).strokeColor(LINE).stroke();
  const folio = String(pageNo).padStart(2, "0");
  doc.fillColor(INK).font("Noto").fontSize(11);
  const folioW = doc.widthOfString(folio);
  doc.text(folio, x, FOOTER_TEXT_Y - 2, { width, align: "right", lineBreak: false });
  drawContacts(doc, ctx.contacts, x, FOOTER_TEXT_Y, width - folioW - 24);
}

function measureProduct(doc, product, ctx) {
  const x = MARGIN;
  const width = PAGE_W - MARGIN * 2;
  const textWidth = Math.round(width * 0.88);
  const name = String(product.name || "").trim();
  const description = String(product.description || "").trim();
  const unit = String(product.unit || "").trim();
  const priceText = formatPrice(product.price, ctx.currency);
  const priceTop = FOOTER_LINE_Y - 96;
  let photoH = Math.round(PAGE_H * 0.42);
  let nameSize = 26;
  let descSize = 13;
  let descGap = 5;
  const minPhoto = 210;
  const minName = 16;
  const minDesc = 10.5;

  const nameHeight = (size) => {
    doc.font("Noto-Bold").fontSize(size);
    return doc.heightOfString(name || " ", { width, lineGap: 2 });
  };
  const descHeight = (size, gap) => {
    if (!description) return 0;
    doc.font("Noto").fontSize(size);
    return doc.heightOfString(description, { width: textWidth, lineGap: gap });
  };

  let guard = 0;
  while (guard < 100) {
    const nameH = nameHeight(nameSize);
    const descH = descHeight(descSize, descGap);
    const used = CONTENT_TOP + photoH + 24 + nameH + (description ? 14 + descH : 0);
    if (used <= priceTop - 18) break;
    if (photoH > minPhoto) photoH -= 8;
    else if (descGap > 2) descGap -= 1;
    else if (descSize > minDesc) descSize -= 0.5;
    else if (nameSize > minName) nameSize -= 1;
    else break;
    guard += 1;
  }

  const nameH = nameHeight(nameSize);
  const nameY = CONTENT_TOP + photoH + 24;
  const descY = nameY + nameH + 14;
  return {
    x,
    width,
    textWidth,
    photoH,
    nameSize,
    descSize,
    descGap,
    name,
    description,
    unit,
    priceText,
    nameY,
    descY,
    priceTop,
  };
}

function drawPriceBand(doc, layout, labels) {
  const { x, width, priceTop, unit, priceText } = layout;
  const bottom = priceTop + 58;
  doc.moveTo(x, priceTop).lineTo(x + width, priceTop).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.moveTo(x, bottom).lineTo(x + width, bottom).lineWidth(0.6).strokeColor(LINE).stroke();

  doc.fillColor(MUTE).font("Noto").fontSize(8);
  doc.text(labels.unit, x, priceTop + 10, { characterSpacing: 1.3, lineBreak: false });
  doc.text(labels.price, x, priceTop + 10, {
    width,
    align: "right",
    characterSpacing: 1.3,
    lineBreak: false,
  });

  doc.fillColor(INK).font("Noto").fontSize(15);
  doc.text(unit || "—", x, priceTop + 28, { lineBreak: false });
  doc.fillColor(HOT).font("Noto-Bold").fontSize(20);
  doc.text(priceText, x, priceTop + 25, { width, align: "right", lineBreak: false });
}

function drawPicture(doc, file, x, y, w, h, missingLabel) {
  const paintFrame = () => {
    doc.save();
    doc.rect(x, y, w, h).clip();
    doc.rect(x, y, w, h).fill(FRAME);
    doc.restore();
    doc.rect(x, y, w, h).lineWidth(0.6).strokeColor(LINE).stroke();
  };

  if (file) {
    try {
      doc.save();
      doc.rect(x, y, w, h).clip();
      doc.rect(x, y, w, h).fill(FRAME);
      doc.image(file, x + 16, y + 16, {
        fit: [w - 32, h - 32],
        align: "center",
        valign: "center",
      });
      doc.restore();
      doc.rect(x, y, w, h).lineWidth(0.6).strokeColor(LINE).stroke();
      return;
    } catch {
      try {
        doc.restore();
      } catch {
        /* image failed before the saved graphics state could be restored */
      }
    }
  }

  paintFrame();
  doc.fillColor(MUTE).font("Noto").fontSize(12);
  doc.text(missingLabel, x + 16, y + h / 2 - 8, {
    width: w - 32,
    align: "center",
    height: 20,
    ellipsis: true,
  });
}

function drawContacts(doc, contacts, x, y, maxWidth) {
  const parts = contactParts(contacts);
  if (!parts.length || maxWidth < 40) return;
  doc.fillColor(MUTE).font("Noto").fontSize(9);
  const gap = 22;
  const widths = parts.map((part) => doc.widthOfString(part));
  const total = widths.reduce((sum, item) => sum + item, 0) + gap * (parts.length - 1);
  const scale = total > maxWidth ? maxWidth / total : 1;
  let cursor = x;
  parts.forEach((part, index) => {
    const itemWidth = widths[index] * scale;
    doc.text(part, cursor, y, { width: itemWidth + 1, lineBreak: false, height: 12 });
    cursor += itemWidth + gap * scale;
  });
}

function contactParts(contacts) {
  const parts = [];
  const email = oneLine(contacts && contacts.email);
  const phone = phoneLabel(contacts && contacts.whatsapp);
  const telegram = oneLine(contacts && contacts.telegram).replace(/^@/, "");
  if (phone) parts.push(phone);
  if (email) parts.push(email);
  if (telegram) parts.push(`@${telegram}`);
  return parts;
}

function oneLine(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim();
}

function phoneLabel(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("7")) {
    return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
  }
  return `+${digits}`;
}

function fitSize(doc, value, font, size, maxWidth, spacing) {
  let current = size;
  doc.font(font);
  while (current > 9) {
    doc.fontSize(current);
    if (doc.widthOfString(value, { characterSpacing: spacing }) <= maxWidth) return current;
    current -= 0.5;
  }
  return current;
}
