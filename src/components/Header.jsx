import { useEffect, useState } from "react";
import { formatWaLabel } from "../lib/contacts.js";
import { cartCount } from "../lib/store.js";
import { MailIcon, TelegramIcon, WhatsAppIcon } from "./Icons.jsx";

function positionsWord(count) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "позиций";
  if (n1 === 1) return "позиция";
  if (n1 >= 2 && n1 <= 4) return "позиции";
  return "позиций";
}

export default function Header({ contacts, cart, cartOpen, onCartOpen, contactOpen, onContactOpen, onContactClose }) {
  const count = cartCount(cart);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (contactOpen) {
      setShown(true);
      return undefined;
    }
    const timer = setTimeout(() => setShown(false), 320);
    return () => clearTimeout(timer);
  }, [contactOpen]);

  useEffect(() => {
    if (!contactOpen) return undefined;
    const onClick = (e) => {
      if (e.target.closest(".bar__contact")) return;
      onContactClose();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [contactOpen, onContactClose]);

  return (
    <header className="bar">
      <a className="bar__name" href="#top">
        <img className="bar__logo" src="/logo.png" alt="" width="44" height="44" />
        Барыс
      </a>
      <p className="bar__status">
        <span className="dot"></span> на производстве
      </p>
      <nav className="bar__nav">
        <a href="#work">работа</a>
        <a href="#products">товары</a>
        <div className="bar__contact">
          <button
            type="button"
            className="bar__nav-btn"
            aria-haspopup="true"
            aria-expanded={contactOpen}
            aria-controls="contactPop"
            onClick={(e) => {
              e.stopPropagation();
              onContactOpen();
            }}
          >
            связь
          </button>
          <div
            className={`contact-pop${contactOpen ? " is-open" : ""}`}
            id="contactPop"
            role="dialog"
            aria-label="Контакты"
            hidden={!shown && !contactOpen}
          >
            <p className="contact-pop__title">Написать Барысу</p>
            {contacts && contacts.whatsappUrl && contacts.telegramUrl && contacts.email ? (
              <>
                <a
                  className="contact-pop__link contact-pop__link--wa"
                  href={contacts.whatsappUrl}
                  target="_blank"
                  rel="noopener"
                >
                  <span className="contact-pop__icon" aria-hidden="true">
                    <WhatsAppIcon />
                  </span>
                  <span className="contact-pop__text">
                    <span className="contact-pop__kind">WhatsApp</span>
                    <strong>{formatWaLabel(contacts.whatsapp)}</strong>
                  </span>
                </a>
                <a
                  className="contact-pop__link contact-pop__link--tg"
                  href={contacts.telegramUrl}
                  target="_blank"
                  rel="noopener"
                >
                  <span className="contact-pop__icon" aria-hidden="true">
                    <TelegramIcon />
                  </span>
                  <span className="contact-pop__text">
                    <span className="contact-pop__kind">Telegram</span>
                    <strong>@{contacts.telegram}</strong>
                  </span>
                </a>
                <a className="contact-pop__link contact-pop__link--mail" href={`mailto:${contacts.email}`}>
                  <span className="contact-pop__icon" aria-hidden="true">
                    <MailIcon />
                  </span>
                  <span className="contact-pop__text">
                    <span className="contact-pop__kind">Почта</span>
                    <strong>{contacts.email}</strong>
                  </span>
                </a>
              </>
            ) : (
              <p className="contact-pop__text">Контакты недоступны</p>
            )}
          </div>
        </div>
        <button
          type="button"
          className="bar__cart"
          aria-expanded={cartOpen}
          aria-controls="cartDrawer"
          aria-label={count ? `Корзина, ${count} ${positionsWord(count)}` : "Корзина"}
          onClick={onCartOpen}
        >
          Корзина
          {count > 0 ? <span className="bar__cart-count">{count}</span> : null}
        </button>
      </nav>
    </header>
  );
}
