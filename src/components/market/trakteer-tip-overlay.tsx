"use client";

import Script from "next/script";
import { useRef } from "react";

type TrakteerOverlay = {
  init: (text: string, color: string, url: string, icon: string, size: number, position: "floating-right") => number;
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

    const id = overlay.init("Trakteer Kopi", "#be1e2d", MODAL_URL, ICON_URL, 40, "floating-right");
    overlay.draw(id);

    // Trakteer injects a later stylesheet with !important on its bottom/right offsets.
    // Apply our safe placement inline after draw so neither the Action Center nor its
    // fixed alert badge can cover the button at the lower-right edge. Stack it above
    // the badge and align their right edges so both controls share one anchor.
    const placeOverlay = () => {
      const container = document.getElementById(`trbtn-overlay-container-${id}`);
      if (!container) return;

      const mobile = window.matchMedia("(max-width: 767px)").matches;
      container.style.setProperty("position", "fixed", "important");
      container.style.setProperty(
        "bottom",
        mobile ? "calc(8rem + env(safe-area-inset-bottom, 0px))" : "4.5rem",
        "important",
      );
      container.style.setProperty(
        "right",
        "max(1rem, env(safe-area-inset-right, 0px))",
        "important",
      );
    };
    placeOverlay();
    window.addEventListener("resize", placeOverlay, { passive: true });
    initialized.current = true;
  }

  return <Script id="hakapro-trakteer-tip" className="troverlay" src={SCRIPT_URL} strategy="lazyOnload" onReady={initialize} />;
}
