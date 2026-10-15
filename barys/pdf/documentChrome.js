export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 48;
export const CONTENT_W = PAGE_W - MARGIN * 2;
export const LIMIT_Y = PAGE_H - 78;
export const FOOTER_Y = PAGE_H - 50;

export const COLOR = {
  paper: "#ffffff",
  ink: "#1c1712",
  mute: "#5e5146",
  hot: "#c6531a",
  line: "#d5cdc3",
  band: "#f4efe8",
  banner: "#f8efe6",
  mark: "#b0aea8",
  steel: "#0e6b64",
  cream: "#fbf6ee",
  field: "#f6f1ea",
};

export function addPaperPage(doc) {
  doc.addPage({ size: "A4", margin: 0 });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(COLOR.paper);
}

export function paintWatermark(doc, text) {
  if (!text) return;
  doc.save();
  doc.opacity(0.065);
  doc.fillColor(COLOR.mark);
  doc.font("Noto-Bold").fontSize(96);
  doc.rotate(-32, { origin: [PAGE_W / 2, PAGE_H / 2] });
  const width = doc.widthOfString(text);
  doc.text(text, (PAGE_W - width) / 2, PAGE_H / 2 - 40, { lineBreak: false });
  doc.restore();
}

export function paintFirstHeader(doc, { title, number, date }) {
  const top = 40;
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(11);
  doc.text("БАРЫС", MARGIN, top, { characterSpacing: 1.6, lineBreak: false });
  doc.font("Noto").fontSize(8).fillColor(COLOR.mute);
  doc.text("ЗАВОД ЖБИ", MARGIN, top + 2, { width: CONTENT_W, align: "right", lineBreak: false });
  const ruleY = top + 18;
  doc.moveTo(MARGIN, ruleY).lineTo(MARGIN + 28, ruleY).lineWidth(1.6).strokeColor(COLOR.hot).stroke();
  doc.moveTo(MARGIN + 28, ruleY).lineTo(MARGIN + CONTENT_W, ruleY).lineWidth(0.6).strokeColor(COLOR.line).stroke();

  const titleY = ruleY + 16;
  const titleSize = fitFont(doc, title, "Noto-Bold", 20, 14, CONTENT_W, 0.4);
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(titleSize);
  doc.text(title, MARGIN, titleY, { width: CONTENT_W, align: "center", characterSpacing: 0.4, lineBreak: false });
  const numberSize = fitFont(doc, number, "Noto", 9.5, 7, CONTENT_W, 0);
  doc.font("Noto").fontSize(numberSize).fillColor(COLOR.mute);
  doc.text(number, MARGIN, titleY + 24, { width: CONTENT_W, align: "center", lineBreak: false });
  const dateY = titleY + 26 + numberSize;
  doc.font("Noto").fontSize(9).fillColor(COLOR.mute);
  doc.text(date, MARGIN, dateY, { width: CONTENT_W, align: "center", lineBreak: false });
  return dateY + 16;
}

export function paintRunHeader(doc, { title, number }) {
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(8);
  doc.text("БАРЫС", MARGIN, 40, { characterSpacing: 1.1, lineBreak: false });
  const caption = fitLine(doc, `${title}   ${number}`, CONTENT_W - 78);
  doc.font("Noto").fontSize(8).fillColor(COLOR.mute);
  doc.text(caption, MARGIN + 70, 40, { width: CONTENT_W - 70, align: "right", lineBreak: false });
  doc.moveTo(MARGIN, 54).lineTo(MARGIN + CONTENT_W, 54).lineWidth(0.6).strokeColor(COLOR.line).stroke();
  return 66;
}

export function paintFooter(doc, note) {
  doc.moveTo(MARGIN, PAGE_H - 64).lineTo(MARGIN + CONTENT_W, PAGE_H - 64).lineWidth(0.6).strokeColor(COLOR.line).stroke();
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(7.5);
  doc.text("БАРЫС", MARGIN, FOOTER_Y, { characterSpacing: 0.8, lineBreak: false });
  const meta = fitLine(doc, String(note || ""), CONTENT_W - 118);
  doc.fillColor(COLOR.mute).font("Noto").fontSize(7.5);
  doc.text(meta, MARGIN + 48, FOOTER_Y, { width: CONTENT_W - 130, lineBreak: false });
}

export function stampPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let index = 0; index < total; index += 1) {
    doc.switchToPage(range.start + index);
    const label = `${index + 1} / ${total}`;
    doc.fillColor(COLOR.ink).font("Noto").fontSize(8);
    doc.text(label, MARGIN, FOOTER_Y, { width: CONTENT_W, align: "right", lineBreak: false });
  }
}

export function paintBanner(doc, y, text) {
  doc.font("Noto-Bold").fontSize(8);
  const height = Math.max(20, doc.heightOfString(text, { width: CONTENT_W - 22, align: "center" }) + 10);
  doc.save();
  doc.rect(MARGIN, y, CONTENT_W, height).fill(COLOR.banner);
  doc.rect(MARGIN, y, 4, height).fill(COLOR.hot);
  doc.restore();
  doc.fillColor(COLOR.hot).font("Noto-Bold").fontSize(8);
  doc.text(text, MARGIN + 12, y + 5, { width: CONTENT_W - 22, align: "center" });
  return y + height;
}

export function paintMarkedSection(doc, y, rawTitle) {
  const parsed = String(rawTitle || "").match(/^([A-Za-z0-9]+)\.\s+(.+)$/);
  const mark = parsed ? parsed[1] : "";
  const title = parsed ? parsed[2] : String(rawTitle || "");
  const badge = 18;
  if (mark) {
    doc.save();
    doc.roundedRect(MARGIN, y, badge, 14, 2).fill(COLOR.steel);
    doc.restore();
    doc.fillColor(COLOR.cream).font("Noto-Bold").fontSize(7.5);
    doc.text(mark, MARGIN, y + 3, { width: badge, align: "center", lineBreak: false });
  }
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(9);
  doc.text(title, MARGIN + (mark ? badge + 8 : 0), y + 2, {
    width: CONTENT_W - (mark ? badge + 8 : 0),
    lineBreak: false,
  });
  const lineY = y + 18;
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT_W, lineY).lineWidth(0.7).strokeColor(COLOR.steel).stroke();
  return lineY + 4;
}

export function paintSectionLabel(doc, x, y, text) {
  doc.fillColor(COLOR.mute).font("Noto-Bold").fontSize(8);
  doc.text(String(text || ""), x, y, { characterSpacing: 0.8, lineBreak: false });
  return y + 14;
}

export function measureLabelValue(doc, label, value, width, labelWidth) {
  const captionWidth = labelWidth;
  const valueWidth = Math.max(40, width - captionWidth);
  const text = value == null || String(value).trim() === "" ? "—" : String(value);
  doc.font("Noto").fontSize(8.5);
  const labelHeight = doc.heightOfString(String(label || ""), { width: captionWidth - 10, lineGap: 1 });
  const valueHeight = doc.heightOfString(text, { width: valueWidth - 8, lineGap: 1 });
  return Math.max(labelHeight, valueHeight, 12) + 8;
}

export function paintLabelValue(doc, x, y, label, value, width, labelWidth) {
  const captionWidth = labelWidth;
  const valueWidth = Math.max(40, width - captionWidth);
  const text = value == null || String(value).trim() === "" ? "—" : String(value);
  const rowH = measureLabelValue(doc, label, value, width, labelWidth);
  doc.fillColor(COLOR.mute).font("Noto").fontSize(8.5);
  doc.text(String(label || ""), x, y + 1, { width: captionWidth - 8, lineGap: 1 });
  doc.fillColor(COLOR.ink).font("Noto").fontSize(8.5);
  doc.text(text, x + captionWidth, y + 1, { width: valueWidth, lineGap: 1 });
  doc.moveTo(x, y + rowH).lineTo(x + width, y + rowH).lineWidth(0.4).strokeColor(COLOR.line).stroke();
  return y + rowH;
}

export function paintRowFrame(doc, y, height, cols, fill, stroke) {
  const x = MARGIN;
  const color = stroke || COLOR.line;
  doc.save();
  if (fill) doc.rect(x, y, CONTENT_W, height).fill(fill);
  doc.lineWidth(0.45).strokeColor(color);
  doc.moveTo(x, y).lineTo(x + CONTENT_W, y).stroke();
  doc.moveTo(x, y + height).lineTo(x + CONTENT_W, y + height).stroke();
  let cursor = x;
  doc.moveTo(cursor, y).lineTo(cursor, y + height).stroke();
  for (const col of cols) {
    cursor += col.width;
    doc.moveTo(cursor, y).lineTo(cursor, y + height).stroke();
  }
  doc.restore();
}

export function textHeight(doc, text, width, font, size, lineGap = 1) {
  doc.font(font).fontSize(size);
  return doc.heightOfString(String(text || " "), { width, lineGap });
}

export function fitLine(doc, text, width) {
  const value = String(text || "");
  if (doc.widthOfString(value) <= width) return value;
  let cut = value;
  while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function fitFont(doc, text, font, start, min, width, spacing) {
  let size = start;
  doc.font(font);
  while (size > min) {
    doc.fontSize(size);
    if (doc.widthOfString(text, { characterSpacing: spacing }) <= width) return size;
    size -= 0.5;
  }
  return min;
}
