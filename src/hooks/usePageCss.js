import { useLayoutEffect } from "react";

export function usePageCss(cssText) {
  useLayoutEffect(() => {
    const el = document.createElement("style");
    el.setAttribute("data-page-css", "izim");
    el.textContent = cssText;
    document.head.appendChild(el);
    return () => el.remove();
  }, [cssText]);
}
