"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { continueWithPixelPulse } from "@/app/skyway-client";
import PixelPulseConnection from "../connection-panel";

export default function PixelPulseCanaryPage() {
  const [ready, setReady] = useState(false), [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/pixel-pulse/canary", { credentials: "same-origin", cache: "no-store" })
      .then(async response => { const data = response.ok ? await response.json() as { canary?: boolean } : null; if (active) setReady(data?.canary === true); })
      .catch(() => {}).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  const start = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pixel-pulse/canary", { method: "POST", credentials: "same-origin", cache: "no-store" });
      const data = await response.json() as { canary?: boolean; error?: string };
      if (!response.ok || data.canary !== true) throw new Error(data.error || "Canary testing is unavailable.");
      await continueWithPixelPulse();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start the canary."); setBusy(false); }
  };
  if (checking) return <main className="auth-shell"><section className="auth-card"><p role="status">Checking restricted test access…</p></section></main>;
  if (ready) return <PixelPulseConnection canaryTest />;
  return <main className="auth-shell"><section className="auth-card">
    <h1>PIXEL PULSE SIGN-IN TEST</h1>
    <p>Restricted test access only. First sign in to your existing allowlisted Skyway account. Public Pixel Pulse sign-in stays off.</p>
    <button disabled={busy} onClick={() => void start()}>{busy ? "STARTING…" : "START RESTRICTED TEST"}</button>
    {message && <p className="auth-message" role="alert">{message}</p>}
    <Link href="/">BACK TO SKYWAY</Link>
  </section></main>;
}
