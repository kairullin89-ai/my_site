import { useEffect, useState } from "react";
import { buildMessengerUrl, buildOrderMessage } from "../lib/orderMessage.js";
import { removeFromCart, setCartQty } from "../lib/store.js";
import { mediaSrc } from "../lib/media.js";

export default function CartDrawer({ open, lines, total, catalogTotal, taxQuote, success, contacts, onClose, onCheckout, onContinue }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("cart-open", open);
    return () => document.body.classList.remove("cart-open");
  }, [open]);

  useEffect(() => {
    setCopied(false);
  }, [success]);

  const channelLabel = success?.order?.channel === "telegram" ? "Telegram" : "WhatsApp";
  const messengerUrl = success ? buildMessengerUrl(success.order, contacts) : "#";
  const crmLine = success?.crmOk
    ? "Заявка сохранена в CRM."
    : "Заявка сохранена локально — CRM сейчас недоступен, заказ всё равно уйдёт в мессенджер.";

  async function copyOrder() {
    if (!success) return;
    try {
      await navigator.clipboard.writeText(buildOrderMessage(success.order));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div
        className={`cart-backdrop${open ? " is-open" : ""}`}
        style={{ pointerEvents: open ? "auto" : "none" }}
        onClick={onClose}
      ></div>
      <aside
        className={`cart${open ? " is-open" : ""}`}
        id="cartDrawer"
        aria-hidden={!open}
        inert={!open}
        aria-labelledby="cartTitle"
      >
        <div className="cart__head">
          <h2 id="cartTitle">Корзина</h2>
          <button type="button" className="cart__close" aria-label="Закрыть корзину" onClick={onClose}>
            ✕
          </button>
        </div>

        {success ? (
          <div className="cart__checkout">
            <div className="cart__total">
              <span>Итого</span>
              <strong>{success.order.total}</strong>
            </div>
            <div className="cart__success">
              <p>
                Заказ <strong>{success.order.id}</strong>. Сумма: <strong>{success.order.total}</strong>. {crmLine}{" "}
                {success.order.channel === "telegram"
                  ? "Текст скопирован — вставьте его в чат с Барысом в Telegram."
                  : `Откроется ${channelLabel} с составом заказа.`}
              </p>
              <div className="cart__success-links">
                {messengerUrl ? (
                  <a className="cart__mail" href={messengerUrl} target="_blank" rel="noopener">
                    Открыть {channelLabel}
                  </a>
                ) : (
                  <p>Контакты не настроены. Заявка сохранена, мессенджер не открыт.</p>
                )}
                {success.order.channel === "telegram" ? (
                  <button type="button" className="cart__copy-order" onClick={copyOrder}>
                    {copied ? "Скопировано" : "Скопировать текст заказа"}
                  </button>
                ) : null}
              </div>
              <button type="button" className="cart__close-success" onClick={onContinue}>
                Продолжить
              </button>
            </div>
          </div>
        ) : lines.length === 0 ? (
          <p className="cart__empty">Пока пусто. Добавьте товары из каталога.</p>
        ) : (
          <>
            <div className="cart__items">
              {lines.map((line) => (
                <article className="cart-item" key={line.id}>
                  <div className="cart-item__media">
                    <img src={mediaSrc(line.image)} alt="" loading="lazy" />
                  </div>
                  <div className="cart-item__body">
                    <h3 className="cart-item__name">{line.name}</h3>
                    <p className="cart-item__price">
                      {line.unitFormatted} <span>/ {line.unit}</span>
                    </p>
                    <div className="cart-item__row">
                      <div className="cart-qty" role="group" aria-label="Количество">
                        <button type="button" aria-label="Меньше" onClick={() => setCartQty(line.id, line.qty - 1)}>
                          −
                        </button>
                        <input
                          type="number"
                          min="1"
                          max="999"
                          step="1"
                          value={line.qty}
                          aria-label={`Количество ${line.name}`}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (raw === "") return;
                            setCartQty(line.id, raw);
                          }}
                        />
                        <button type="button" aria-label="Больше" onClick={() => setCartQty(line.id, line.qty + 1)}>
                          +
                        </button>
                      </div>
                      <p className="cart-item__sum">{line.lineFormatted}</p>
                      <button
                        type="button"
                        className="cart-item__remove"
                        aria-label="Удалить"
                        onClick={() => removeFromCart(line.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="cart__checkout">
              {taxQuote && (taxQuote.taxLines || []).some((line) => line.treatment !== "NOT_APPLICABLE") ? (
                <div className="cart__tax">
                  {taxQuote.pricesIncludeVat ? null : (
                    <p>
                      <span>Стоимость без НДС</span>
                      <strong>{taxQuote.subtotalWithoutVatText}</strong>
                    </p>
                  )}
                  {(taxQuote.taxLines || []).filter((line) => line.treatment !== "NOT_APPLICABLE").map((line) => (
                    <p key={line.caption}>
                      <span>{taxQuote.pricesIncludeVat ? `в том числе ${line.caption}` : line.caption}</span>
                      <strong>{line.vatText}</strong>
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="cart__total">
                <span>{catalogTotal ? "Ориентир" : "Итого"}</span>
                <strong>{total}</strong>
              </div>
              {catalogTotal ? <p className="cart__note">Заявка сохранится в тенге: {catalogTotal}</p> : null}
              <button type="button" className="cart__submit" onClick={onCheckout}>
                Оформить заказ
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
