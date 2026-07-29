import { describe, expect, it } from "vitest";

import { GoldenScenario, HandoffVersionSchema } from "@medbuddy/contracts";

import {
  createReviewHandoffView,
  renderPrintableHandoff,
} from "../src/index.js";

describe("fixture-backed review and handoff views", () => {
  it("shows each fact's contributor, provenance, conflict, and review status", () => {
    const view = createReviewHandoffView({
      facts: handoffV1.snapshot.facts,
      conflicts: handoffV1.snapshot.conflicts,
      capabilities: { allowedReviewActions: ["ACCEPT", "MARK_UNCERTAIN"] },
    });

    const html = view.renderReview();

    expect(html).toContain("member:owner");
    expect(html).toContain("OWNER_REPORT");
    expect(html).toContain("Status: UNCERTAIN");
    expect(html).toContain("Conflicts with fact:caregiver-timing");
    expect(html).toContain("fact:medication-change-follow-up");
  });

  it("renders only the review actions supplied by server-derived actor capabilities", () => {
    const view = createReviewHandoffView({
      facts: handoffV1.snapshot.facts,
      conflicts: handoffV1.snapshot.conflicts,
      capabilities: { allowedReviewActions: ["MARK_UNCERTAIN"] },
    });

    const html = view.renderReview();

    expect(html).toContain('data-review-action="MARK_UNCERTAIN"');
    expect(html).not.toContain('data-review-action="ACCEPT"');
    expect(html).not.toContain('data-review-action="REJECT"');
    expect(html).not.toContain('data-review-action="WITHDRAW"');
  });

  it("prints the selected frozen handoff snapshot rather than later fixture facts", () => {
    const v1 = renderPrintableHandoff(handoffV1);
    const v2 = renderPrintableHandoff(handoffV2);

    expect(v1).toContain("Printable handoff v1");
    expect(v1).toContain("Take after breakfast.");
    expect(v1).not.toContain("mild dizziness");
    expect(v1).toContain("@media print");
    expect(v2).toContain("Printable handoff v2");
    expect(v2).toContain("mild dizziness");
  });
});

const handoffV1 = HandoffVersionSchema.parse(GoldenScenario.handoffV1);
const handoffV2 = HandoffVersionSchema.parse(GoldenScenario.handoffV2);
