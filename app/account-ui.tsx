"use client";

import { useEffect, useState } from "react";
import { Note } from "./explain";

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
        <p className="mt-3 rounded-xl bg-[#2a2416] px-3.5 py-2.5 text-xs text-[#ffd08a]">
          Set <span className="num">AUTH_SECRET</span> where this is deployed. Without it the
          session signature is a constant anyone can read in the source, and passwords stop being
          the thing that keeps accounts apart.
        </p>
      )}

      <Note label={others > 0 ? `${others + 1} plans on here` : "Sharing this with someone?"}>
        Everything is kept per account — your meals, your week, your weigh-ins, your log and your
        shopping list. Nobody sees anyone else&rsquo;s, and nothing you change touches theirs. They
        can set one up from the sign-in page.
      </Note>
    </section>
  );
}
