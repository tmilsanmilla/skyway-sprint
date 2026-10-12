"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  continueWithPixelPulse,
  isPixelPulseAvailable,
  supabase,
} from "@/app/skyway-client";

export default function PixelPulseConnection() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [existing, setExisting] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        if (data.session?.user.email) setExisting(data.session.user.email);
        setLinked(data.session?.user.app_metadata?.provider === "pixel-pulse");
      })
      .catch(() => {
        if (active) setMessage("Could not check your session. Try again.");
      }).finally(() => { if (active) setReady(true); });
    return () => {
      active = false;
    };
  }, []);
  const start = async (intent: "link" | "create" | "sign-in") => {
    setBusy(true);
    setMessage("");
    try {
      await continueWithPixelPulse(intent);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not connect. Try again.",
      );
      setBusy(false);
    }
  };
  const link = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setPassword("");
      if (error) throw new Error(error.message);
      await continueWithPixelPulse("link");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not connect. Try again.",
      );
      setBusy(false);
    }
  };
  return (
    <main className="auth-shell">
      <section className="auth-card pixel-link-card">
        <div className="auth-logo">S</div>
        <p>SKYWAY SPRINT + PIXEL PULSE</p>
        <h1>ONE SHARED ACCOUNT</h1>
        <p>
          Your Pixel Pulse username is used across connected websites. Existing
          Skyway progress stays on the same account.
        </p>
        {!ready ? <p role="status">Checking your connection…</p> : !isPixelPulseAvailable ? (
          <p role="status">
            Pixel Pulse linking is still being connected.{" "}
          <Link href="/">Use existing Skyway sign-in</Link>.
          </p>
        ) : linked ? (
          <button disabled={busy} onClick={() => void start("sign-in")}>
            CONTINUE WITH PIXEL PULSE
          </button>
        ) : (
          <>
            <section className="pixel-link-option">
              <h2>HAVE A SKYWAY ACCOUNT?</h2>
              <p>
                Link account (highly recommended). Use the same email on both
                sites. Your password is entered only on Skyway.
              </p>
              {existing ? (
                <>
                  <p>Signed in as {existing}</p>
                  <button disabled={busy} onClick={() => void start("link")}>
                    LINK THIS ACCOUNT
                  </button>
                </>
              ) : (
                <form onSubmit={link}>
                  <label>
                    Email
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label>
                    Skyway password
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <button disabled={busy}>
                    {busy ? "CONNECTING…" : "SIGN IN AND LINK"}
                  </button>
                </form>
              )}
            </section>
            <section className="pixel-link-option">
              <h2>NEW TO SKYWAY?</h2>
              <p>
                Create a game account using Pixel Pulse. No extra password or
                username needed.
              </p>
              <button disabled={busy} onClick={() => void start("create")}>
                CREATE ACCOUNT WITH PIXEL PULSE
              </button>
            </section>
          </>
        )}
        {message && (
          <p className="auth-message" role="alert">
            {message}
          </p>
        )}
        <Link href="/">BACK TO SKYWAY</Link>
      </section>
    </main>
  );
}
