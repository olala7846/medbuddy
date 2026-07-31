"use client";

import { useParams, useRouter } from "next/navigation.js";
import { useEffect, useState } from "react";

import { AtomicFactSchema, ConflictSchema, WorkspaceIdSchema } from "@medbuddy/contracts";

import { createReviewHandoffView, createTabPersonaSelection } from "../../src/index.js";

export function ReviewPageClient() {
  const params = useParams<{ workspaceId: string }>();
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
      const session = await sessionResponse.json() as { kind: string; workspaceId: string };
      const persona = createTabPersonaSelection({
        workspaceId: workspace.data,
        storage: window.sessionStorage,
        isGoogleReviewer: session.kind === "GOOGLE_PROTOTYPE_REVIEWER",
      });
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.data)}/review`, {
        headers: persona.requestHeaders(),
      });
      if (!response.ok) throw new Error();
      const body = await response.json() as { facts: unknown[]; conflicts: unknown[] };
      setHtml(createReviewHandoffView({
        facts: body.facts.map((fact) => AtomicFactSchema.parse(fact)),
        conflicts: body.conflicts.map((conflict) => ConflictSchema.parse(conflict)),
        capabilities: { allowedReviewActions: [] },
      }).renderReview());
    }).catch(() => setError("Review data could not be loaded. Select a reviewer persona in the conversation first."));
  }, [router, workspaceId]);

  return (
    <main className="shell">
      <nav aria-label="Review navigation">
        <a href={`/workspace/${encodeURIComponent(workspaceId)}`}>Back to conversation</a>
        <a href={`/workspace/${encodeURIComponent(workspaceId)}/handoff/1`}>Handoff v1</a>
        <a href={`/workspace/${encodeURIComponent(workspaceId)}/handoff/2`}>Handoff v2</a>
      </nav>
      <section className="notice"><strong>Read-only checkpoint view.</strong> These are fictional fixture facts; review mutations are intentionally deferred.</section>
      {error ? <p role="alert" className="error">{error}</p> : html ? <div className="review-host" dangerouslySetInnerHTML={{ __html: html }} /> : <p role="status">Loading review facts…</p>}
    </main>
  );
}
