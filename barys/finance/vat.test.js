import assert from "node:assert/strict";
import test from "node:test";
import {
  addVat,
  calculateLine,
  formatTiyn,
  groupVat,
  parsePriceToTiyn,
  percentToBasisPoints,
  splitGross,
  sumLines,
} from "./vat.js";

test("деньги хранятся в тиынах и не зависят от двоичной дроби", () => {
  assert.equal(parsePriceToTiyn("100 000"), 10000000);
  assert.equal(parsePriceToTiyn("116 000 ₸"), 11600000);
  assert.equal(parsePriceToTiyn("89 000,50"), 8900050);
  assert.equal(parsePriceToTiyn("0,1"), 10);
  assert.equal(formatTiyn(11600000), "116 000 ₸");
  assert.equal(formatTiyn(8900050), "89 000,50 ₸");
  assert.equal(percentToBasisPoints(16), 1600);
  assert.equal(percentToBasisPoints(16.5), 1650);
});

test("цена без НДС: база, налог и итог сходятся", () => {
  const line = calculateLine({
    qty: 1,
    unitPriceTiyn: 10000000,
    pricesIncludeVat: false,
    treatment: "STANDARD",
    rateBp: 1600,
  });
  assert.equal(line.lineNet, 10000000);
  assert.equal(line.lineVat, 1600000);
  assert.equal(line.lineGross, 11600000);
  assert.equal(line.lineNet + line.lineVat, line.lineGross);
});

test("цена с НДС выделяет налог и сохраняет итог", () => {
  const line = calculateLine({
    qty: 1,
    unitPriceTiyn: 11600000,
    pricesIncludeVat: true,
    treatment: "STANDARD",
    rateBp: 1600,
  });
  assert.equal(line.lineGross, 11600000);
  assert.equal(line.lineNet + line.lineVat, line.lineGross);
  assert.equal(line.lineVat, 1600000);
  assert.equal(line.lineNet, 10000000);
});

test("количество больше одного округляется по строке", () => {
  const line = calculateLine({
    qty: 3,
    unitPriceTiyn: 100,
    pricesIncludeVat: false,
    treatment: "STANDARD",
    rateBp: 1600,
  });
  assert.equal(line.lineNet + line.lineVat, line.lineGross);
  assert.equal(line.lineNet, 300);
});

test("нулевая, освобождённая и неприменимая ставка не создают налог", () => {
  for (const treatment of ["ZERO", "EXEMPT", "NOT_APPLICABLE"]) {
    const excluded = calculateLine({
      qty: 2,
      unitPriceTiyn: 5000,
      pricesIncludeVat: false,
      treatment,
      rateBp: treatment === "ZERO" ? 0 : null,
    });
    assert.equal(excluded.lineVat, 0);
    assert.equal(excluded.lineNet, excluded.lineGross);
    const included = calculateLine({
      qty: 2,
      unitPriceTiyn: 5000,
      pricesIncludeVat: true,
      treatment,
      rateBp: treatment === "ZERO" ? 0 : null,
    });
    assert.equal(included.lineVat, 0);
    assert.equal(included.lineGross, 10000);
  }
});

test("дробная цена, маленькая и большая сумма держат инвариант", () => {
  const samples = [
    { qty: 1, unitPriceTiyn: 1, pricesIncludeVat: true, treatment: "STANDARD", rateBp: 1600 },
    { qty: 7, unitPriceTiyn: 8900050, pricesIncludeVat: false, treatment: "CUSTOM", rateBp: 500 },
    { qty: 40, unitPriceTiyn: 999999999, pricesIncludeVat: true, treatment: "STANDARD", rateBp: 1600 },
  ];
  for (const sample of samples) {
    const line = calculateLine(sample);
    assert.equal(line.lineNet + line.lineVat, line.lineGross);
    assert.equal(line.unitNet + line.unitVat, line.unitGross);
  }
});

test("несколько ставок в одном заказе суммируются по строкам", () => {
  const lines = [
    calculateLine({ qty: 1, unitPriceTiyn: 10000000, pricesIncludeVat: false, treatment: "STANDARD", rateBp: 1600 }),
    calculateLine({ qty: 2, unitPriceTiyn: 5000000, pricesIncludeVat: false, treatment: "ZERO", rateBp: 0 }),
    calculateLine({ qty: 1, unitPriceTiyn: 3000000, pricesIncludeVat: true, treatment: "EXEMPT", rateBp: null }),
  ];
  const total = sumLines(lines);
  assert.equal(total.net, lines.reduce((sum, line) => sum + line.lineNet, 0));
  assert.equal(total.vat, lines.reduce((sum, line) => sum + line.lineVat, 0));
  assert.equal(total.gross, lines.reduce((sum, line) => sum + line.lineGross, 0));
  assert.equal(total.net + total.vat, total.gross);
  const groups = groupVat(lines);
  assert.equal(groups.length, 3);
  assert.equal(groups.reduce((sum, group) => sum + group.vat, 0), total.vat);
});

test("отрицательные и пустые значения отклоняются", () => {
  assert.throws(() => calculateLine({ qty: 0, unitPriceTiyn: 100, pricesIncludeVat: false, treatment: "STANDARD", rateBp: 1600 }), /invalid qty/);
  assert.throws(() => calculateLine({ qty: -1, unitPriceTiyn: 100, pricesIncludeVat: false, treatment: "STANDARD", rateBp: 1600 }), /invalid qty/);
  assert.throws(() => calculateLine({ qty: 1, unitPriceTiyn: -1, pricesIncludeVat: false, treatment: "STANDARD", rateBp: 1600 }), /invalid price/);
  assert.equal(addVat(100, 1600).net + addVat(100, 1600).vat, addVat(100, 1600).gross);
  assert.equal(splitGross(11600, 1600).net + splitGross(11600, 1600).vat, 11600);
});
