"use client";

import { useEffect, useState } from "react";
import { Note } from "./explain";
import { Flag } from "./flag";

/**
 * Your account, on the page where the rest of your settings already are.
 *
 * Deliberately not a page of its own. There is very little here — a name and a
 * password — and a whole screen for two fields is how apps end up with a
 * settings section you have to go looking through.
 */
export function AccountCard() {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState("");
  const [username, setUsername] = useState("");
  const [others, setOthers] = useState(0);
  const [weakSecret, setWeakSecret] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [changing, setChanging] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.me) return;
        setName(String(d.me.display_name));
        setSaved(String(d.me.display_name));
        setUsername(String(d.me.username));
        setOthers(Number(d.others ?? 0));
        setWeakSecret(!!d.weakSecret);
      })
      .catch(() => {});
  }, []);

  function say(text: string, isBad = false) {
    setMsg(text);
    setBad(isBad);
    setTimeout(() => setMsg(null), 2600);
  }

  async function saveName() {
    const clean = name.trim();
    if (!clean || clean === saved) return;
    setBusy(true);
    const res = await fetch("/api/auth", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: clean }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(clean);
      say("Saved");
    } else {
      say("Couldn't save that", true);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/auth", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current, password: next }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setCurrent("");
      setNext("");
      setChanging(false);
      say("Password changed");
    } else {
      say(body.error ?? "Couldn't change it", true);
    }
  }

  async function confirmDelete(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "delete", password: confirmPw }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setConfirmPw("");
      say(body.error ?? "Couldn't delete it", true);
      return;
    }
    // A full navigation rather than a router push: the account this page was
    // built from no longer exists, and every fetch it makes from here would
    // 401. Start again from the door.
    window.location.href = "/login";
  }

  return (
    <section className="card px-5 py-5">
      <div className="flex items-baseline gap-3">
        <p className="label mr-auto">Your account</p>
        {username && <p className="text-xs text-[var(--color-mut)]">{username}</p>}
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Name</span>
          <input
            className="field w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
          />
        </label>

        {changing ? (
          <form className="space-y-3" onSubmit={savePassword}>
            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--color-mut)]">
                Current password
              </span>
              <input
                className="field w-full"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--color-mut)]">New password</span>
              <input
                className="field w-full"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <button className="btn btn-accent flex-1" type="submit" disabled={busy}>
                {busy ? "Changing…" : "Change it"}
              </button>
              <button className="btn" type="button" onClick={() => setChanging(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-sm" onClick={() => setChanging(true)}>
            Change password
          </button>
        )}

        {msg && (
          <p
            className="text-xs"
            style={{ color: bad ? "var(--color-fat)" : "var(--color-accent)" }}
          >
            {msg}
          </p>
        )}
      </div>

      {weakSecret && (
        <Flag className="mt-3" tone="bad" title="AUTH_SECRET isn't set">
          <Note label="What that means">
            Sessions are signed with a constant that is printed in the source, so anyone who reads
            it can forge a cookie for any account. Add it as an environment variable where this is
            deployed — README.md has the two-minute version.
          </Note>
        </Flag>
      )}

      <Note label={others > 0 ? `${others + 1} plans on here` : "Sharing this with someone?"}>
        Everything is kept per account — your meals, your week, your weigh-ins, your log and your
        shopping list. Nobody sees anyone else&rsquo;s, and nothing you change touches theirs. They
        can set one up from the sign-in page.
      </Note>

      {/* Two steps and a password, because there is no third step where you
          get it back. The button stays quiet until you have asked for it —
          a red "Delete everything" sitting permanently under your name is
          both alarming and easier to hit by accident than it should be. */}
      <div className="mt-4 border-t border-[#1c1f25] pt-3">
        {closing ? (
          <form className="space-y-3" onSubmit={confirmDelete}>
            <Flag
              tone="bad"
              title="This deletes your plan and everything in it"
              detail="Meals, week, weigh-ins, log, shopping list, history. It can't be undone."
            />
            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--color-mut)]">
                Your password, to be sure
              </span>
              <input
                className="field w-full"
                type="password"
                autoComplete="current-password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <button
                className="btn flex-1"
                type="submit"
                disabled={busy || !confirmPw}
                style={{ background: "var(--color-fat)", color: "#2a0a13" }}
              >
                {busy ? "Deleting…" : "Delete my account"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setClosing(false);
                  setConfirmPw("");
                }}
              >
                Keep it
              </button>
            </div>
          </form>
        ) : (
          <button
            className="btn btn-sm btn-quiet"
            onClick={() => {
              setClosing(true);
              setMsg(null);
            }}
          >
            Delete my account
          </button>
        )}
      </div>
    </section>
  );
}
