"use client";

/** Last-resort boundary (root layout failed): no i18n provider here, so bilingual static copy. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#14171b", color: "#e8eaed", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 18 }}>Terjadi kesalahan · Something went wrong</h1>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: "6px 12px", borderRadius: 6, border: "1px solid #3a3f45", background: "transparent", color: "inherit", cursor: "pointer" }}>
            Coba lagi · Try again
          </button>
        </main>
      </body>
    </html>
  );
}
