"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation.js";

type SessionResponse = { workspaceId: string };

export function LoginPanel() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function finish(response: Response) {
    const body = await response.json() as SessionResponse | { error?: { message?: string } };
    if (!response.ok || !("workspaceId" in body)) {
      throw new Error("error" in body ? body.error?.message : "Sign-in failed.");
    }
    router.push(`/workspace/${encodeURIComponent(body.workspaceId)}`);
  }

  async function reviewerSignIn() {
    setBusy(true);
    setError("");
    try {
      await finish(await fetch("/api/local-auth/reviewer", { method: "POST" }));
    } catch {
      setError("The local reviewer session could not be created.");
      setBusy(false);
    }
  }

  async function credentialSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await finish(await fetch("/api/local-auth/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      }));
    } catch {
      setError("The username or password was not accepted.");
      setBusy(false);
    }
  }

  return (
    <main className="shell login-shell" aria-labelledby="login-title">
      <section className="notice" aria-label="Prototype safety notice">
        <strong>Fictional data only.</strong> Do not enter real personal or health information.
        MedBuddy organizes reports for human review and does not diagnose, prescribe, or make medication decisions.
      </section>
      <h1 id="login-title">Open the local MedBuddy demo</h1>
      <p>This browser host uses only in-memory adapters on your computer. Restarting the server clears local sessions and changes.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <section className="login-option" aria-labelledby="reviewer-title">
        <h2 id="reviewer-title">Prototype reviewer</h2>
        <p>Enter a simulated reviewer session, then choose a fictional participant for this tab.</p>
        <button type="button" disabled={busy} onClick={() => void reviewerSignIn()}>
          Enter local reviewer demo
        </button>
      </section>
      <section className="login-option" aria-labelledby="credential-title">
        <h2 id="credential-title">Fixed fictional participant</h2>
        <p>This test account stays assigned to the fictional owner and cannot switch personas.</p>
        <form onSubmit={(event) => void credentialSignIn(event)}>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" defaultValue="fictional-owner" autoComplete="username" />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" defaultValue="fictional-password" autoComplete="current-password" />
          <button disabled={busy} type="submit">Sign in with fictional credentials</button>
        </form>
      </section>
    </main>
  );
}
