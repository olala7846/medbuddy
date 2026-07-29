import type { MemberId, Message } from "@medbuddy/contracts";

import { MEDICATION_DECISION_REFUSAL_TEXT } from "./templates.js";

export type MedicationDecisionIntent =
  | "START"
  | "STOP"
  | "CONTINUE"
  | "CHANGE"
  | "SKIP"
  | "DOSE";

export interface ProfessionalFollowUpProposal {
  readonly kind: "FOLLOW_UP";
  readonly status: "UNRESOLVED";
  readonly contributorMemberId: MemberId;
  readonly sourceMessageId: Message["id"];
  readonly question: string;
  readonly recommendedContact: "PRESCRIBING_CLINIC_OR_PHARMACIST";
  readonly reason: "MEDICATION_DECISION_REQUEST";
}

export interface MedicationDecisionRefusal {
  readonly kind: "REFUSED_MEDICATION_DECISION";
  readonly intent: MedicationDecisionIntent;
  readonly responseText: typeof MEDICATION_DECISION_REFUSAL_TEXT;
  readonly retryable: false;
  readonly professionalFollowUpProposal: ProfessionalFollowUpProposal;
}

const MEDICATION_PATTERN = /\b(medication|medicine|medicines|meds?|pill(?:s)?|tablet(?:s)?|prescription|drug(?:s)?)\b|藥物|藥品|藥|劑量/i;
const QUESTION_PATTERN = /\?|？|\b(should|can|could|may|do i|is it okay|is it safe|what if)\b|嗎|能否|可以|是否|該不該|應不應/i;

const INTENT_PATTERNS: readonly [MedicationDecisionIntent, RegExp][] = [
  ["DOSE", /\b(dose|dosage|how much|half (?:a )?pill|double)\b|劑量/i],
  ["START", /\b(start|begin|restart|initiate|take)\b|開始/i],
  ["STOP", /\b(stop|discontinue|quit)\b|停止|停藥/i],
  ["CONTINUE", /\b(continue|keep taking|keep using)\b|繼續/i],
  ["CHANGE", /\b(change|switch|adjust|increase|decrease)\b|調整|更改|改變/i],
  ["SKIP", /\b(skip|miss)\b|跳過|略過/i],
];

function findMedicationDecisionIntent(body: string): MedicationDecisionIntent | null {
  if (!MEDICATION_PATTERN.test(body) || !QUESTION_PATTERN.test(body)) {
    return null;
  }

  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(body)) {
      return intent;
    }
  }

  return null;
}

export function isMedicationDecisionQuestion(body: string): boolean {
  return findMedicationDecisionIntent(body) !== null;
}

/**
 * Routes a focal human message to a typed, unresolved follow-up proposal.
 * The router is pure: it has no persistence handle and cannot mutate facts or
 * medication records.
 */
export function routeMedicationDecision(message: Message): MedicationDecisionRefusal | null {
  if (message.authorMemberId === "MEDBUDDY") {
    return null;
  }

  const intent = findMedicationDecisionIntent(message.body);
  if (intent === null) {
    return null;
  }

  return {
    kind: "REFUSED_MEDICATION_DECISION",
    intent,
    responseText: MEDICATION_DECISION_REFUSAL_TEXT,
    retryable: false,
    professionalFollowUpProposal: {
      kind: "FOLLOW_UP",
      status: "UNRESOLVED",
      contributorMemberId: message.authorMemberId,
      sourceMessageId: message.id,
      question: message.body,
      recommendedContact: "PRESCRIBING_CLINIC_OR_PHARMACIST",
      reason: "MEDICATION_DECISION_REQUEST",
    },
  };
}
