import { useEffect, useState } from "react";
import { fetchContacts } from "../lib/contacts.js";

export function useContacts() {
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError("");
    fetchContacts()
      .then((data) => {
        if (alive) setContacts(data);
      })
      .catch((err) => {
        console.error(err);
        if (!alive) return;
        setContacts(null);
        setError(err && err.message ? err.message : "Не удалось загрузить контакты");
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  return {
    contacts,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
