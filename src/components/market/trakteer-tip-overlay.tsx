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

    // Trakteer injects a stylesheet with fixed offsets. Keep its button stacked above
    // the Action Center by measuring the actual control instead of guessing its size
    // (which changes with responsive layout and alert count).
    const placeOverlay = () => {
      const container = document.getElementById(`trbtn-overlay-container-${id}`);
      if (!container) return;

      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const actionCenter = document.querySelector<HTMLElement>('[data-testid="action-center-button"]');
      const actionRect = actionCenter?.getBoundingClientRect();
      const right = actionRect
        ? Math.max(16, window.innerWidth - actionRect.right)
        : 16;
      const bottom = actionRect
        ? Math.max(16, window.innerHeight - actionRect.top + 8)
        : mobile ? 128 : 72;

      container.style.setProperty("position", "fixed", "important");
      container.style.setProperty("bottom", `${bottom}px`, "important");
      container.style.setProperty("right", `${right}px`, "important");
    };
    placeOverlay();
    window.addEventListener("resize", placeOverlay, { passive: true });
    // The Action Center appears only after its radar request finishes. Reposition
    // when it enters/leaves the page so the two floating controls never collide.
    const observer = new MutationObserver(placeOverlay);
    observer.observe(document.body, { childList: true, subtree: true });
    initialized.current = true;
  }

  return <Script id="hakapro-trakteer-tip" className="troverlay" src={SCRIPT_URL} strategy="lazyOnload" onReady={initialize} />;
}
