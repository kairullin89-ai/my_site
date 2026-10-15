import { useEffect, useRef, useState } from "react";
import { isValidPhone } from "../lib/store.js";

export default function OrderModal({ open, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const channelRef = useRef("whatsapp");

  useEffect(() => {
    document.body.classList.toggle("order-modal-open", open);
    return () => document.body.classList.remove("order-modal-open");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setName("");
    setPhone("");
    setComment("");
    setError("");
    const timer = setTimeout(() => {
      document.getElementById("orderName")?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    const channel = channelRef.current === "telegram" ? "telegram" : "whatsapp";
    if (submittingRef.current) return;
    if (!name.trim() || !phone.trim()) {
      setError("Укажите имя и телефон");
      return;
    }
    if (!isValidPhone(phone)) {
      setError("Укажите номер в формате +7 XXX XXX XX XX");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = await onSubmit({
        name: name.trim(),
        phone: phone.trim(),
        comment: comment.trim(),
        channel,
      });
      if (!result?.ok) {
        setError(result?.error || "Корзина пуста или данные неверны");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="order-modal is-open" aria-hidden="false">
      <div className="order-modal__backdrop" onClick={onClose}></div>
      <div className="order-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="orderModalTitle">
        <button type="button" className="order-modal__close" aria-label="Закрыть" onClick={onClose}>
          ✕
        </button>
        <p className="order-modal__eyebrow">Заявка</p>
        <h2 id="orderModalTitle">Оформление заказа</h2>
        <p className="order-modal__lead">Оставьте контакты — заявка уйдёт в CRM и откроется мессенджер.</p>
        <form className="order-modal__form" onSubmit={submit}>
          <label>
            Имя
            <input
              type="text"
              name="name"
              id="orderName"
              required
              autoComplete="name"
              maxLength={120}
              placeholder="Как к вам обращаться"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Номер телефона
            <input
              type="tel"
              name="phone"
              required
              autoComplete="tel"
              inputMode="tel"
              placeholder="+7 7XX XXX XX XX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label>
            Комментарий <span>(необязательно)</span>
            <textarea
              name="comment"
              rows={2}
              maxLength={500}
              placeholder="Адрес, объём, сроки…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          {error ? <p className="order-modal__error">{error}</p> : null}
          <div className="order-modal__channels">
            <button
              type="submit"
              className="order-modal__btn order-modal__btn--wa"
              disabled={submitting}
              onClick={() => {
                channelRef.current = "whatsapp";
              }}
            >
              WhatsApp
            </button>
            <button
              type="submit"
              className="order-modal__btn order-modal__btn--tg"
              disabled={submitting}
              onClick={() => {
                channelRef.current = "telegram";
              }}
            >
              Telegram
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
