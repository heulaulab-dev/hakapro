"use client";

import Script from "next/script";
import { useRef } from "react";

type TrakteerOverlay = {
  init: (text: string, color: string, url: string, icon: string, size: number, position: "inline") => number;
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

    const id = overlay.init("Trakteer Kopi", "#be1e2d", MODAL_URL, ICON_URL, 40, "inline");
    overlay.draw(id);
    initialized.current = true;
  }

  return <Script id="hakapro-trakteer-tip" className="troverlay" src={SCRIPT_URL} strategy="lazyOnload" onReady={initialize} />;
}
