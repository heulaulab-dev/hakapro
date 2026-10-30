"use client";

import Script from "next/script";
import { useRef } from "react";

type TrakteerOverlay = {
  init: (text: string, color: string, url: string, icon: string, size: number, position: "floating-left") => number;
  draw: (id: number) => void;
};

declare global {
  interface Window {
    trbtnOverlay?: TrakteerOverlay;
  }
}

const SCRIPT_URL = "https://edge-cdn.trakteer.id/js/trbtn-overlay.min.js?v=14-05-2025";
const MODAL_URL = "https://trakteer.id/v1/heulaulab/tip/embed/modal";
const ICON_URL = "https://edge-cdn.trakteer.id/images/embed/trbtn-icon.png?v=14-05-2025";

/** Loads the supplied Trakteer embed once for the authenticated app shell. */
export function TrakteerTipOverlay() {
  const initialized = useRef(false);

  function initialize() {
    const overlay = window.trbtnOverlay;
    if (!overlay || initialized.current) return;

    const id = overlay.init("Trakteer Kopi", "#be1e2d", MODAL_URL, ICON_URL, 40, "floating-left");
    overlay.draw(id);

    // Trakteer injects its own fixed-position CSS. Anchor it to the opposite side
    // from the Action Center so changes to alert count or render timing cannot stack them.
    const container = document.getElementById(`trbtn-overlay-container-${id}`);
    const placeOverlay = () => {
      if (!container) return;
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      container.style.setProperty("position", "fixed", "important");
      container.style.setProperty(
        "bottom",
        mobile ? "calc(8rem + env(safe-area-inset-bottom, 0px))" : "4.5rem",
        "important",
      );
      container.style.setProperty("left", "max(1rem, env(safe-area-inset-left, 0px))", "important");
      container.style.setProperty("right", "auto", "important");
    };
    placeOverlay();
    window.addEventListener("resize", placeOverlay, { passive: true });
    initialized.current = true;
  }

  return <Script id="hakapro-trakteer-tip" className="troverlay" src={SCRIPT_URL} strategy="lazyOnload" onReady={initialize} />;
}
