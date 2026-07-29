import { describe, expect, it } from "vitest";

import { MessageSchema } from "@medbuddy/contracts";

import {
  MEDICATION_DECISION_REFUSAL_TEXT,
  isMedicationDecisionQuestion,
  routeMedicationDecision,
} from "../src/index.js";

const focalMessage = MessageSchema.parse({
  id: "message:fictional-medication-question",
  workspaceId: "workspace:fictional-family",
  authorMemberId: "member:fictional-owner",
  body: "Should I stop this medicine?",
  createdAt: "2026-07-28T10:00:00.000Z",
  attachmentIds: [],
  captureIntent: "EXPLICIT",
  processingStatus: "PENDING",
  processingAttempts: 0,
});

describe("medication refusal", () => {
  it.each([
    ["start", "Should I start this medication?"],
    ["stop", "Should I stop this medicine?"],
    ["continue", "Can I continue taking these meds?"],
    ["change", "Should I change this prescription?"],
    ["skip", "Can I skip my pill today?"],
    ["dose", "Should I change the dose of this tablet?"],
  ])("refuses %s medication decisions before free-form generation", (intent, body) => {
    const result = routeMedicationDecision({ ...focalMessage, body });

    expect(result).toMatchObject({
      kind: "REFUSED_MEDICATION_DECISION",
      intent: intent.toUpperCase(),
      responseText: MEDICATION_DECISION_REFUSAL_TEXT,
      retryable: false,
      professionalFollowUpProposal: {
        kind: "FOLLOW_UP",
        status: "UNRESOLVED",
        contributorMemberId: focalMessage.authorMemberId,
        sourceMessageId: focalMessage.id,
        recommendedContact: "PRESCRIBING_CLINIC_OR_PHARMACIST",
        reason: "MEDICATION_DECISION_REQUEST",
      },
    });
    expect(result?.professionalFollowUpProposal.question).toBe(body);
  });

  it("returns no route for ordinary messages and never exposes a mutation tool", () => {
    expect(isMedicationDecisionQuestion("I wrote down the label.")).toBe(false);
    expect(routeMedicationDecision({ ...focalMessage, body: "I wrote down the label." })).toBeNull();
  });

  it("keeps the deterministic response bilingual and routes to a professional", () => {
    expect(MEDICATION_DECISION_REFUSAL_TEXT).toContain("cannot decide");
    expect(MEDICATION_DECISION_REFUSAL_TEXT).toContain("pharmacist");
    expect(MEDICATION_DECISION_REFUSAL_TEXT).toContain("無法替您決定");
    expect(routeMedicationDecision({ ...focalMessage, body: "我可以停止這個藥物嗎？" })).toMatchObject({
      kind: "REFUSED_MEDICATION_DECISION",
      intent: "STOP",
    });
  });

  it.each([
    ["STOP", "Should I stop Fictozine?"],
    ["SKIP", "Can I skip a dose?"],
    ["DOSE", "這個藥一天吃幾次？"],
  ])("routes medication decisions without requiring a generic medication noun", (intent, body) => {
    expect(routeMedicationDecision({ ...focalMessage, body })).toMatchObject({
      kind: "REFUSED_MEDICATION_DECISION",
      intent,
    });
  });
});
