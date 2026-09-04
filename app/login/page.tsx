"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * The front door.
 *
 * A frosted panel, flat, on a field of coloured light that has depth of its
 * own. The card used to be tilted in 3D and it was the wrong element to put
 * the effect on: a form leaning away from you is a form that looks like it is
 * about to do something, and the first thing you do on this screen is type
 * into it. The depth moved to the background, where nothing has to be legible
 * and nothing has to be tapped — see `.drift` in globals.css.
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

  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<Mode>("in");
  /** Carried across a swap so typing your name twice isn't the price of it. */
  const [keepUser, setKeepUser] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const joining = mode === "new";

  /**
   * Parallax on the lights behind the glass.
   *
   * Two custom properties on the stage — how far the pointer is from the
   * middle, as a fraction — and each light multiplies them by a different
   * amount in CSS. That is the whole trick, and doing it with properties
   * rather than per-element styles means one write per frame instead of three,
   * and the compositor does the rest.
   *
   * Only for a real pointer. There is no cursor on a phone, and the
   * alternative — device orientation — needs a permission prompt on iOS, which
   * is an absurd thing to ask someone for on a sign-in page. Touch gets the
   * slow ambient float in the stylesheet instead, which needs nothing and
   * stops the screen looking dead.
   */
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    function onMove(e: PointerEvent) {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const node = stage.current;
        if (!node) return;
        node.style.setProperty("--px", String(e.clientX / window.innerWidth - 0.5));
        node.style.setProperty("--py", String(e.clientY / window.innerHeight - 0.5));
      });
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /**
   * The fields are uncontrolled, and that is the fix rather than a shortcut.
   *
   * This is what made signing up look broken. They were controlled inputs, so
   * `password` only updated when React saw a change event — and most of the
   * things that fill a password field on a phone never fire one. iOS Safari's
   * strong-password suggestion, 1Password, Chrome's saved logins: they write
   * straight to the DOM node. React's state stayed empty, and then the next
   * render helpfully wrote that empty string back over the field. So you
   * watched a password appear, pressed the button, and were told your password
   * was too short. Nothing on screen could explain it.
   *
   * Letting the DOM own the value removes the whole class of problem instead
   * of patching the one symptom, and the form is read at the moment of submit.
   * Swapping between signing in and joining remounts the form — that's what
   * the `key` is for — which clears the password and keeps the username.
   */
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const typedUser = String(data.get("user") ?? "").trim();
    const typedPassword = String(data.get("password") ?? "");
    const typedName = String(data.get("display_name") ?? "").trim();

    if (!typedUser || !typedPassword) {
      setError("Fill both boxes in.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          joining
            ? {
                action: "signup",
                user: typedUser,
                password: typedPassword,
                display_name: typedName,
              }
            : { user: typedUser, password: typedPassword }
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
    const data = formRef.current ? new FormData(formRef.current) : null;
    setKeepUser(String(data?.get("user") ?? "").trim());
    setMode(to);
    setError(null);
    setReveal(false);
  }

  return (
    <div
      ref={stage}
      className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-10"
    >
      {/* Blurred field behind the glass. Three soft lights, heavily blurred —
          cheaper and calmer than an image, and it can't fail to load.

          The depth is here now rather than in the card. Each light drifts by a
          different amount, which is what makes it read as distance: the near
          one moves most, the far one barely at all. Tilting the card was the
          other way round — it announced itself, it fought you the moment you
          tried to type in it, and a sign-in form is not a thing that should be
          doing tricks.

          Not `-z-10`: a negative z-index paints behind the background of the
          nearest stacking-context ancestor, and <body> has one, so the whole
          thing vanished. Ordinary source order and a `relative` card does the
          same job without the trap. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[#07080a]" />
        <div className="drift drift-1 absolute left-[-15%] top-[-20%] h-[65vmax] w-[65vmax] rounded-full bg-[#c9f24d] opacity-[0.30] blur-[110px]" />
        <div className="drift drift-2 absolute bottom-[-25%] right-[-20%] h-[60vmax] w-[60vmax] rounded-full bg-[#5b9dff] opacity-[0.28] blur-[120px]" />
        <div className="drift drift-3 absolute bottom-[5%] left-[20%] h-[40vmax] w-[40vmax] rounded-full bg-[#ff5d8f] opacity-[0.18] blur-[110px]" />
      </div>

      <div className="relative w-full max-w-[22rem]">
        <div className="glass px-7 pb-7 pt-8">
          <p className="text-[1.35rem] font-bold tracking-tight">
            Meal<span className="text-[var(--color-accent)]">Hub</span>
          </p>
          <p className="mt-1 text-xs text-[var(--color-mut)]">
            {joining ? "Your own plan, your own numbers" : "Sign in to your plan"}
          </p>

          <form
            key={mode}
            ref={formRef}
            className="mt-6 space-y-3"
            onSubmit={submit}
          >
            {joining && (
              <label className="block">
                <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Your name</span>
                <input
                  name="display_name"
                  className="field w-full"
                  autoComplete="name"
                  placeholder="What you'd like to be called"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Username</span>
              <input
                name="user"
                className="field w-full"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                defaultValue={keepUser}
              />
            </label>

            {/* The header sits outside the label rather than inside it, so
                that tapping Show toggles the field instead of being forwarded
                to it as a label click. */}
            <div className="block">
              <div className="mb-1.5 flex items-baseline gap-2 text-xs text-[var(--color-mut)]">
                <label htmlFor="mh-password">Password</label>
                {joining && <span className="text-[#5b6270]">anything you like</span>}
                {/* Reading back what you typed matters more here than anywhere
                    else in the app: it is the one field you cannot see, on the
                    one screen where getting it wrong locks you out. */}
                <button
                  type="button"
                  className="ml-auto text-[0.7rem] text-[var(--color-mut)] underline decoration-dotted underline-offset-2"
                  onClick={() => setReveal((v) => !v)}
                >
                  {reveal ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="mh-password"
                name="password"
                className="field w-full"
                type={reveal ? "text" : "password"}
                autoComplete={joining ? "new-password" : "current-password"}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                /* Safari reads this to decide what its strong-password
                   generator may produce. Saying everything is allowed and
                   nothing is required is both true and what makes the
                   suggestion appear rather than be quietly suppressed. */
                {...(joining ? { passwordrules: "minlength: 1; allowed: unicode;" } : {})}
              />
            </div>

            {error && (
              <p role="alert" className="text-xs font-semibold" style={{ color: "var(--color-fat)" }}>
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
