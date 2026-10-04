"use client";

import { Logo } from "@/components/brand/logo";

/** Last-resort boundary (root layout failed): no i18n provider or globals.css here, so bilingual static copy, inline styles and a fixed logo tone. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#081720", color: "#f3f7f7", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main style={{ textAlign: "center", padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <Logo variant="horizontal" tone="color-on-dark" height={36} priority />
          <h1 style={{ fontSize: 18 }}>Terjadi kesalahan · Something went wrong</h1>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: "6px 12px", borderRadius: 6, border: "1px solid #3a3f45", background: "transparent", color: "inherit", cursor: "pointer" }}>
            Coba lagi · Try again
          </button>
        </main>
      </body>
    </html>
  );
}
