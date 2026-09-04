"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * The front door.
 *
 * A frosted panel lifted off a blurred field of colour. The tilt is small and
 * it flattens as soon as you touch the form — a card that keeps leaning while
 * you type in it is a card you fight, and the effect has done its job by then
 * anyway.
 *
 * One card does both jobs. A separate sign-up page would be a second thing to
 * design, a second thing to route to, and a second place for the same three
 * fields to drift apart; the only real difference between joining and coming
 * back is whether you are choosing the password or remembering it.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}

type Mode = "in" | "new";

function SignIn() {
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<Mode>("in");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [engaged, setEngaged] = useState(false);

  const joining = mode === "new";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          joining
            ? { action: "signup", user, password, display_name: displayName }
            : { user, password }
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "That's not right.");
        setBusy(false);
        return;
      }
      // A full navigation, so the middleware sees the new cookie. A new
      // account goes to the Plan page, because an empty Today page is a
      // puzzle and the first thing to do is put your food in.
      window.location.href = joining ? "/plan" : next;
    } catch {
      setError("Couldn't reach the server.");
      setBusy(false);
    }
  }

  function swap(to: Mode) {
    setMode(to);
    setError(null);
    setPassword("");
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-10">
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
          <p className="mt-1 text-xs text-[var(--color-mut)]">
            {joining ? "Your own plan, your own numbers" : "Sign in to your plan"}
          </p>

          <form className="mt-6 space-y-3" onSubmit={submit} onFocus={() => setEngaged(true)}>
            {joining && (
              <label className="block">
                <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Your name</span>
                <input
                  className="field w-full"
                  autoComplete="name"
                  placeholder="What you'd like to be called"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Username</span>
              <input
                className="field w-full"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Password</span>
              <input
                className="field w-full"
                type="password"
                autoComplete={joining ? "new-password" : "current-password"}
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
              {busy
                ? joining
                  ? "Setting you up…"
                  : "Signing in…"
                : joining
                  ? "Create my plan"
                  : "Sign in"}
            </button>
          </form>

          <button
            className="mt-4 w-full text-center text-xs text-[var(--color-mut)] underline decoration-dotted underline-offset-4"
            onClick={() => swap(joining ? "in" : "new")}
          >
            {joining ? "I already have an account" : "Set up a new plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
