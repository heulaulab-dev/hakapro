"use client";

import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

/** Patchy mobile data: say so instead of leaving spinners, and confirm when the connection returns (queries refetch on reconnect). */
export function OfflineBanner() {
  const t = useTranslations("app");
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onOnline = () => {
      setRecovered(true);
      timer = setTimeout(() => setRecovered(false), 3000);
    };
    const onOffline = () => {
      clearTimeout(timer);
      setRecovered(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online && !recovered) return null;
  return (
    <div
      role="status"
      data-testid="offline-banner"
      className={`caption-style flex min-h-8 shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-center ${online ? "bg-muted text-soft" : "bg-(--warning-muted) text-warning"}`}
    >
      {!online && <WifiOff className="size-3.5 shrink-0" />}
      <span className="leading-snug">{online ? t("backOnline") : t("offline")}</span>
    </div>
  );
}
