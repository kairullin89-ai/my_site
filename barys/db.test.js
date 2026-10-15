import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleData } from "./dataApi.js";
import {
  DbError,
  closeDatabase,
  createOrder,
  listClients,
  listOrders,
  listProducts,
  openDatabase,
  replaceProducts,
  saveProduct,
  updateOrderStatus,
} from "./db.js";

function stampOrder(db, id, createdAt) {
  db.prepare("UPDATE orders SET created_at = ? WHERE id = ?").run(createdAt, id);
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "izim-sqlite-"));
}

function openTemp(root) {
  return openDatabase(root);
}

test("пустая база получает стартовый каталог", () => {
  const root = tempRoot();
  const opened = openTemp(root);
  try {
    assert.equal(opened.imported.already, false);
    assert.equal(opened.imported.products, 7);
    const products = listProducts(opened.db);
    assert.equal(products.length, 7);
    assert.equal(products[0].name, "Плита перекрытия ПК 60-15");
    assert.equal(listOrders(opened.db).orders.length, 0);
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("json каталог и заказы переносятся в sqlite и не затираются повторно", () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "data", "products.json"),
    JSON.stringify([
      {
        id: "custom",
        name: "Бордюр",
        price: "1 500",
        unit: "шт",
        description: "Садовый бордюр",
        image: "assets/products/plant.jpg",
      },
    ]),
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "data", "orders.json"),
    JSON.stringify([
      {
        id: "o1",
        createdAt: "2026-09-01T10:00:00.000Z",
        name: "Алия",
        phone: "+7 701 111 22 33",
        comment: "утром",
        currency: "kzt",
        total: "1 500 ₸",
        channel: "whatsapp",
        status: "done",
        items: [{ id: "custom", name: "Бордюр", unit: "шт", qty: 2, price: "1 500 ₸", lineTotal: "3 000 ₸" }],
      },
    ]),
    "utf8"
  );

  const opened = openTemp(root);
  try {
    assert.equal(opened.imported.products, 1);
    assert.equal(opened.imported.orders, 1);
    assert.equal(fs.existsSync(path.join(root, "data", "products.json")), false);
    assert.equal(fs.existsSync(path.join(root, "data", "products.json.bak")), true);
    assert.equal(fs.existsSync(path.join(root, "data", "orders.json")), false);
    const orders = listOrders(opened.db).orders;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, "done");
    assert.equal(orders[0].items[0].qty, 2);
    assert.equal(orders[0].items[0].lineTotal, "3 000 ₸");
    replaceProducts(opened.db, []);
  } finally {
    closeDatabase(opened.db);
  }

  fs.rmSync(path.join(root, "data", "izim.sqlite"));
  for (const suffix of ["-wal", "-shm"]) {
    const extra = path.join(root, "data", `izim.sqlite${suffix}`);
    if (fs.existsSync(extra)) fs.rmSync(extra);
  }

  const restored = openTemp(root);
  try {
    assert.equal(listProducts(restored.db).length, 1);
    assert.equal(listProducts(restored.db)[0].id, "custom");
    assert.equal(listOrders(restored.db).orders[0].name, "Алия");
    replaceProducts(restored.db, []);
  } finally {
    closeDatabase(restored.db);
  }

  const kept = openTemp(root);
  try {
    assert.equal(kept.imported.already, true);
    assert.deepEqual(listProducts(kept.db), []);
  } finally {
    closeDatabase(kept.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("заказ сохраняется, повтор с тем же id не дублируется, статус меняется", () => {
  const root = tempRoot();
  const opened = openTemp(root);
  try {
    const body = {
      id: "order-1",
      name: "Ерлан",
      phone: "87015554433",
      currency: "kzt",
      total: "89 000 ₸",
      channel: "telegram",
      items: [{ id: "p1", name: "Плита", unit: "шт", qty: 1, price: "89 000 ₸", lineTotal: "89 000 ₸" }],
    };
    const created = createOrder(opened.db, body);
    assert.equal(created.duplicate, false);
    assert.equal(created.order.phone, "87015554433");
    assert.equal(created.order.channel, "telegram");
    assert.equal(created.order.currency, "kzt");
    assert.equal(created.order.total, "89 000 ₸");
    assert.equal(created.order.items[0].name, "Плита перекрытия ПК 60-15");
    assert.equal(created.order.items[0].price, "89 000 ₸");
    const again = createOrder(opened.db, body);
    assert.equal(again.duplicate, true);
    assert.equal(again.order.phone, created.order.phone);
    assert.throws(
      () => createOrder(opened.db, { ...body, name: "Другой" }),
      (err) => err instanceof DbError && err.status === 409 && !/87015554433/.test(err.message)
    );
    assert.equal(listOrders(opened.db).orders.length, 1);
    assert.deepEqual(updateOrderStatus(opened.db, "order-1", "cancelled"), {
      id: "order-1",
      status: "cancelled",
    });
    assert.throws(() => createOrder(opened.db, { name: "А", phone: "123", items: body.items }), /invalid phone/);
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("редактирование товара переживает перезапуск, количество в заказе сохраняется", () => {
  const root = tempRoot();
  const opened = openTemp(root);
  const env = { ADMIN_PASSWORD: "secret" };
  try {
    const before = listProducts(opened.db);
    const edited = before.map((product) =>
      product.id === "p1"
        ? {
            ...product,
            name: "Плита ПК 60-15 усиленная",
            price: "91 000",
            unit: "шт",
            description: "Новое описание для склада.",
            image: "data:image/jpeg;base64,abc",
          }
        : product
    );
    const saved = handleData({
      db: opened.db,
      method: "PUT",
      pathname: "/api/products",
      raw: JSON.stringify({ products: edited }),
      env,
      adminHeader: "secret",
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.products[0].name, "Плита ПК 60-15 усиленная");
    assert.equal(saved.body.products[1].id, "p2");

    const order = handleData({
      db: opened.db,
      method: "POST",
      pathname: "/api/orders",
      raw: JSON.stringify({
        id: "edit-order",
        name: "Алия",
        phone: "+7 701 111 22 33",
        currency: "kzt",
        total: "182 000 ₸",
        channel: "whatsapp",
        items: [
          { id: "p1", name: "Плита ПК 60-15 усиленная", unit: "шт", qty: 2, price: "91 000 ₸", lineTotal: "182 000 ₸" },
        ],
      }),
      env,
      adminHeader: "",
    });
    assert.equal(order.status, 201);
  } finally {
    closeDatabase(opened.db);
  }

  const again = openTemp(root);
  try {
    const products = listProducts(again.db);
    assert.equal(products.length, 7);
    assert.equal(products[0].name, "Плита ПК 60-15 усиленная");
    assert.equal(products[0].price, "91 000");
    assert.equal(products[0].description, "Новое описание для склада.");
    assert.equal(products[0].image, "assets/products/uploads/p1.jpg");
    assert.equal(fs.existsSync(path.join(root, products[0].image)), true);
    assert.equal(products[1].name, "Кольцо стеновое КС 10-9");
    assert.equal(products[6].id, "p7");
    const orders = listOrders(again.db).orders;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].items[0].qty, 2);
    assert.equal(orders[0].items[0].name, "Плита ПК 60-15 усиленная");
    assert.equal(orders[0].status, "new");
  } finally {
    closeDatabase(again.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("битый товар не затирает каталог, битый json не удаляется", () => {
  const root = tempRoot();
  const opened = openTemp(root);
  try {
    assert.throws(
      () =>
        replaceProducts(opened.db, [
          { id: "ok", name: "Лоток", price: "900", unit: "шт", description: "", image: "assets/products/plant.jpg" },
          { id: "bad", name: "", price: "", unit: "шт", description: "", image: "assets/products/plant.jpg" },
        ]),
      /invalid product/
    );
    assert.equal(listProducts(opened.db).length, 7);
    assert.throws(
      () =>
        replaceProducts(opened.db, [
          { id: "same", name: "Один", price: "1", unit: "шт", description: "", image: "a.jpg" },
          { id: "same", name: "Два", price: "2", unit: "шт", description: "", image: "b.jpg" },
        ]),
      /duplicate product id/
    );
    assert.equal(listProducts(opened.db)[0].id, "p1");
  } finally {
    closeDatabase(opened.db);
  }

  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const broken = path.join(root, "data", "products.json");
  fs.writeFileSync(broken, JSON.stringify([{ id: "x", name: "Без цены", price: "", unit: "шт" }]), "utf8");
  fs.rmSync(path.join(root, "data", "izim.sqlite"));
  for (const suffix of ["-wal", "-shm"]) {
    const extra = path.join(root, "data", `izim.sqlite${suffix}`);
    if (fs.existsSync(extra)) fs.rmSync(extra);
  }
  assert.throws(() => openTemp(root), /rejected a product/);
  assert.equal(fs.existsSync(broken), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("api каталога и заказов требует пароль администратора", () => {
  const root = tempRoot();
  const opened = openTemp(root);
  const env = { ADMIN_PASSWORD: "secret" };
  try {
    const listed = handleData({
      db: opened.db,
      method: "GET",
      pathname: "/api/products",
      raw: "",
      env,
      adminHeader: "",
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.count, 7);

    assert.throws(
      () =>
        handleData({
          db: opened.db,
          method: "PUT",
          pathname: "/api/products",
          raw: JSON.stringify({ products: [] }),
          env,
          adminHeader: "nope",
        }),
      /unauthorized/
    );

    const cleared = handleData({
      db: opened.db,
      method: "PUT",
      pathname: "/api/products",
      raw: JSON.stringify({
        products: [{ id: "x", name: "Лоток", price: "900", unit: "шт", description: "", image: "assets/products/plant.jpg" }],
        password: "secret",
      }),
      env,
      adminHeader: "",
    });
    assert.equal(cleared.body.count, 1);
    assert.equal(listProducts(opened.db)[0].name, "Лоток");

    const saved = handleData({
      db: opened.db,
      method: "POST",
      pathname: "/api/orders",
      raw: JSON.stringify({
        name: "Дана",
        phone: "+77012223344",
        items: [{ id: "x", name: "Чужое имя", qty: 3, unit: "шт", price: "1", lineTotal: "1" }],
      }),
      env,
      adminHeader: "",
    });
    assert.equal(saved.status, 201);

    assert.throws(
      () =>
        handleData({
          db: opened.db,
          method: "GET",
          pathname: "/api/orders",
          raw: "",
          env,
          adminHeader: "",
        }),
      /unauthorized/
    );

    const orders = handleData({
      db: opened.db,
      method: "GET",
      pathname: "/api/orders",
      raw: "",
      env,
      adminHeader: "secret",
    });
    assert.equal(orders.body.count, 1);
    assert.equal(orders.body.orders[0].items[0].qty, 3);
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("один товар пишется отдельно, фото уходит в файл, заказы отдаются страницами", () => {
  const root = tempRoot();
  const opened = openTemp(root);
  const env = { ADMIN_PASSWORD: "secret" };
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  try {
    const before = listProducts(opened.db).find((product) => product.id === "p2");
    const saved = handleData({
      db: opened.db,
      method: "PATCH",
      pathname: "/api/products",
      raw: JSON.stringify({
        product: {
          id: "p1",
          name: "Плита после правки",
          price: "90 000",
          unit: "шт",
          description: "Только эта строка.",
          image: png,
        },
      }),
      env,
      adminHeader: "secret",
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.product.image, "assets/products/uploads/p1.png");
    assert.equal(fs.existsSync(path.join(root, saved.body.product.image)), true);
    const products = listProducts(opened.db);
    assert.equal(products.find((product) => product.id === "p2").name, before.name);
    assert.equal(products.find((product) => product.id === "p2").price, before.price);

    const p7 = listProducts(opened.db).find((product) => product.id === "p7");
    const created = saveProduct(
      opened.db,
      {
        id: "extra",
        name: "Новый лоток",
        price: "700",
        unit: "шт",
        description: "",
        image: "assets/products/plant.jpg",
      },
      { create: true }
    );
    assert.equal(created.id, "extra");
    assert.equal(listProducts(opened.db)[0].id, "extra");
    assert.equal(listProducts(opened.db).find((product) => product.id === "p7").name, p7.name);

    const orderBody = {
      name: "Алия",
      phone: "+7 701 111 22 33",
      currency: "kzt",
      total: "1 ₸",
      channel: "whatsapp",
      items: [{ id: "p1", name: "Плита", unit: "шт", qty: 1, price: "1", lineTotal: "1" }],
    };
    createOrder(opened.db, { ...orderBody, id: "older", createdAt: "2026-01-01T00:00:00.000Z" });
    createOrder(opened.db, { ...orderBody, id: "newer", createdAt: "2026-02-01T00:00:00.000Z" });
    stampOrder(opened.db, "older", "2026-01-01T00:00:00.000Z");
    stampOrder(opened.db, "newer", "2026-02-01T00:00:00.000Z");
    const page = listOrders(opened.db, { limit: 1, offset: 0 });
    assert.equal(page.orders.length, 1);
    assert.equal(page.orders[0].id, "newer");
    assert.equal(page.total, 2);
    assert.equal(page.fresh, 2);
    const older = listOrders(opened.db, { limit: 1, offset: 1 });
    assert.equal(older.orders.length, 1);
    assert.equal(older.orders[0].id, "older");
    assert.equal(older.orders[0].items[0].name, "Плита после правки");
    assert.equal(older.orders[0].items[0].price, "90 000 ₸");
    assert.equal(older.total, 2);
    const clients = listClients(opened.db);
    assert.equal(clients.length, 1);
    assert.equal(clients[0].ordersCount, 2);
    assert.equal(clients[0].lastOrder.items.length, 1);
    assert.equal(clients[0].phone, "+7 701 111 22 33");

    const removed = handleData({
      db: opened.db,
      method: "DELETE",
      pathname: "/api/products",
      raw: JSON.stringify({ id: "extra" }),
      env,
      adminHeader: "secret",
    });
    assert.equal(removed.status, 200);
    assert.equal(listProducts(opened.db).some((product) => product.id === "extra"), false);
    assert.equal(listProducts(opened.db).some((product) => product.id === "p1"), true);
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("сорванное сохранение не подменяет фото и не стирает соседей", () => {
  const root = tempRoot();
  const opened = openTemp(root);
  const env = { ADMIN_PASSWORD: "secret" };
  const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAg=";
  try {
    const uploadDir = path.join(root, "assets", "products", "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const kept = path.join(uploadDir, "p1.jpg");
    fs.writeFileSync(kept, Buffer.from("OLD-PHOTO"));
    const before = listProducts(opened.db).map((product) => ({ ...product }));

    assert.throws(
      () =>
        replaceProducts(opened.db, [
          {
            id: "p1",
            name: "Не должно сохраниться",
            price: "1",
            unit: "шт",
            description: "",
            image: jpeg,
          },
          { id: "bad", name: "", price: "", unit: "шт", description: "", image: "assets/products/plant.jpg" },
        ]),
      /invalid product/
    );
    assert.equal(fs.readFileSync(kept, "utf8"), "OLD-PHOTO");
    assert.equal(fs.existsSync(path.join(uploadDir, "p1.jpg.tmp")), false);
    assert.deepEqual(
      listProducts(opened.db).map((product) => product.name),
      before.map((product) => product.name)
    );

    opened.db.exec(`
      CREATE TRIGGER fail_product_update BEFORE UPDATE ON products
      BEGIN
        SELECT RAISE(ABORT, 'boom');
      END;
    `);
    assert.throws(
      () =>
        saveProduct(
          opened.db,
          {
            id: "p1",
            name: "Тоже не должно сохраниться",
            price: "2",
            unit: "шт",
            description: "сбой",
            image: jpeg,
          },
          { create: false }
        ),
      /boom/
    );
    assert.equal(fs.readFileSync(kept, "utf8"), "OLD-PHOTO");
    assert.equal(listProducts(opened.db).find((product) => product.id === "p1").name, before[0].name);
    opened.db.exec("DROP TRIGGER fail_product_update");

    assert.throws(
      () =>
        handleData({
          db: opened.db,
          method: "PATCH",
          pathname: "/api/products",
          raw: JSON.stringify({
            product: { id: "p2", name: "Чужой", price: "1", unit: "шт", description: "", image: "a.jpg" },
          }),
          env,
          adminHeader: "wrong",
        }),
      /unauthorized/
    );
    assert.equal(listProducts(opened.db).find((product) => product.id === "p2").name, before.find((product) => product.id === "p2").name);

    const orderBody = {
      name: "Алия",
      phone: "+7 701 111 22 33",
      currency: "kzt",
      total: "1 ₸",
      channel: "whatsapp",
      items: [{ id: "p1", name: "Плита", unit: "шт", qty: 1, price: "1", lineTotal: "1" }],
    };
    createOrder(opened.db, { ...orderBody, id: "plus", createdAt: "2026-03-01T00:00:00.000Z" });
    createOrder(opened.db, {
      ...orderBody,
      id: "eight",
      phone: "87011112233",
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    stampOrder(opened.db, "plus", "2026-03-01T00:00:00.000Z");
    stampOrder(opened.db, "eight", "2026-04-01T00:00:00.000Z");
    const clients = listClients(opened.db);
    assert.equal(clients.length, 1);
    assert.equal(clients[0].ordersCount, 2);
    assert.equal(clients[0].phoneKey, "77011112233");
    assert.equal(clients[0].lastOrder.id, "eight");
    const asked = handleData({
      db: opened.db,
      method: "GET",
      pathname: "/api/orders",
      searchParams: new URLSearchParams("limit=1&offset=1"),
      raw: "",
      env,
      adminHeader: "secret",
    });
    assert.equal(asked.body.count, 2);
    assert.equal(asked.body.fresh, 2);
    assert.equal(asked.body.orders.length, 1);
    assert.equal(asked.body.orders[0].id, "plus");
    assert.equal(asked.body.orders[0].items.length, 1);
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
