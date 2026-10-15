import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { isAdminRequest, resolveLogo, resolveProductImage } from "./pdf/engine.js";
import {
  catalogFileName,
  parseCatalogRequest,
  renderCatalogPdf,
  selectCatalogProducts,
} from "./pdf/catalogTemplate.js";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sampleImage = "assets/products/plant.jpg";

function pagesOf(buffer) {
  const text = buffer.toString("latin1");
  const found = text.match(/\/Type\s*\/Page(?!s)/g);
  return found ? found.length : 0;
}

function textBottoms(buffer) {
  const source = buffer.toString("latin1");
  const bottoms = [];
  const reStream = /stream\r?\n/g;
  let match = reStream.exec(source);
  while (match) {
    const from = match.index + match[0].length;
    const head = source.slice(Math.max(0, match.index - 400), match.index);
    const lengthMatch = /\/Length\s+(\d+)/.exec(head);
    if (lengthMatch) {
      const data = Buffer.from(source.slice(from, from + Number(lengthMatch[1])), "latin1");
      let text = "";
      try {
        text = (/FlateDecode/.test(head) ? zlib.inflateSync(data) : data).toString("latin1");
      } catch {
        text = "";
      }
      const re = /1 0 0 1 ([0-9.]+) ([0-9.]+) Tm/g;
      let point = re.exec(text);
      while (point) {
        bottoms.push(Number(point[2]));
        point = re.exec(text);
      }
    }
    match = reStream.exec(source);
  }
  return bottoms;
}

function product(partial) {
  return {
    id: "p1",
    name: "Плита перекрытия ПК 60-15",
    price: "89 000",
    unit: "шт",
    description: "Многопустотная плита перекрытия.",
    image: sampleImage,
    ...partial,
  };
}

test("имя файла и разбор запроса", () => {
  assert.equal(catalogFileName(new Date(2026, 9, 1, 15, 0, 0)), "Catalog-2026-10-01.pdf");
  assert.deepEqual(parseCatalogRequest({}), { lang: "ru", currency: "kzt", ids: null });
  assert.equal(parseCatalogRequest({ lang: "en" }).error, "invalid lang");
  assert.equal(parseCatalogRequest({ currency: "eur" }).error, "invalid currency");
  assert.equal(parseCatalogRequest({ ids: "p1" }).error, "invalid ids");
  assert.deepEqual(parseCatalogRequest({ lang: "kk", currency: "usd", ids: [] }), {
    lang: "kk",
    currency: "usd",
    ids: [],
  });
});

test("выбор id сохраняет порядок position и отклоняет неизвестный id", () => {
  const list = [product({ id: "a", name: "A" }), product({ id: "b", name: "B" }), product({ id: "c", name: "C" })];
  assert.deepEqual(
    selectCatalogProducts(list, ["c", "a"]).products.map((item) => item.id),
    ["a", "c"]
  );
  assert.equal(selectCatalogProducts(list, []).products.length, 3);
  assert.equal(selectCatalogProducts(list, ["missing"]).error, "unknown product");
});

test("пароль администратора проверяется так же, как на сервере", () => {
  const env = { ADMIN_PASSWORD: "secret" };
  assert.equal(isAdminRequest(env, "secret", {}), true);
  assert.equal(isAdminRequest(env, " no ", {}), false);
  assert.equal(isAdminRequest(env, "secret ", {}), true);
  assert.equal(isAdminRequest(env, "", { password: "secret" }), true);
  assert.equal(isAdminRequest(env, "wrong", {}), false);
  assert.equal(isAdminRequest({ ADMIN_PASSWORD: "" }, "secret", {}), false);
});

test("шрифт содержит казахские буквы", () => {
  const chars = "ӘәҒғҚқҢңӨөҰұҮүҺһІі";
  for (const file of ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"]) {
    const font = fontkit.openSync(path.join(root, "barys", "pdf", "fonts", file));
    for (const ch of chars) {
      const glyph = font.glyphForCodePoint(ch.codePointAt(0));
      assert.notEqual(glyph.id, 0, `${file} missing ${ch}`);
    }
  }
});

test("картинки читаются только из каталога проекта", () => {
  assert.equal(resolveProductImage(root, "https://example.com/a.jpg"), "");
  assert.equal(resolveProductImage(root, "data:image/png;base64,aaaa"), "");
  assert.equal(resolveProductImage(root, "assets/products/../../.env"), "");
  assert.equal(resolveProductImage(root, "../.env"), "");
  assert.ok(resolveProductImage(root, sampleImage));
  assert.ok(resolveLogo(root));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "izim-pdf-img-"));
  try {
    const dir = path.join(temp, "assets", "products");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "anim.gif"), Buffer.from("GIF89a"));
    fs.writeFileSync(path.join(dir, "note.webp"), Buffer.from("RIFF"));
    assert.equal(resolveProductImage(temp, "assets/products/anim.gif"), "");
    assert.equal(resolveProductImage(temp, "assets/products/note.webp"), "");
    assert.equal(resolveLogo(temp), "");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("каталог из трёх товаров: обложка, страницы, дырявая картинка и длинное описание", async () => {
  const long = "Длинное описание изделия. ".repeat(40);
  const result = await renderCatalogPdf({
    root,
    lang: "ru",
    currency: "kzt",
    now: new Date(2026, 9, 1, 12, 0, 0),
    contacts: { whatsapp: "77014777709", email: "plant@example.com", telegram: "izim" },
    products: [
      product({ id: "a" }),
      product({
        id: "b",
        name: "Бетон без фото",
        description: "",
        image: "https://example.com/secret.jpg",
      }),
      product({
        id: "c",
        name: "Свая с длинным текстом",
        description: long,
        image: "assets/products/missing-file.jpg",
      }),
    ],
  });
  assert.equal(result.filename, "Catalog-2026-10-01.pdf");
  assert.equal(result.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(pagesOf(result.buffer), 4);
  const bottoms = textBottoms(result.buffer);
  assert.ok(bottoms.length > 8);
  for (const y of bottoms) {
    assert.ok(y >= 36 && y <= 810, `text y ${y}`);
  }
});

test("битый jpeg не обрывает каталог и не убирает следующую карточку", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "izim-pdf-broken-"));
  try {
    const dir = path.join(temp, "assets", "products");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(root, "assets", "products", "plant.jpg"), path.join(dir, "ok.jpg"));
    fs.writeFileSync(path.join(dir, "broken.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x11]));
    const result = await renderCatalogPdf({
      root: temp,
      lang: "ru",
      currency: "kzt",
      now: new Date(2026, 9, 1, 12, 0, 0),
      contacts: { whatsapp: "77014777709", email: "plant@example.com\nINJECT", telegram: "izim\r\nbad" },
      products: [
        product({ id: "broken", image: "assets/products/broken.jpg", name: "Битая картинка" }),
        product({ id: "next", image: "assets/products/ok.jpg", name: "Следующая карточка" }),
      ],
    });
    assert.equal(result.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(result.buffer.includes(Buffer.from("%%EOF")));
    assert.equal(pagesOf(result.buffer), 3);
    const draws = pdfText(result.buffer).match(/\/I[0-9]+ DO/g) || [];
    assert.equal(draws.length, 1);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

function pdfText(buffer) {
  const source = buffer.toString("latin1");
  const parts = [];
  const re = /stream\r?\n/g;
  let match = re.exec(source);
  while (match) {
    const from = match.index + match[0].length;
    const head = source.slice(Math.max(0, match.index - 400), match.index);
    const lengthMatch = /\/Length\s+(\d+)/.exec(head);
    if (lengthMatch) {
      const data = Buffer.from(source.slice(from, from + Number(lengthMatch[1])), "latin1");
      try {
        parts.push((/FlateDecode/.test(head) ? zlib.inflateSync(data) : data).toString("latin1"));
      } catch {
        /* skip a stream that is not text */
      }
    }
    match = re.exec(source);
  }
  return parts.join("\n").toUpperCase();
}

test("казахская локаль печатается в PDF", async () => {
  const result = await renderCatalogPdf({
    root,
    lang: "kk",
    currency: "kzt",
    now: new Date(2026, 9, 1),
    contacts: { email: "plant@example.com" },
    products: [
      product({
        name: "Тақта ӨҒҚҢҰҮҺІ",
        description: "Сипаттама: әғқңөұүһі",
      }),
    ],
  });
  assert.equal(result.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(pagesOf(result.buffer), 2);
  const text = pdfText(result.buffer);
  for (const code of ["04E8", "04D9", "0492", "049A", "04A2", "04B0", "04AE", "04BA", "0406", "0456"]) {
    assert.equal(text.includes(code), true, code);
  }
});

test("пустой каталог не падает и не оставляет лишнюю пустую страницу", async () => {
  const result = await renderCatalogPdf({
    root,
    lang: "ru",
    currency: "kzt",
    now: new Date(2026, 9, 1),
    contacts: {},
    products: [],
  });
  assert.equal(pagesOf(result.buffer), 2);
});

test("замер каталога: живые товары, 100 и 500 синтетических", async () => {
  const db = new DatabaseSync(path.join(root, "data", "izim.sqlite"), { readOnly: true });
  let live = [];
  try {
    live = db
      .prepare(
        "SELECT id, name, price, unit, description, image, position FROM products ORDER BY position ASC, id ASC"
      )
      .all();
  } finally {
    db.close();
  }
  assert.ok(live.length >= 1);

  async function measure(label, products) {
    const started = performance.now();
    const heapBefore = process.memoryUsage().heapUsed;
    const result = await renderCatalogPdf({
      root,
      products,
      lang: "ru",
      currency: "kzt",
      contacts: {},
      now: new Date(2026, 9, 1),
    });
    const ms = Math.round(performance.now() - started);
    const heapAfter = process.memoryUsage().heapUsed;
    console.log(
      JSON.stringify({
        label,
        products: products.length,
        pages: pagesOf(result.buffer),
        ms,
        pdfBytes: result.buffer.length,
        heapDelta: heapAfter - heapBefore,
      })
    );
    assert.equal(result.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal(pagesOf(result.buffer), products.length + 1);
    return result;
  }

  await measure("live", live);

  const synthetic = (count) =>
    Array.from({ length: count }, (_, index) =>
      product({
        id: `s${index}`,
        name: index % 11 === 0 ? `Тақта ӨҒҚҢ ${index}` : `Изделие ${index}`,
        price: String(1000 + index),
        unit: index % 4 === 0 ? "м²" : "шт",
        description: index % 3 === 0 ? "" : "Краткое описание тестовой позиции для каталога.",
        image: index % 5 === 0 ? "" : sampleImage,
        position: index,
      })
    );

  await measure("synthetic-100", synthetic(100));
  await measure("synthetic-500", synthetic(500));
});
