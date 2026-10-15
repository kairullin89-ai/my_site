import { useEffect, useLayoutEffect } from "react";

const revealed = new WeakSet();

export function useSiteMotion() {
  useLayoutEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = [
      ...document.querySelectorAll(".work__intro, .work__shot, .contact > *, .marquee, .products__head, .product"),
    ];
    document.querySelectorAll("[data-stagger]").forEach((el) => {
      el.classList.add("reveal-row");
      targets.push(el);
    });

    targets.forEach((el) => {
      if (!el.classList.contains("reveal") && !el.classList.contains("reveal-row")) {
        el.classList.add("reveal");
      }
      if (reduced || revealed.has(el)) el.classList.add("is-in");
    });

    if (reduced || !("IntersectionObserver" in window)) {
      targets.forEach((el) => {
        el.classList.add("is-in");
        revealed.add(el);
      });
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          revealed.add(entry.target);
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -6% 0px" }
    );
    targets.forEach((el) => {
      if (!revealed.has(el)) io.observe(el);
    });
    return () => io.disconnect();
  });

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.classList.add(reduced ? "motion-off" : "motion-on");
    document.documentElement.classList.remove(reduced ? "motion-on" : "motion-off");

    const bar = document.querySelector(".progress i");
    const hero = document.querySelector(".hero");
    const heroMedia = document.querySelector("[data-parallax]");
    const heroCopy = document.querySelector(".hero__copy");

    const onScroll = () => {
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.width = `${max > 0 ? (y / max) * 100 : 0}%`;
      if (reduced || !hero) return;

      const h = hero.offsetHeight || 1;
      const p = Math.min(1, Math.max(0, y / h));
      if (heroMedia) {
        heroMedia.style.setProperty("--scroll-y", `${p * 80}px`);
        heroMedia.style.setProperty("--scroll-scale", String(1 + p * 0.06));
      }
      if (heroCopy) {
        heroCopy.style.opacity = String(1 - p * 1.2);
        heroCopy.style.transform = `translate3d(0, ${p * 48}px, 0)`;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    let raf = 0;
    let mx = 0;
    let my = 0;
    let tx = 0;
    let ty = 0;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    const tick = () => {
      tx += (mx - tx) * 0.07;
      ty += (my - ty) * 0.07;
      if (heroMedia) {
        heroMedia.style.setProperty("--mouse-x", `${tx}px`);
        heroMedia.style.setProperty("--mouse-y", `${ty}px`);
      }
      raf = 0;
    };

    const onPointer = (e) => {
      mx = (e.clientX / window.innerWidth - 0.5) * 22;
      my = (e.clientY / window.innerHeight - 0.5) * 16;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    if (heroMedia && !reduced && !coarse) {
      window.addEventListener("pointermove", onPointer, { passive: true });
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}
