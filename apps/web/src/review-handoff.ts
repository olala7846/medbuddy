import type {
  AtomicFact,
  Conflict,
  HandoffVersion,
  ReviewAction,
} from "@medbuddy/contracts";

/** Server-derived capabilities are display permissions, never browser authority. */
export interface ReviewCapabilities {
  allowedReviewActions: readonly ReviewAction[];
}

export interface ReviewHandoffViewOptions {
  facts: readonly AtomicFact[];
  conflicts: readonly Conflict[];
  capabilities: ReviewCapabilities;
}

/**
 * A display-only review model. It intentionally receives facts, conflicts, and
 * already-derived capabilities from the server; it has no persistence ports.
 */
export class ReviewHandoffView {
  readonly #facts: readonly AtomicFact[];
  readonly #conflicts: readonly Conflict[];
  readonly #capabilities: ReviewCapabilities;

  constructor(options: ReviewHandoffViewOptions) {
    this.#facts = options.facts;
    this.#conflicts = options.conflicts;
    this.#capabilities = options.capabilities;
  }

  renderReview(): string {
    return `<main aria-labelledby="review-title">
  <h1 id="review-title">Review captured facts</h1>
  <p>Review preserves each person's report. Conflicting and unresolved information remains visible for professional follow-up.</p>
  <ol>${this.#facts.map((fact) => renderFact(fact, this.#conflicts, this.#capabilities)).join("\n")}</ol>
</main>`;
  }
}

export function createReviewHandoffView(options: ReviewHandoffViewOptions): ReviewHandoffView {
  return new ReviewHandoffView(options);
}

/** Renders only the frozen snapshot stored on the selected immutable version. */
export function renderPrintableHandoff(handoff: HandoffVersion): string {
  const { snapshot } = handoff;
  return `<style>
@media print {
  .no-print { display: none; }
  main { max-width: none; }
  article, li { break-inside: avoid; }
}
</style>
<main aria-labelledby="handoff-title">
  <p class="no-print"><button type="button" onclick="window.print()">Print this handoff</button></p>
  <h1 id="handoff-title">Printable handoff v${handoff.version}</h1>
  <p>Created ${escapeHtml(handoff.createdAt)}. This is a frozen snapshot, not medical advice.</p>
  <section aria-labelledby="facts-title"><h2 id="facts-title">Reported facts</h2><ol>${snapshot.facts.map(renderPrintableFact).join("\n")}</ol></section>
  <section aria-labelledby="conflicts-title"><h2 id="conflicts-title">Conflicts</h2>${renderConflicts(snapshot.conflicts)}</section>
  <section aria-labelledby="unresolved-title"><h2 id="unresolved-title">Unresolved items</h2><ul>${snapshot.unresolvedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}</ul></section>
  <section aria-labelledby="limitations-title"><h2 id="limitations-title">Limitations</h2><ul>${snapshot.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}</ul></section>
</main>`;
}

function renderFact(fact: AtomicFact, conflicts: readonly Conflict[], capabilities: ReviewCapabilities): string {
  const relatedFacts = conflicts
    .filter((conflict) => conflict.factIds.includes(fact.id))
    .flatMap((conflict) => conflict.factIds.filter((id) => id !== fact.id));
  const conflictHtml = relatedFacts.length === 0
    ? "<p>Conflict: none recorded.</p>"
    : `<p>Conflicts with ${relatedFacts.map((id) => `fact:${escapeHtml(id.replace(/^fact:/, ""))}`).join(", ")}</p>`;
  return `<li><article aria-label="Review fact ${escapeHtml(fact.id)}">
  <h2>${escapeHtml(fact.kind)}: ${escapeHtml(renderFactValue(fact.value))}</h2>
  <dl>
    <dt>Contributor</dt><dd>${escapeHtml(fact.contributorMemberId)}</dd>
    <dt>Provenance</dt><dd>${escapeHtml(fact.provenance)}</dd>
    <dt>Status</dt><dd>Status: ${escapeHtml(fact.reviewStatus)}</dd>
    <dt>Source message</dt><dd>${escapeHtml(fact.sourceMessageId)}</dd>
  </dl>
  ${conflictHtml}
  <div aria-label="Available review actions">${capabilities.allowedReviewActions.map((action) => `<button type="button" data-review-action="${action}" data-fact-id="${escapeHtml(fact.id)}">${escapeHtml(reviewActionLabel(action))}</button>`).join(" ")}</div>
</article></li>`;
}

function renderPrintableFact(fact: AtomicFact): string {
  return `<li><article>
  <p><strong>${escapeHtml(fact.kind)}:</strong> ${escapeHtml(renderFactValue(fact.value))}</p>
  <p>Contributor: ${escapeHtml(fact.contributorMemberId)} · Provenance: ${escapeHtml(fact.provenance)} · Status: ${escapeHtml(fact.reviewStatus)}</p>
</article></li>`;
}

function renderConflicts(conflicts: readonly Conflict[]): string {
  return conflicts.length === 0
    ? "<p>No conflicts recorded in this snapshot.</p>"
    : `<ul>${conflicts.map((conflict) => `<li>${escapeHtml(conflict.factIds.join(" conflicts with "))}</li>`).join("\n")}</ul>`;
}

function renderFactValue(value: Record<string, unknown>): string {
  return Object.entries(value).map(([key, item]) => `${key}: ${String(item)}`).join("; ");
}

function reviewActionLabel(action: ReviewAction): string {
  return ({ ACCEPT: "Accept", REJECT: "Reject", MARK_UNCERTAIN: "Mark uncertain", WITHDRAW: "Withdraw" })[action];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
