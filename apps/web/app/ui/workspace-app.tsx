"use client";

import { useParams, useRouter } from "next/navigation.js";
import { useEffect, useRef, useState } from "react";

import { WorkspaceIdSchema } from "@medbuddy/contracts";

import {
  createHttpPersistedChatApi,
  createTabPersonaSelection,
  mountAuthenticatedChatApp,
  RealBrowserRoot,
  type MountedPersistedChatApp,
} from "../../src/index.js";

interface SessionDetails {
  kind: "GOOGLE_PROTOTYPE_REVIEWER" | "CREDENTIALS";
  workspaceId: string;
  members: readonly { id: string; role: string }[];
  fixedMemberId?: string;
}

export function WorkspaceApp() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<MountedPersistedChatApp | undefined>(undefined);
  const [session, setSession] = useState<SessionDetails>();
  const [persona, setPersona] = useState("");
  const [error, setError] = useState("");
  const routeWorkspaceId = decodeURIComponent(params.workspaceId);
  const workspaceId = WorkspaceIdSchema.safeParse(routeWorkspaceId);

  useEffect(() => {
    void fetch("/api/local-auth/session").then(async (response) => {
      if (!response.ok) {
        router.replace("/");
        return;
      }
      const details = await response.json() as SessionDetails;
      if (details.workspaceId !== routeWorkspaceId) {
        router.replace(`/workspace/${encodeURIComponent(details.workspaceId)}`);
        return;
      }
      setSession(details);
      if (details.kind === "CREDENTIALS") setPersona(details.fixedMemberId ?? "");
      else {
        const selection = createTabPersonaSelection({
          workspaceId: WorkspaceIdSchema.parse(details.workspaceId),
          storage: window.sessionStorage,
          isGoogleReviewer: true,
        });
        setPersona(selection.memberId ?? "");
      }
    }).catch(() => setError("The local session could not be loaded."));
  }, [routeWorkspaceId, router]);

  useEffect(() => {
    if (!session || !workspaceId.success || !persona || !rootRef.current) return;
    const selection = createTabPersonaSelection({
      workspaceId: workspaceId.data,
      storage: window.sessionStorage,
      isGoogleReviewer: session.kind === "GOOGLE_PROTOTYPE_REVIEWER",
    });
    if (session.kind === "GOOGLE_PROTOTYPE_REVIEWER") selection.select(persona);
    let cancelled = false;
    void mountAuthenticatedChatApp(new RealBrowserRoot(rootRef.current), {
      workspaceId: workspaceId.data,
      api: createHttpPersistedChatApi(),
      personaSelection: selection,
      pollIntervalMs: 500,
    }).then((mounted) => {
      if (cancelled) mounted.unmount();
      else mountedRef.current = mounted;
    }).catch(() => setError("The conversation could not be loaded."));
    return () => {
      cancelled = true;
      mountedRef.current?.unmount();
      mountedRef.current = undefined;
    };
  }, [persona, session, workspaceId.success, workspaceId.success ? workspaceId.data : undefined]);

  async function logout() {
    await fetch("/api/local-auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  if (!workspaceId.success) return <main className="shell"><h1>Invalid workspace</h1></main>;

  return (
    <main className="shell">
      <section className="notice"><strong>Simulation:</strong> all people, messages, medication labels, and facts in this local workspace are fictional.</section>
      <nav aria-label="Workspace navigation">
        <a href={`/workspace/${encodeURIComponent(workspaceId.data)}`}>Conversation</a>
        <a href={`/workspace/${encodeURIComponent(workspaceId.data)}/review`}>Review facts</a>
        <button className="link-button" type="button" onClick={() => void logout()}>Log out</button>
      </nav>
      {error && <p role="alert" className="error">{error}</p>}
      {!session && <p role="status">Loading local session…</p>}
      {session?.kind === "GOOGLE_PROTOTYPE_REVIEWER" && (
        <section className="persona-panel" aria-labelledby="persona-title">
          <h1 id="persona-title">Choose a fictional participant</h1>
          <label htmlFor="persona">Simulated participant for this tab</label>
          <select id="persona" value={persona} onChange={(event) => setPersona(event.target.value)}>
            <option value="">Select a participant</option>
            {session.members.map((member) => <option key={member.id} value={member.id}>{member.id} — {member.role}</option>)}
          </select>
          <p>This choice is a visible simulation hint. The server validates it on every request.</p>
        </section>
      )}
      {session?.kind === "CREDENTIALS" && (
        <p className="persona-panel" role="status">Signed in as fixed fictional participant: <strong>{session.fixedMemberId}</strong>.</p>
      )}
      {session && !persona && <p role="status">Choose a participant to load the conversation.</p>}
      <div ref={rootRef} className="chat-host" />
      <aside className="demo-hints" aria-labelledby="demo-hints-title">
        <h2 id="demo-hints-title">Local processing controls</h2>
        <p>Include <code>[demo:fail-once]</code>, <code>[demo:ignore]</code>, or <code>[demo:manual-review]</code> in fictional messages to exercise deterministic server-side states.</p>
      </aside>
    </main>
  );
}
