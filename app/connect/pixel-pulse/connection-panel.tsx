"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  continueWithPixelPulse,
  confirmWithPixelPulse,
  isPixelPulseAvailable,
  signInForPixelLink,
} from "@/app/skyway-client";

export default function PixelPulseConnection({ canaryTest = false }: { canaryTest?: boolean } = {}) {
  const entryVisible = isPixelPulseAvailable || canaryTest;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [discovery, setDiscovery] = useState<{ username: string; email: string; emailVerified: boolean } | null>(null);
  const [loading, setLoading] = useState(entryVisible);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (!entryVisible) return;
    fetch("/api/pixel-pulse/connection", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check your connection. Try again.");
        const data = await response.json() as { discovered: boolean; username: string; email: string; emailVerified: boolean };
        if (!active) return;
        if (data.discovered) { setDiscovery(data); setEmail(data.email); }
        setLoading(false);
      })
      .catch(() => {
        if (active) { setLoading(false); setMessage("Could not check your connection. Try again."); }
      });
    return () => {
      active = false;
    };
  }, [entryVisible]);
  const start = async (intent: "create" | "sign-in") => {
    setBusy(true);
    setMessage("");
    try {
      if (intent === "create") await confirmWithPixelPulse("create");
      else await continueWithPixelPulse();
    } catch (error) {
      setPassword("");
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
      // A prior Skyway cookie alone never authorizes adopting its original ID.
      const { error } = await signInForPixelLink({
        email,
        password,
      });
      if (error) throw new Error(error.message);
      await confirmWithPixelPulse("link", password);
      setPassword("");
    } catch (error) {
      setPassword("");
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not connect. Try again.",
      );
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true); setPassword(""); setMessage("");
    try {
      const response = await fetch("/api/pixel-pulse/cancel", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("Could not cancel. Try again.");
      const result = await response.json() as { connectionSaved?: boolean };
      setDiscovery(null); setBusy(false);
      setMessage(result.connectionSaved ? "Your account connection was already saved. Sign-in has been cancelled; your account and progress are unchanged." : "Sign-in cancelled. Your account and progress are unchanged.");
    } catch { setMessage("Could not cancel. Try again."); setBusy(false); }
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
        {!entryVisible ? (
          <p role="status">
            Pixel Pulse linking is still being connected.{" "}
          <Link href="/">Use existing Skyway sign-in</Link>.
          </p>
        ) : loading ? <p role="status">Checking your connection…</p> : !discovery ? (
          <>
          <p>First choose your Pixel Pulse account. Already linked? You will go straight back to the game.</p>
          <button disabled={busy} onClick={() => void start("sign-in")}>
            CONTINUE WITH PIXEL PULSE
          </button>
          </>
        ) : !discovery.emailVerified ? (
          <>
            <p role="status">Signed into Pixel Pulse as {discovery.username}. Verify your email on Pixel Pulse before linking or creating a Skyway account.</p>
            <button disabled={busy} onClick={() => void start("sign-in")}>CHECK AGAIN WITH PIXEL PULSE</button>
          </>
        ) : (
          <>
            <p>Connecting Pixel Pulse account: {discovery.username}</p>
            <p>Choose below. You will confirm your current Pixel Pulse password on Pixel Pulse before the first connection is saved.</p>
            <section className="pixel-link-option">
              <h2>HAVE A SKYWAY ACCOUNT?</h2>
              <p>
                Link account (highly recommended). Use the same email on both
                sites. Enter your existing Skyway password here to keep your
                original account and progress. Do not enter your Pixel Pulse password here.
              </p>
                <form onSubmit={link}>
                  <label>
                    Email
                    <input
                      type="email"
                      autoComplete="username"
                      disabled={busy}
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
                      disabled={busy}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <button disabled={busy}>
                    {busy ? "CONNECTING…" : "SIGN IN AND LINK"}
                  </button>
                </form>
            </section>
            <button disabled={busy} onClick={() => void cancel()}>CANCEL CONNECTION</button>
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
