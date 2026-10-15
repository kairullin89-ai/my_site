import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import adminCss from "../../admin.css?inline";
import { EyeIcon, EyeOffIcon } from "../components/Icons.jsx";
import { usePageCss } from "../hooks/usePageCss.js";
import { useStore } from "../hooks/useStore.js";
import { mediaSrc } from "../lib/media.js";
import {
  DEFAULT_IMAGE,
  addProduct,
  clearProducts,
  deleteProductOnServer,
  downloadCatalogPdf,
  downloadInvoicePdf,
  downloadOrderPdf,
  fetchClientsFromServer,
  fetchOrganization,
  saveOrganization,
  fetchOrdersFromServer,
  formatPrice,
  fromKzt,
  getLocalOrders,
  getProducts,
  login,
  logout,
  normalizePhoneDigits,
  persistOneProduct,
  pushProductsToServer,
  resetProducts,
  retryCatalog,
  toKzt,
  updateOrderStatus,
  updateProduct,
} from "../lib/store.js";

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

const EMPTY_FORM = {
  editId: "",
  name: "",
  price: "",
  currency: "kzt",
  unit: "шт",
  description: "",
  image: DEFAULT_IMAGE,
  imageMode: "upload",
  imageUrl: "",
  vatRateSource: "ORGANIZATION",
  vatTreatment: "STANDARD",
  vatRate: "",
};

function formatOrderDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "—";
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso || "—";
  }
}

function statusLabel(status) {
  if (status === "done") return "Готово";
  if (status === "cancelled") return "Отменён";
  return "Новый";
}

function ordersWord(count) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "заказов";
  if (n1 === 1) return "заказ";
  if (n1 >= 2 && n1 <= 4) return "заказа";
  return "заказов";
}

function buildClientWhatsappUrl(order) {
  const phone = normalizePhoneDigits(order.phone);
  if (!phone) return "";
  const name = String(order.name || "").trim() || "клиент";
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsLine = items.map((item) => `${item.name} × ${item.qty} ${item.unit || "шт"}`).join(", ");
  const message = [
    `Здравствуйте, ${name}! Вы хотели заказать у нас что-то.`,
    "",
    itemsLine ? `По вашей заявке: ${itemsLine}.` : "",
    order.total ? `Итого: ${order.total}.` : "",
    "",
    "Подскажите, удобно уточнить детали?",
  ]
    .filter((line) => line !== "")
    .join("\n");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function buildClientsFromOrders(orders) {
  const map = new Map();
  (orders || []).forEach((order) => {
    const phoneKey = normalizePhoneDigits(order.phone) || String(order.phone || "").trim();
    if (!phoneKey && !order.name) return;
    const key = phoneKey || `name:${String(order.name || "").trim().toLowerCase()}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        name: order.name || "—",
        phone: order.phone || "",
        phoneKey,
        ordersCount: 1,
        lastAt: order.createdAt || "",
        lastTotal: order.total || "",
        channel: order.channel || "whatsapp",
        lastOrder: order,
      });
      return;
    }
    existing.ordersCount += 1;
    if ((order.createdAt || "") > (existing.lastAt || "")) {
      existing.lastAt = order.createdAt || "";
      existing.lastTotal = order.total || "";
      existing.name = order.name || existing.name;
      existing.phone = order.phone || existing.phone;
      existing.channel = order.channel || existing.channel;
      existing.lastOrder = order;
    }
  });
  return [...map.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

export default function AdminPage() {
  usePageCss(adminCss);
  const snap = useStore();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [tab, setTab] = useState("catalog");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]);
  const [orderStats, setOrderStats] = useState({ count: 0, fresh: 0 });
  const [ordersMeta, setOrdersMeta] = useState("");
  const [clientsMeta, setClientsMeta] = useState("");
  const [catalogPdfBusy, setCatalogPdfBusy] = useState(false);
  const catalogPdfBusyRef = useRef(false);
  const ordersSeq = useRef(0);
  const ordersRef = useRef([]);
  const savingRef = useRef(false);
  const imageFileRef = useRef(null);

  useEffect(() => {
    document.title = "Админка — Барыс";
  }, []);

  const loadOrders = useCallback(async (options) => {
    const seq = ++ordersSeq.current;
    const quiet = options && options.quiet;
    const append = options && options.append;
    if (!quiet) setOrdersMeta("Загрузка…");
    const offset = append ? ordersRef.current.length : 0;
    const limit = append ? 50 : Math.min(100, Math.max(50, ordersRef.current.length || 50));
    try {
      const data = await fetchOrdersFromServer("", { offset, limit });
      if (seq !== ordersSeq.current) return;
      const list = Array.isArray(data.orders) ? data.orders : [];
      const next = append ? ordersRef.current.concat(list) : list;
      ordersRef.current = next;
      setOrders(next);
      const parsedCount = Number(data.count);
      const parsedFresh = Number(data.fresh);
      const total = Number.isFinite(parsedCount) ? parsedCount : next.length;
      const fresh = Number.isFinite(parsedFresh) ? parsedFresh : 0;
      setOrderStats({ count: total, fresh });
      setOrdersMeta(total ? `Всего: ${total} · Новых: ${fresh}` : "");
    } catch {
      if (seq !== ordersSeq.current) return;
      const local = getLocalOrders();
      ordersRef.current = local;
      setOrders(local);
      const localClients = buildClientsFromOrders(local);
      const fresh = local.filter((order) => (order.status || "new") === "new").length;
      setClients(localClients);
      setOrderStats({ count: local.length, fresh });
      setOrdersMeta(
        local.length > 0
          ? `Сервер недоступен — показаны локальные копии (${local.length}). Запустите server.ps1.`
          : "Не удалось загрузить заказы. Запустите server.ps1."
      );
      setClientsMeta(localClients.length ? `Клиентов: ${localClients.length}` : "");
    }
  }, []);

  const loadClients = useCallback(async () => {
    try {
      const data = await fetchClientsFromServer("");
      const list = Array.isArray(data.clients) ? data.clients : [];
      setClients(list);
      setClientsMeta(list.length ? `Клиентов: ${list.length}` : "");
    } catch {
      const localClients = buildClientsFromOrders(getLocalOrders());
      setClients(localClients);
      setClientsMeta(
        localClients.length
          ? `Сервер недоступен — показаны локальные копии (${localClients.length}).`
          : "Не удалось загрузить клиентов. Запустите server.ps1."
      );
    }
  }, []);

  useEffect(() => {
    if (!snap.authed) return undefined;
    loadOrders();
    loadClients();
  }, [snap.authed, loadOrders, loadClients]);

  useEffect(() => {
    if (!snap.authed) return undefined;
    if (tab !== "orders" && tab !== "clients") return undefined;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (tab === "clients") loadClients();
      else loadOrders({ quiet: true });
    }, 30000);
    return () => clearInterval(id);
  }, [snap.authed, tab, loadOrders, loadClients]);

  function patch(partial) {
    setForm((current) => ({ ...current, ...partial }));
  }

  function clearForm() {
    setForm(EMPTY_FORM);
    if (imageFileRef.current) imageFileRef.current.value = "";
  }

  async function onCatalogPdf() {
    if (catalogPdfBusyRef.current) return;
    catalogPdfBusyRef.current = true;
    setCatalogPdfBusy(true);
    try {
      const result = await downloadCatalogPdf("");
      if (!result.ok) window.alert("Не удалось сформировать PDF-каталог.");
    } catch {
      window.alert("Не удалось сформировать PDF-каталог.");
    } finally {
      catalogPdfBusyRef.current = false;
      setCatalogPdfBusy(false);
    }
  }

  async function syncCatalogToServer() {
    const result = await pushProductsToServer("");
    if (!result.ok) {
      window.alert("Каталог сохранён в этом браузере, но не на сервере: " + (result.error || "запустите server.ps1"));
      return false;
    }
    return true;
  }

  async function onSave(event) {
    event.preventDefault();
    if (savingRef.current) return;
    let image = form.image.trim();
    if (form.imageMode === "url") image = form.imageUrl.trim() || image;
    if (!image) {
      window.alert("Добавьте картинку: загрузите файл или укажите URL.");
      return;
    }
    if (
      form.vatRateSource === "PRODUCT" &&
      (form.vatTreatment === "STANDARD" || form.vatTreatment === "CUSTOM") &&
      (form.vatRate === "" || !Number.isFinite(Number(form.vatRate)))
    ) {
      window.alert("Укажите ставку НДС для индивидуальной настройки товара.");
      return;
    }
    const data = {
      name: form.name,
      price: toKzt(form.price, form.currency),
      unit: form.unit,
      description: form.description,
      image,
      vatRateSource: form.vatRateSource,
      vatTreatment: form.vatTreatment,
      vatRate: form.vatRate === "" ? null : Number(form.vatRate),
    };
    savingRef.current = true;
    setSaving(true);
    try {
      let item = null;
      if (form.editId) {
        updateProduct(form.editId, data);
        item = getProducts().find((product) => product.id === form.editId) || null;
      } else {
        item = addProduct(data);
        if (!item) {
          window.alert("Укажите название и цену.");
          return;
        }
      }
      if (!item) {
        window.alert("Укажите название и цену.");
        return;
      }
      const result = await persistOneProduct(item, { create: !form.editId });
      if (!result.ok) {
        window.alert("Товар сохранён в этом браузере, но не на сервере: " + (result.error || "запустите server.ps1"));
      }
      clearForm();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function onImageFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("Выберите файл изображения.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert("Файл слишком большой. Максимум 1.5 МБ.");
      event.target.value = "";
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      patch({ image: dataUrl });
    } catch (err) {
      window.alert(err.message || "Ошибка загрузки");
    }
  }

  function startEdit(id) {
    const product = getProducts().find((item) => item.id === id);
    if (!product) return;
    const img = product.image || DEFAULT_IMAGE;
    const isRemote = img.startsWith("http://") || img.startsWith("https://");
    setForm({
      editId: product.id,
      name: product.name,
      price: fromKzt(product.price, "kzt"),
      currency: "kzt",
      unit: product.unit || "шт",
      description: product.description || "",
      image: img,
      imageMode: isRemote ? "url" : "upload",
      imageUrl: isRemote ? img : "",
      vatRateSource: product.vatRateSource === "PRODUCT" ? "PRODUCT" : "ORGANIZATION",
      vatTreatment: product.vatTreatment || "STANDARD",
      vatRate: product.vatRateBp == null ? "" : (product.vatRateBp / 100).toFixed(2),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const newCount = orderStats.fresh;
  const pricePlaceholder = form.currency === "usd" ? "175" : form.currency === "rub" ? "15000" : "89000";

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <p className="eyebrow">Админка</p>
          <h1>Админка Барыс</h1>
        </div>
        <div className="top__actions">
          <Link className="btn btn--ghost" to="/">
            ← На сайт
          </Link>
          {snap.authed ? (
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => {
                logout();
                clearForm();
                setPassword("");
                setLoginError("");
                setTab("catalog");
              }}
            >
              Выйти
            </button>
          ) : null}
        </div>
      </header>

      {snap.authed ? (
        <section className="dashboard">
          <nav className="admin-tabs" role="tablist" aria-label="Разделы админки">
            {[
              ["catalog", "Каталог", null],
              ["orders", "Заказы", newCount],
              ["clients", "Клиенты", clients.length],
              ["settings", "Настройки", null],
            ].map(([id, label, badge]) => (
              <button
                key={id}
                type="button"
                className={`admin-tabs__btn${tab === id ? " is-active" : ""}`}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
                {badge ? <span className="admin-tabs__badge">{badge}</span> : null}
              </button>
            ))}
          </nav>

          {tab === "catalog" ? (
            <div className="dash-panel">
              <form className="card form" onSubmit={onSave}>
                <h2>{form.editId ? "Изменить товар" : "Добавить товар"}</h2>
                <label>
                  Название
                  <input
                    type="text"
                    required
                    placeholder="Плита ПК 60-15"
                    value={form.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </label>
                <div className="row row--price">
                  <label>
                    Цена
                    <input
                      type="text"
                      required
                      placeholder={pricePlaceholder}
                      value={form.price}
                      onChange={(e) => patch({ price: e.target.value })}
                    />
                  </label>
                  <label>
                    Валюта
                    <select value={form.currency} required onChange={(e) => patch({ currency: e.target.value })}>
                      <option value="kzt">₸ теңге</option>
                      <option value="usd">$ доллар</option>
                      <option value="rub">₽ рубль</option>
                    </select>
                  </label>
                  <label>
                    Ед.
                    <input type="text" value={form.unit} placeholder="шт" onChange={(e) => patch({ unit: e.target.value })} />
                  </label>
                </div>
                <p className="field-hint">Цена сохранится и будет доступна во всех валютах на сайте.</p>
                <h3>НДС</h3>
                <label>
                  Налоговые настройки
                  <select value={form.vatRateSource} onChange={(event) => patch({ vatRateSource: event.target.value })}>
                    <option value="ORGANIZATION">Использовать настройки организации</option>
                    <option value="PRODUCT">Индивидуальная настройка товара</option>
                  </select>
                </label>
                {form.vatRateSource === "PRODUCT" ? (
                  <>
                    <label>
                      Налоговый режим
                      <select value={form.vatTreatment} onChange={(event) => patch({ vatTreatment: event.target.value })}>
                        <option value="STANDARD">Стандартная ставка</option>
                        <option value="ZERO">Ставка 0%</option>
                        <option value="EXEMPT">Освобождённый оборот</option>
                        <option value="NOT_APPLICABLE">НДС не применяется</option>
                        <option value="CUSTOM">Другая ставка</option>
                      </select>
                    </label>
                    {form.vatTreatment === "CUSTOM" || form.vatTreatment === "STANDARD" ? (
                      <label>
                        Ставка, %
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={form.vatRate}
                          onChange={(event) => patch({ vatRate: event.target.value })}
                        />
                      </label>
                    ) : null}
                  </>
                ) : (
                  <p className="field-hint">Ставка берётся из настроек организации в момент нового заказа.</p>
                )}
                <label>
                  Описание
                  <textarea
                    rows={3}
                    placeholder="Кратко о изделии"
                    value={form.description}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </label>
                <div className="image-field">
                  <p className="image-field__label">Картинка</p>
                  <div className="image-tabs" role="group" aria-label="Способ картинки">
                    <button
                      type="button"
                      className={`image-tabs__btn${form.imageMode === "upload" ? " is-active" : ""}`}
                      onClick={() => patch({ imageMode: "upload" })}
                    >
                      Загрузка
                    </button>
                    <button
                      type="button"
                      className={`image-tabs__btn${form.imageMode === "url" ? " is-active" : ""}`}
                      onClick={() => patch({ imageMode: "url" })}
                    >
                      URL
                    </button>
                  </div>
                  {form.imageMode === "upload" ? (
                    <div className="image-panel">
                      <label className="file-label">
                        <input ref={imageFileRef} type="file" accept="image/*" onChange={onImageFile} />
                        <span>Выбрать файл</span>
                      </label>
                      <p className="field-hint">JPG, PNG, WebP · до 1.5 МБ</p>
                    </div>
                  ) : (
                    <div className="image-panel">
                      <input
                        type="url"
                        placeholder="https://example.com/photo.jpg"
                        value={form.imageUrl}
                        onChange={(e) => {
                          const value = e.target.value;
                          setForm((current) => ({
                            ...current,
                            imageUrl: value,
                            image: value.trim() || current.image,
                          }));
                        }}
                      />
                      <p className="field-hint">Ссылка на картинку в интернете</p>
                    </div>
                  )}
                  <div className="image-preview">
                    <img src={mediaSrc(form.image || DEFAULT_IMAGE)} alt="Превью" />
                  </div>
                </div>
                <div className="form__actions">
                  <button className="btn btn--primary" type="submit" disabled={saving}>
                    {form.editId ? "Обновить" : "Сохранить"}
                  </button>
                  {form.editId ? (
                    <button className="btn btn--ghost" type="button" onClick={clearForm}>
                      Отмена
                    </button>
                  ) : null}
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={async () => {
                      if (!window.confirm("Загрузить демо-товары (включая сваю)? Текущий каталог будет заменён.")) return;
                      resetProducts();
                      await syncCatalogToServer();
                      clearForm();
                    }}
                  >
                    Загрузить демо
                  </button>
                  <button
                    className="btn btn--danger"
                    type="button"
                    onClick={async () => {
                      if (!window.confirm("Удалить все товары?")) return;
                      clearProducts();
                      await syncCatalogToServer();
                      clearForm();
                    }}
                  >
                    Очистить всё
                  </button>
                </div>
              </form>

              <div className="list-wrap">
                <div className="list-head">
                  <h2>Каталог</h2>
                  <div className="list-head__side">
                    <p>{snap.products.length} шт.</p>
                    <button
                      className="btn btn--primary btn--catalog"
                      type="button"
                      disabled={catalogPdfBusy}
                      onClick={onCatalogPdf}
                    >
                      {catalogPdfBusy ? "Формирование каталога..." : "Скачать PDF-каталог"}
                    </button>
                  </div>
                </div>
                <div className="list">
                  {snap.catalogStatus === "error" ? (
                    <p className="empty">
                      Не удалось загрузить каталог. {snap.catalogError}{" "}
                      <button type="button" className="btn btn--ghost" onClick={() => retryCatalog().catch((err) => console.error(err))}>
                        Повторить попытку
                      </button>
                    </p>
                  ) : snap.catalogStatus === "loading" ? (
                    <p className="empty">Загрузка каталога…</p>
                  ) : snap.products.length === 0 ? (
                    <p className="empty">Пока пусто — добавьте первый товар.</p>
                  ) : (
                    snap.products.map((product) => (
                      <article className="item" key={product.id}>
                        <img src={mediaSrc(product.image)} alt="" />
                        <div>
                          <h3>{product.name}</h3>
                          <p>{product.description || ""}</p>
                          <p className="item__price">
                            {formatPrice(product.price, "kzt")} · {formatPrice(product.price, "usd")} ·{" "}
                            {formatPrice(product.price, "rub")} / {product.unit}
                          </p>
                        </div>
                        <div className="item__actions">
                          <button className="btn btn--ghost" type="button" onClick={() => startEdit(product.id)}>
                            Изменить
                          </button>
                          <button
                            className="btn btn--danger"
                            type="button"
                            onClick={async () => {
                              if (!window.confirm("Удалить товар?")) return;
                              const result = await deleteProductOnServer(product.id);
                              if (!result.ok) {
                                window.alert(
                                  "Товар не удалён на сервере: " + (result.error || "запустите server.ps1")
                                );
                                return;
                              }
                              if (form.editId === product.id) clearForm();
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {tab === "orders" ? (
            <OrdersPanel
              orders={orders}
              meta={ordersMeta}
              hasMore={orders.length < orderStats.count}
              onMore={() => loadOrders({ append: true, quiet: true })}
              onRefresh={() => loadOrders()}
            />
          ) : null}
          {tab === "clients" ? (
            <ClientsPanel clients={clients} meta={clientsMeta} onRefresh={() => loadClients()} />
          ) : null}
          {tab === "settings" ? <OrganizationPanel /> : null}
        </section>
      ) : (
        <section className="login">
          <form
            className="card"
            onSubmit={async (event) => {
              event.preventDefault();
              if (loginBusy) return;
              setLoginBusy(true);
              setLoginError("");
              try {
                const result = await login(password);
                if (result === true) {
                  setPassword("");
                  setTab("catalog");
                  loadOrders();
                } else if (result === "limited") {
                  setLoginError("Слишком много попыток. Подождите минуту.");
                } else if (result === "offline") {
                  setLoginError("Сервер недоступен. Запустите server.ps1.");
                } else {
                  setLoginError("Неверный пароль");
                }
              } finally {
                setLoginBusy(false);
              }
            }}
          >
            <div className="field">
              <label htmlFor="password">Пароль</label>
              <div className="pass-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  placeholder="Пароль"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setLoginError("");
                  }}
                />
                <button
                  className={`pass-toggle${showPassword ? " is-on" : ""}`}
                  type="button"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  title={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  <EyeIcon />
                  <EyeOffIcon />
                </button>
              </div>
            </div>
            <p className="error" hidden={!loginError}>
              {loginError}
            </p>
            <button className="btn btn--primary" type="submit" disabled={loginBusy}>
              Войти
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function emptyOrganization() {
  return {
    legalName: "",
    shortName: "",
    bin: "",
    countryCode: "KZ",
    region: "",
    city: "",
    legalAddress: "",
    phone: "",
    email: "",
    website: "",
    bank: { name: "", iban: "", bic: "", kbe: "", currency: "KZT" },
    tax: {
      regime: "GENERAL",
      vatRegistered: false,
      defaultVatRate: null,
      defaultVatTreatment: "STANDARD",
      vatRegistrationDate: null,
      vatRegistrationStatus: "",
      pricesIncludeVat: null,
      catalogPricesConfirmed: false,
    },
    isDemo: false,
    missing: true,
  };
}

function OrganizationPanel() {
  const [org, setOrg] = useState(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const taxBaseline = useRef(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await fetchOrganization("");
      if (!next) {
        setOrg(emptyOrganization());
        taxBaseline.current = { rate: null, mode: null };
        return;
      }
      taxBaseline.current = {
        rate: next.tax.defaultVatRate,
        mode: next.tax.pricesIncludeVat,
      };
      setOrg(next);
    } catch (err) {
      setError(err.message || "Не удалось загрузить организацию");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function payload(extra = {}) {
    return {
      legalName: org.legalName,
      shortName: org.shortName,
      bin: org.bin,
      countryCode: org.countryCode,
      region: org.region,
      city: org.city,
      legalAddress: org.legalAddress,
      phone: org.phone,
      email: org.email,
      website: org.website,
      bank: org.bank,
      tax: {
        regime: org.tax.regime,
        vatRegistered: org.tax.vatRegistered,
        defaultVatRate: org.tax.defaultVatRate,
        defaultVatTreatment: org.tax.defaultVatTreatment,
        vatRegistrationDate: org.tax.vatRegistrationDate,
        vatRegistrationStatus: org.tax.vatRegistrationStatus,
        pricesIncludeVat: org.tax.pricesIncludeVat,
      },
      ...extra,
    };
  }

  async function onSave(event) {
    event.preventDefault();
    if (!org || pending) return;
    const baseline = taxBaseline.current;
    const taxChanged = baseline && org.tax.catalogPricesConfirmed && (baseline.rate !== org.tax.defaultVatRate || baseline.mode !== org.tax.pricesIncludeVat);
    if (taxChanged && !window.confirm("Изменение применяется только к новым заказам. Уже созданные заказы не будут пересчитаны.")) return;
    setPending(true);
    setError("");
    try {
      const saved = await saveOrganization(payload(), "");
      taxBaseline.current = { rate: saved.tax.defaultVatRate, mode: saved.tax.pricesIncludeVat };
      setOrg(saved);
    } catch (err) {
      setError(err.message || "Не удалось сохранить организацию");
    } finally {
      setPending(false);
    }
  }

  async function onConfirmPrices() {
    if (!org || pending) return;
    if (org.tax.pricesIncludeVat !== true && org.tax.pricesIncludeVat !== false) {
      setError("Выберите, включают ли текущие цены НДС.");
      return;
    }
    const confirmed = window.confirm(
      "Изменение применяется только к новым заказам. Уже созданные заказы не будут пересчитаны. Текущие цены товаров не изменятся."
    );
    if (!confirmed) return;
    setPending(true);
    setError("");
    try {
      const saved = await saveOrganization(payload({ confirmCatalogPrices: true }), "");
      taxBaseline.current = { rate: saved.tax.defaultVatRate, mode: saved.tax.pricesIncludeVat };
      setOrg(saved);
    } catch (err) {
      setError(err.message || "Не удалось зафиксировать смысл цен");
    } finally {
      setPending(false);
    }
  }

  async function onProduction() {
    if (!org || pending || !org.isDemo) return;
    const confirmed = window.confirm("После перевода в рабочий режим реквизиты будут использоваться в документах как рабочие.");
    if (!confirmed) return;
    setPending(true);
    setError("");
    try {
      setOrg(await saveOrganization(payload({ isDemo: false, confirmProduction: true }), ""));
    } catch (err) {
      setError(err.message || "Не удалось перевести организацию в рабочий режим");
    } finally {
      setPending(false);
    }
  }

  function setField(key, value) {
    setOrg((current) => ({ ...current, [key]: value }));
  }

  function setBank(key, value) {
    setOrg((current) => ({ ...current, bank: { ...current.bank, [key]: value } }));
  }

  function setTax(key, value) {
    setOrg((current) => ({ ...current, tax: { ...current.tax, [key]: value } }));
  }

  if (!org) {
    return (
      <div className="dash-panel">
        <p className="empty">{error || "Загрузка организации..."}</p>
      </div>
    );
  }

  return (
    <form className="dash-panel card form" onSubmit={onSave}>
      <h2>Настройки · Организация</h2>
      {org.missing ? (
        <p className="org-demo">Организация не настроена. Заполните реквизиты и сохраните.</p>
      ) : org.isDemo ? (
        <p className="org-demo">Тестовый профиль. Реквизиты используются только для тестовых документов.</p>
      ) : (
        <p className="field-hint">Рабочий режим. Документы выпускаются без тестовой пометки.</p>
      )}
      <h3>Основные сведения</h3>
      <label>
        Полное наименование
        <input value={org.legalName} required onChange={(event) => setField("legalName", event.target.value)} />
      </label>
      <label>
        Краткое наименование
        <input value={org.shortName || ""} onChange={(event) => setField("shortName", event.target.value)} />
      </label>
      <label>
        БИН
        <input value={org.bin} required onChange={(event) => setField("bin", event.target.value)} />
      </label>
      <label>
        Страна
        <input value={org.countryCode} required maxLength={2} onChange={(event) => setField("countryCode", event.target.value)} />
      </label>
      <p className="field-hint">Код страны, для Казахстана — KZ.</p>
      <label>
        Область
        <input value={org.region || ""} onChange={(event) => setField("region", event.target.value)} />
      </label>
      <label>
        Город
        <input value={org.city || ""} onChange={(event) => setField("city", event.target.value)} />
      </label>
      <label>
        Юридический адрес
        <input value={org.legalAddress} required onChange={(event) => setField("legalAddress", event.target.value)} />
      </label>
      <h3>Контакты</h3>
      <label>
        Телефон
        <input value={org.phone || ""} onChange={(event) => setField("phone", event.target.value)} />
      </label>
      <label>
        Email
        <input value={org.email || ""} onChange={(event) => setField("email", event.target.value)} />
      </label>
      <label>
        Сайт
        <input value={org.website || ""} onChange={(event) => setField("website", event.target.value)} />
      </label>
      <h3>Банковские реквизиты</h3>
      <label>
        Банк
        <input value={org.bank.name || ""} onChange={(event) => setBank("name", event.target.value)} />
      </label>
      <label>
        ИИК / IBAN
        <input value={org.bank.iban || ""} onChange={(event) => setBank("iban", event.target.value)} />
      </label>
      <label>
        БИК
        <input value={org.bank.bic || ""} onChange={(event) => setBank("bic", event.target.value)} />
      </label>
      <label>
        КБе
        <input value={org.bank.kbe || ""} onChange={(event) => setBank("kbe", event.target.value)} />
      </label>
      <label>
        Валюта
        <input value={org.bank.currency || ""} maxLength={3} onChange={(event) => setBank("currency", event.target.value)} />
      </label>
      <h3>Налоги</h3>
      <label>
        Налоговый режим
        <select value={org.tax.regime} onChange={(event) => setTax("regime", event.target.value)}>
          <option value="GENERAL">GENERAL</option>
          <option value="SIMPLIFIED">SIMPLIFIED</option>
          <option value="OTHER">OTHER</option>
        </select>
      </label>
      <label>
        Плательщик НДС
        <select
          value={org.tax.vatRegistered ? "yes" : "no"}
          onChange={(event) => setTax("vatRegistered", event.target.value === "yes")}
        >
          <option value="yes">Да</option>
          <option value="no">Нет</option>
        </select>
      </label>
      <label>
        Ставка НДС по умолчанию
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={org.tax.defaultVatRate ?? ""}
          onChange={(event) => setTax("defaultVatRate", event.target.value === "" ? null : Number(event.target.value))}
        />
      </label>
      <p className="field-hint">Ставка хранится в настройках. На уже созданные заказы она не пересчитывается.</p>
      <h3>Цены в каталоге</h3>
      <label>
        <input
          type="radio"
          name="priceMode"
          checked={org.tax.pricesIncludeVat === true}
          onChange={() => setTax("pricesIncludeVat", true)}
        />{" "}
        Цена включает НДС
      </label>
      <label>
        <input
          type="radio"
          name="priceMode"
          checked={org.tax.pricesIncludeVat === false}
          onChange={() => setTax("pricesIncludeVat", false)}
        />{" "}
        Цена указана без НДС
      </label>
      <p className="field-hint">
        {org.tax.pricesIncludeVat === true
          ? "Указанная цена окончательная. НДС выделяется из неё для новых заказов."
          : org.tax.pricesIncludeVat === false
            ? "К указанной цене НДС добавляется сверху для новых заказов."
            : "Смысл текущих цен ещё не зафиксирован. Старые заказы не получат НДС задним числом."}
      </p>
      <p className="field-hint">
        {org.tax.catalogPricesConfirmed
          ? "Смысл цен зафиксирован. Новые заказы получают снимок НДС."
          : "Пока выбор не зафиксирован, новые заказы сохраняются без налогового снимка."}
      </p>
      <label>
        Налоговый режим оборота
        <select value={org.tax.defaultVatTreatment} onChange={(event) => setTax("defaultVatTreatment", event.target.value)}>
          <option value="STANDARD">STANDARD</option>
          <option value="REDUCED">REDUCED</option>
          <option value="ZERO">ZERO</option>
          <option value="EXEMPT">EXEMPT</option>
          <option value="CUSTOM">CUSTOM</option>
        </select>
      </label>
      <label>
        Дата регистрации по НДС
        <input
          type="date"
          value={org.tax.vatRegistrationDate || ""}
          onChange={(event) => setTax("vatRegistrationDate", event.target.value || null)}
        />
      </label>
      {error ? <p className="login__error">{error}</p> : null}
      <div className="order-card__actions">
        <button className="btn btn--primary" type="submit" disabled={pending}>
          {pending ? "Сохранение..." : "Сохранить"}
        </button>
        <button className="btn btn--ghost" type="button" disabled={pending} onClick={onConfirmPrices}>
          {org.tax.catalogPricesConfirmed ? "Обновить смысл цен" : "Зафиксировать смысл текущих цен"}
        </button>
        {org.isDemo ? (
          <button className="btn btn--ghost" type="button" disabled={pending} onClick={onProduction}>
            Перевести организацию в рабочий режим
          </button>
        ) : null}
      </div>
    </form>
  );
}

function OrdersPanel({ orders, meta, hasMore, onMore, onRefresh }) {
  const [pendingId, setPendingId] = useState("");
  const orderPdfBusyRef = useRef(new Set());
  const invoicePdfBusyRef = useRef(new Set());
  const [orderPdfBusy, setOrderPdfBusy] = useState(() => new Set());
  const [invoicePdfBusy, setInvoicePdfBusy] = useState(() => new Set());

  async function onOrderPdf(orderId) {
    if (orderPdfBusyRef.current.has(orderId)) return;
    orderPdfBusyRef.current.add(orderId);
    setOrderPdfBusy(new Set(orderPdfBusyRef.current));
    try {
      const result = await downloadOrderPdf(orderId, "");
      if (!result.ok) window.alert("Не удалось сформировать PDF-заявку.");
    } catch {
      window.alert("Не удалось сформировать PDF-заявку.");
    } finally {
      orderPdfBusyRef.current.delete(orderId);
      setOrderPdfBusy(new Set(orderPdfBusyRef.current));
    }
  }

  async function onInvoicePdf(orderId) {
    if (invoicePdfBusyRef.current.has(orderId)) return;
    invoicePdfBusyRef.current.add(orderId);
    setInvoicePdfBusy(new Set(invoicePdfBusyRef.current));
    try {
      const result = await downloadInvoicePdf(orderId, "");
      if (!result.ok) window.alert("Не удалось сформировать счёт.");
    } catch {
      window.alert("Не удалось сформировать счёт.");
    } finally {
      invoicePdfBusyRef.current.delete(orderId);
      setInvoicePdfBusy(new Set(invoicePdfBusyRef.current));
    }
  }

  async function changeStatus(id, status) {
    setPendingId(id + status);
    try {
      await updateOrderStatus(id, status, "");
      await onRefresh();
    } catch (err) {
      window.alert(err.message || "Не удалось обновить статус");
    } finally {
      setPendingId("");
    }
  }

  return (
    <div className="dash-panel">
      <div className="orders-head">
        <div>
          <h2>CRM · Заказы</h2>
          <p className="field-hint">Заявки с сайта сохраняются при переходе клиента в WhatsApp / Telegram.</p>
        </div>
        <button className="btn btn--ghost" type="button" onClick={onRefresh}>
          Обновить
        </button>
      </div>
      <p className="orders-meta">{meta}</p>
      <div className="orders-list">
        {orders.length === 0 ? (
          <p className="empty">Пока нет заказов. Они появятся, когда клиент оформит заявку на сайте.</p>
        ) : (
          orders.map((order) => {
            const status = order.status || "new";
            const channel = order.channel === "telegram" ? "telegram" : "whatsapp";
            const channelLabel = channel === "telegram" ? "Telegram" : "WhatsApp";
            const items = Array.isArray(order.items) ? order.items : [];
            const phoneHref = `tel:${String(order.phone || "").replace(/\s/g, "")}`;
            const waUrl = buildClientWhatsappUrl(order);
            return (
              <article className="order-card" key={order.id}>
                <div className="order-card__top">
                  <div>
                    <p className="order-card__id">{order.id}</p>
                    <p className="order-card__meta">
                      {formatOrderDate(order.createdAt)} · через {channelLabel}
                    </p>
                  </div>
                  <span className={`order-card__status order-card__status--${status}`}>{statusLabel(status)}</span>
                </div>
                <div className="order-card__client">
                  <p className="order-card__client-label">Клиент</p>
                  <div className="order-card__client-row">
                    <div className="order-card__client-main">
                      <p className="order-card__client-name">{order.name || "—"}</p>
                      <a className="order-card__client-phone" href={phoneHref}>
                        {order.phone || "—"}
                      </a>
                    </div>
                    {waUrl ? (
                      <a className="order-card__wa" href={waUrl} target="_blank" rel="noopener">
                        Написать в WhatsApp
                      </a>
                    ) : null}
                  </div>
                </div>
                <ul className="order-card__items">
                  {items.map((item, index) => (
                    <li key={`${order.id}-${index}`}>
                      <span>{item.name}</span>
                      <span>
                        {item.qty} {item.unit || "шт"} · {item.lineTotal || item.price || ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {order.taxDataStatus === "SNAPSHOT" ? (
                  <div className="order-card__tax">
                    {order.pricesIncludeVat ? null : (
                      <p>
                        <span>Стоимость без НДС</span> {order.subtotalWithoutVatText}
                      </p>
                    )}
                    {(order.taxLines || []).map((line) => (
                      <p key={`${order.id}-${line.caption}`}>
                        <span>{order.pricesIncludeVat ? `в том числе ${line.caption}` : line.caption}</span> {line.vatText}
                      </p>
                    ))}
                  </div>
                ) : null}
                <p className="order-card__total">
                  <span>Итого</span> {order.total || "—"}
                </p>
                {order.comment ? <p className="order-card__comment">{order.comment}</p> : null}
                <div className="order-card__actions">
                  <p className="order-card__docs-label">Документы</p>
                  <div className="order-card__docs">
                    <button
                      className="btn btn--ghost"
                      type="button"
                      disabled={orderPdfBusy.has(order.id)}
                      onClick={() => onOrderPdf(order.id)}
                    >
                      {orderPdfBusy.has(order.id) ? "Формирование заявки..." : "Скачать заявку"}
                    </button>
                    <button
                      className="btn btn--ghost"
                      type="button"
                      disabled={invoicePdfBusy.has(order.id)}
                      onClick={() => onInvoicePdf(order.id)}
                    >
                      {invoicePdfBusy.has(order.id) ? "Формирование счёта..." : "Скачать счёт"}
                    </button>
                  </div>
                  <p className="field-hint">Счёт-фактура по этой заявке не выписывается: нет БИН и адреса покупателя.</p>
                  <div className="order-card__status-actions">
                    {status !== "done" ? (
                      <button
                        className="btn btn--primary"
                        type="button"
                        disabled={pendingId === order.id + "done"}
                        onClick={() => changeStatus(order.id, "done")}
                      >
                        Готово
                      </button>
                    ) : null}
                    {status !== "new" ? (
                      <button
                        className="btn btn--ghost"
                        type="button"
                        disabled={pendingId === order.id + "new"}
                        onClick={() => changeStatus(order.id, "new")}
                      >
                        Вернуть в новые
                      </button>
                    ) : null}
                    {status !== "cancelled" ? (
                      <button
                        className="btn btn--danger"
                        type="button"
                        disabled={pendingId === order.id + "cancelled"}
                        onClick={() => changeStatus(order.id, "cancelled")}
                      >
                        Отменить
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
      {hasMore ? (
        <div className="orders-head">
          <button className="btn btn--ghost" type="button" onClick={onMore}>
            Показать ещё
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ClientsPanel({ clients, meta, onRefresh }) {
  return (
    <div className="dash-panel">
      <div className="orders-head">
        <div>
          <h2>CRM · Клиенты</h2>
          <p className="field-hint">Клиенты собираются автоматически из заявок. Один номер = один клиент.</p>
        </div>
        <button className="btn btn--ghost" type="button" onClick={onRefresh}>
          Обновить
        </button>
      </div>
      <p className="orders-meta">{meta}</p>
      <div className="clients-list">
        {clients.length === 0 ? (
          <p className="empty">Пока нет клиентов. Они появятся после первых заявок с сайта.</p>
        ) : (
          clients.map((client) => {
            const waUrl = buildClientWhatsappUrl(client.lastOrder || client);
            const phoneHref = `tel:${String(client.phone || "").replace(/\s/g, "")}`;
            return (
              <article className="client-card" key={`${client.phoneKey}|${client.name}`}>
                <div className="client-card__main">
                  <p className="client-card__label">Клиент</p>
                  <p className="client-card__name">{client.name}</p>
                  <a className="client-card__phone" href={phoneHref}>
                    {client.phone || "—"}
                  </a>
                  <p className="client-card__meta">
                    {client.ordersCount} {ordersWord(client.ordersCount)}
                    {client.lastAt ? ` · последний ${formatOrderDate(client.lastAt)}` : ""}
                    {client.lastTotal ? ` · ${client.lastTotal}` : ""}
                  </p>
                </div>
                {waUrl ? (
                  <a className="order-card__wa" href={waUrl} target="_blank" rel="noopener">
                    Написать в WhatsApp
                  </a>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
