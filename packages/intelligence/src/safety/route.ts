import type { MemberId, Message } from "@medbuddy/contracts";

import {
  MEDICAL_ADVICE_REFUSAL_TEXT,
  MEDICATION_DECISION_REFUSAL_TEXT,
} from "./templates.js";

export interface MedicalAdviceRefusal {
  readonly kind: "REFUSED_MEDICAL_ADVICE";
  readonly responseText: typeof MEDICAL_ADVICE_REFUSAL_TEXT;
  readonly retryable: false;
}

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

const QUESTION_PATTERN = /\?|？|\b(should|can|could|may|do i|is it okay|is it safe|what if)\b|嗎|能否|可以|是否|該不該|應不應/i;

const INTENT_PATTERNS: readonly [MedicationDecisionIntent, RegExp][] = [
  ["SKIP", /\b(skip|miss)\b|跳過|略過/i],
  ["DOSE", /\b(dose|dosage|how much|how many|how often|half (?:a )?pill|double)\b|劑量|一天吃幾次|幾次/i],
  ["START", /\b(start|begin|restart|initiate|take)\b|開始/i],
  ["STOP", /\b(stop|discontinue|quit)\b|停止|停藥/i],
  ["CONTINUE", /\b(continue|keep taking|keep using)\b|繼續/i],
  ["CHANGE", /\b(change|switch|adjust|increase|decrease)\b|調整|更改|改變/i],
];

const DIAGNOSIS_OR_PRESCRIBING_PATTERNS: readonly RegExp[] = [
  /\bdiagnos(?:e|ed|es|ing|is)\b/i,
  /\b(?:do i have|what is wrong with me|could (?:this|it) be)\b/i,
  /\b(?:what (?:medicine|medication|drug|treatment) should i (?:take|use)|what should i take for)\b/i,
  /\b(?:prescribe|recommend) (?:me )?(?:a |an |some )?(?:medicine|medication|drug|treatment)\b/i,
  /診斷|我得了什麼|這是什麼病|開(?:藥|處方)|推薦(?:藥物|治療)/i,
];

export function routeDiagnosisOrPrescribingRequest(message: Message): MedicalAdviceRefusal | null {
  if (message.authorMemberId === "MEDBUDDY") {
    return null;
  }

  if (!DIAGNOSIS_OR_PRESCRIBING_PATTERNS.some((pattern) => pattern.test(message.body))) {
    return null;
  }

  return {
    kind: "REFUSED_MEDICAL_ADVICE",
    responseText: MEDICAL_ADVICE_REFUSAL_TEXT,
    retryable: false,
  };
}

function findMedicationDecisionIntent(body: string): MedicationDecisionIntent | null {
  if (!QUESTION_PATTERN.test(body)) {
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
