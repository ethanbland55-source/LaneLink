"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The front door.
 *
 * A frosted panel lifted off a blurred field of colour. The tilt is small and
 * it flattens as soon as you touch the form — a card that keeps leaning while
 * you type in it is a card you fight, and the effect has done its job by then
 * anyway.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [user, setUser] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [engaged, setEngaged] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "That's not right.");
        setBusy(false);
        return;
      }
      // A full navigation, so the middleware sees the new cookie.
      window.location.href = next;
    } catch {
      setError("Couldn't reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4">
      {/* Blurred field behind the glass. Three soft lights, heavily blurred —
          cheaper and calmer than an image, and it can't fail to load.

          Not `-z-10`: a negative z-index paints behind the background of the
          nearest stacking-context ancestor, and <body> has one, so the whole
          thing vanished. Ordinary source order and a `relative` card does the
          same job without the trap. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[#07080a]" />
        <div className="absolute left-[-15%] top-[-20%] h-[65vmax] w-[65vmax] rounded-full bg-[#c9f24d] opacity-[0.30] blur-[110px]" />
        <div className="absolute bottom-[-25%] right-[-20%] h-[60vmax] w-[60vmax] rounded-full bg-[#5b9dff] opacity-[0.28] blur-[120px]" />
        <div className="absolute bottom-[5%] left-[20%] h-[40vmax] w-[40vmax] rounded-full bg-[#ff5d8f] opacity-[0.18] blur-[110px]" />
      </div>

      <div className="relative w-full max-w-[22rem]" style={{ perspective: "1200px" }}>
        <div
          className="glass px-7 pb-7 pt-8"
          style={{
            transform: engaged
              ? "rotateX(0deg) rotateY(0deg) translateZ(0)"
              : "rotateX(7deg) rotateY(-6deg) translateZ(0)",
            transition: "transform 600ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <p className="text-[1.35rem] font-bold tracking-tight">
            Meal<span className="text-[var(--color-accent)]">Hub</span>
          </p>
          <p className="mt-1 text-xs text-[var(--color-mut)]">Sign in to your plan</p>

          <form className="mt-6 space-y-3" onSubmit={submit} onFocus={() => setEngaged(true)}>
            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Name</span>
              <input
                className="field w-full"
                autoComplete="username"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Password</span>
              <input
                className="field w-full"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {error && (
              <p role="alert" className="text-xs" style={{ color: "var(--color-fat)" }}>
                {error}
              </p>
            )}

            <button className="btn btn-accent w-full" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[0.7rem] leading-relaxed text-[#5b6270]">
          This keeps the page out of the way of anyone who stumbles on the address. It is not
          security — set <span className="num">AUTH_PASSWORD</span> and{" "}
          <span className="num">AUTH_SECRET</span> in the environment to make it so.
        </p>
      </div>
    </div>
  );
}
