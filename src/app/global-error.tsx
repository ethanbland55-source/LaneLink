"use client";

/**
 * Last-resort error boundary. It replaces the root layout entirely — which is
 * why it has to render its own <html> and <body>, and why it can't use the site
 * header (there's no router context to hang it off at this point).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "linear-gradient(165deg, #3d1d52 0%, #241031 100%)",
          color: "white",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "30rem" }}>
          <p
            style={{
              fontSize: "0.78rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#f7b519",
              fontWeight: 600,
              margin: 0,
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ fontSize: "2rem", lineHeight: 1.15, margin: "1rem 0 0" }}>
            The site hit an unexpected error
          </h1>
          <p style={{ marginTop: "1rem", color: "rgba(239,232,248,0.85)", lineHeight: 1.6 }}>
            Try again in a moment. If it keeps happening, let the club know what you were doing
            when it broke.
          </p>
          {error.digest && (
            <p style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "rgba(239,232,248,0.5)" }}>
              Reference: {error.digest}
            </p>
          )}
          <div style={{ marginTop: "2rem", display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#f7b519",
                color: "#241031",
                border: 0,
                borderRadius: "999px",
                padding: "0.7rem 1.4rem",
                fontWeight: 600,
                fontSize: "0.95rem",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                background: "rgba(255,255,255,0.12)",
                color: "white",
                border: "1.5px solid rgba(255,255,255,0.28)",
                borderRadius: "999px",
                padding: "0.7rem 1.4rem",
                fontWeight: 600,
                fontSize: "0.95rem",
                textDecoration: "none",
              }}
            >
              Back to the home page
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
