"use client";

import { useParams, useRouter } from "next/navigation.js";
import { useEffect, useState } from "react";

import { HandoffVersionSchema, WorkspaceIdSchema } from "@medbuddy/contracts";

import { createTabPersonaSelection, renderPrintableHandoff } from "../../src/index.js";

export function HandoffPageClient() {
  const params = useParams<{ workspaceId: string; version: string }>();
  const workspaceId = decodeURIComponent(params.workspaceId);
  const router = useRouter();
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const workspace = WorkspaceIdSchema.safeParse(workspaceId);
    if (!workspace.success) return;
    void fetch("/api/local-auth/session").then(async (sessionResponse) => {
      if (!sessionResponse.ok) {
        router.replace("/");
        return;
      }
      const session = await sessionResponse.json() as { kind: string };
      const persona = createTabPersonaSelection({
        workspaceId: workspace.data,
        storage: window.sessionStorage,
        isGoogleReviewer: session.kind === "GOOGLE_PROTOTYPE_REVIEWER",
      });
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspace.data)}/handoffs/${encodeURIComponent(params.version)}`,
        { headers: persona.requestHeaders() },
      );
      if (!response.ok) throw new Error();
      setHtml(renderPrintableHandoff(HandoffVersionSchema.parse(await response.json())));
    }).catch(() => setError("The frozen handoff could not be loaded."));
  }, [params.version, router, workspaceId]);

  return (
    <main className="shell handoff-shell">
      <nav className="no-print" aria-label="Handoff navigation">
        <a href={`/workspace/${encodeURIComponent(workspaceId)}/review`}>Back to review</a>
        <a href={`/workspace/${encodeURIComponent(workspaceId)}/handoff/1`}>Version 1</a>
        <a href={`/workspace/${encodeURIComponent(workspaceId)}/handoff/2`}>Version 2</a>
      </nav>
      {error ? <p role="alert" className="error">{error}</p> : html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <p role="status">Loading frozen handoff…</p>}
    </main>
  );
}
