import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import siteCss from "../../styles.css?inline";
import BarysChat from "../components/BarysChat.jsx";
import CartDrawer from "../components/CartDrawer.jsx";
import Header from "../components/Header.jsx";
import OrderModal from "../components/OrderModal.jsx";
import { useSiteMotion } from "../components/useSiteMotion.js";
import { useContacts } from "../hooks/useContacts.js";
import { usePageCss } from "../hooks/usePageCss.js";
import { useStore } from "../hooks/useStore.js";
import { formatWaLabel } from "../lib/contacts.js";
import { mediaSrc } from "../lib/media.js";
import { openMessenger } from "../lib/orderMessage.js";
import {
  addToCart,
  formatPrice,
  getCart,
  getCartLines,
  getCartTotalFormatted,
  persistOrderToServer,
  downloadCatalogPdf,
  retryCatalog,
  getTaxProfile,
  buildOrder,
  commitOrder,
  forgetPendingOrder,
  quoteCart,
  setCurrency,
} from "../lib/store.js";

const CURRENCIES = [
  { id: "kzt", label: "₸ теңге" },
  { id: "usd", label: "$ доллар" },
  { id: "rub", label: "₽ рубль" },
];

function cartButtonLabel(qty) {
  if (!qty) return "В корзину";
  return qty > 1 ? `В корзине · ${qty}` : "В корзине";
}

export default function HomePage() {
  usePageCss(siteCss);
  const snap = useStore();
  const { contacts, error: contactsError, retry: retryContacts } = useContacts();
  const [cartOpen, setCartOpen] = useState(false);
  const [taxQuote, setTaxQuote] = useState(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [success, setSuccess] = useState(null);
  const [catalogPdfBusy, setCatalogPdfBusy] = useState(false);

  useSiteMotion();

  useEffect(() => {
    document.title = "Барыс";
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (orderOpen) {
        setOrderOpen(false);
        return;
      }
      if (cartOpen) {
        setCartOpen(false);
        return;
      }
      if (document.querySelector(".barys__panel.is-open")) return;
      setContactOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orderOpen, cartOpen]);

  const qtyById = Object.create(null);
  snap.cart.forEach((item) => {
    qtyById[item.id] = Math.max(1, Number(item.qty) || 1);
  });
  const lines = success ? [] : getCartLines(snap.currency);
  const payableKzt = taxQuote && taxQuote.grandTotalText ? taxQuote.grandTotalText : getCartTotalFormatted("kzt");
  const total = snap.currency === "kzt" ? payableKzt : getCartTotalFormatted(snap.currency);
  const taxProfile = getTaxProfile();
  const year = new Date().getFullYear();

  useEffect(() => {
    const profile = getTaxProfile();
    if (!profile.catalogPricesConfirmed) {
      setTaxQuote(null);
      return undefined;
    }
    const items = getCart()
      .map((item) => ({ id: item.id, qty: Math.max(1, Math.min(999, Math.floor(Number(item.qty) || 1))) }))
      .filter((item) => item.qty > 0);
    if (!items.length) {
      setTaxQuote(null);
      return undefined;
    }
    let cancelled = false;
    quoteCart(items).then((quote) => {
      if (!cancelled) setTaxQuote(quote);
    });
    return () => {
      cancelled = true;
    };
  }, [snap.cart, snap.currency, snap.products]);

  async function onCatalogPdf() {
    if (catalogPdfBusy) return;
    setCatalogPdfBusy(true);
    try {
      const result = await downloadCatalogPdf();
      if (!result.ok) window.alert("Не удалось сформировать PDF-каталог.");
    } catch {
      window.alert("Не удалось сформировать PDF-каталог.");
    } finally {
      setCatalogPdfBusy(false);
    }
  }

  async function submitOrder(payload) {
    let quote = taxQuote;
    const profile = getTaxProfile();
    if (profile.catalogPricesConfirmed) {
      const items = getCart()
        .map((item) => ({ id: item.id, qty: Math.max(1, Math.min(999, Math.floor(Number(item.qty) || 1))) }))
        .filter((item) => item.qty > 0);
      quote = items.length ? await quoteCart(items) : null;
    }
    const draft = buildOrder(payload, quote);
    if (!draft) return { ok: false, error: "Корзина пуста или данные неверны" };
    const persist = await persistOrderToServer(draft);
    if (!persist || !persist.ok) {
      if (persist && persist.status === 409) forgetPendingOrder();
      return {
        ok: false,
        error:
          persist && persist.status === 409
            ? "Не удалось закрепить номер заявки. Нажмите ещё раз."
            : "Заявка не сохранена. Корзина на месте, попробуйте ещё раз.",
      };
    }
    const official =
      persist.order && Array.isArray(persist.order.items) && persist.order.items.length
        ? persist.order
        : draft;
    commitOrder(official);
    try {
      openMessenger(official, contacts);
    } catch {
      /* заявка уже сохранена */
    }
    setSuccess({ order: official, crmOk: true });
    setOrderOpen(false);
    setCartOpen(true);
    return { ok: true };
  }

  return (
    <>
      {contactsError ? (
        <div className="status-overlay" role="alert">
          <p>Не удалось загрузить контакты. {contactsError}</p>
          <button type="button" onClick={retryContacts}>
            Повторить попытку
          </button>
        </div>
      ) : null}
      <div className="progress" aria-hidden="true">
        <i></i>
      </div>
      <Header
        contacts={contacts || {}}
        cart={snap.cart}
        cartOpen={cartOpen}
        onCartOpen={() => setCartOpen(true)}
        contactOpen={contactOpen}
        onContactOpen={() => setContactOpen((v) => !v)}
        onContactClose={() => setContactOpen(false)}
      />
      <CartDrawer
        open={cartOpen}
        lines={lines}
        total={total}
        catalogTotal={snap.currency === "kzt" ? "" : payableKzt}
        taxQuote={snap.currency === "kzt" ? taxQuote : null}
        success={success}
        contacts={contacts || {}}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          if (!getCartLines(snap.currency).length) return;
          setOrderOpen(true);
        }}
        onContinue={() => {
          setSuccess(null);
          setCartOpen(false);
        }}
      />
      <OrderModal open={orderOpen} onClose={() => setOrderOpen(false)} onSubmit={submitOrder} />

      <main id="top">
        <section className="hero">
          <div className="hero__media" data-parallax>
            <img src="/manufacture_01.jpg" alt="ЖБИ завод: площадка с изделиями и кранами" width="1600" height="1200" />
          </div>
          <div className="hero__veil" aria-hidden="true"></div>
          <div className="hero__copy">
            <p className="hero__tag">15 · строительство · ЖБИ</p>
            <h1 className="hero__name" aria-label="Барыс">
              <span>Б</span>
              <span>а</span>
              <span>р</span>
              <span>ы</span>
              <span>с</span>
            </h1>
          </div>
        </section>

        <div className="marquee" aria-hidden="true">
          <div className="marquee__track">
            <span>железобетон любой сложности</span>
            <span>рост производства</span>
            <span>цех · люди · качество</span>
            <span>ЖБИ завод</span>
            <span>железобетон любой сложности</span>
            <span>рост производства</span>
            <span>цех · люди · качество</span>
            <span>ЖБИ завод</span>
          </div>
        </div>

        <section className="work" id="work">
          <div className="work__grid">
            <div className="work__intro">
              <h2>Дело</h2>
              <p>
                Руковожу производством железобетонных изделий. Задача простая и жёсткая: поднимать завод — ритм, технологии,
                объём и результат, на который опирается стройка.
              </p>
            </div>
            <ul className="work__points">
              <li data-stagger>
                <strong>Роль</strong>
                <span>Директор по производству</span>
              </li>
              <li data-stagger>
                <strong>Завод</strong>
                <span>Железобетонные изделия</span>
              </li>
              <li data-stagger>
                <strong>Фокус</strong>
                <span>Сложные конструкции · рост выпуска</span>
              </li>
            </ul>
            <figure className="work__shot">
              <img src="/manufacture_01.jpg" alt="ЖБИ завод: площадка с изделиями и кранами" width="1600" height="1200" />
              <figcaption>ЖБИ завод</figcaption>
            </figure>
          </div>
        </section>

        <section className="products" id="products">
          <div className="products__head">
            <p className="products__eyebrow">Каталог</p>
            <h2 className="products__title">Товары</h2>
            <p className="products__lead">Железобетонные изделия с производства. Список обновляется из админки.</p>
            <button type="button" className="products__pdf" disabled={catalogPdfBusy} onClick={onCatalogPdf}>
              {catalogPdfBusy ? "Формирование PDF..." : "Скачать каталог PDF"}
            </button>
            <div className="currency" role="group" aria-label="Валюта">
              {CURRENCIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`currency__btn${snap.currency === item.id ? " is-active" : ""}`}
                  onClick={() => setCurrency(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="products__grid">
            {snap.catalogStatus === "error" ? (
              <div className="products__empty" role="alert">
                <p>Не удалось загрузить каталог. {snap.catalogError}</p>
                <button type="button" className="products__retry" onClick={() => retryCatalog().catch((err) => console.error(err))}>
                  Повторить попытку
                </button>
              </div>
            ) : snap.catalogStatus === "loading" ? (
              <p className="products__empty">Загрузка каталога…</p>
            ) : snap.products.length === 0 ? (
              <p className="products__empty">
                Товаров пока нет. Добавьте их в <Link to="/admin">админке</Link>.
              </p>
            ) : (
              snap.products.map((product, index) => {
                const qty = qtyById[product.id] || 0;
                return (
                  <article
                    className="product reveal"
                    key={product.id}
                    style={{ transitionDelay: `${Math.min(index, 5) * 0.07}s` }}
                  >
                    <div className="product__media">
                      <img src={mediaSrc(product.image)} alt={product.name} loading="lazy" />
                    </div>
                    <div className="product__body">
                      <h3>{product.name}</h3>
                      <p>{product.description || ""}</p>
                      <p className="product__price">
                        {formatPrice(product.price, snap.currency)} <span>/ {product.unit || "шт"}</span>
                        {taxProfile.catalogPricesConfirmed && taxProfile.pricesIncludeVat && snap.currency === "kzt" ? (
                          <span className="product__tax"> Цена с НДС</span>
                        ) : null}
                      </p>
                      <button
                        type="button"
                        className={`product__cart${qty ? " is-added" : ""}`}
                        aria-pressed={qty > 0}
                        onClick={() => addToCart(product.id, 1)}
                      >
                        {cartButtonLabel(qty)}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="contact" id="contact">
          <p className="contact__label">Связь</p>
          {contacts ? (
            <>
              <a className="contact__mail" href={`mailto:${contacts.email}`}>
                {contacts.email}
              </a>
              <a className="contact__phone" href={contacts.whatsappUrl} target="_blank" rel="noopener">
                WhatsApp · {formatWaLabel(contacts.whatsapp)}
              </a>
              <a className="contact__phone" href={contacts.telegramUrl} target="_blank" rel="noopener">
                Telegram · @{contacts.telegram}
              </a>
            </>
          ) : (
            <p className="contact__note">{contactsError || "Контакты загружаются."}</p>
          )}
          <p className="contact__note">По производству и сотрудничеству — пишите напрямую.</p>
        </section>
      </main>

      <footer className="foot">
        <p>
          Барыс · <span>{year}</span> · <Link to="/admin">Админка</Link>
        </p>
      </footer>

      <BarysChat
        products={snap.products}
        currency={snap.currency}
        contacts={contacts || {}}
        pricesIncludeVat={taxProfile.catalogPricesConfirmed === true && taxProfile.pricesIncludeVat === true}
      />
    </>
  );
}
