/**
 * This text is intentionally fixed so a medication-decision request never
 * reaches a free-form responder.
 */
export const MEDICATION_DECISION_REFUSAL_TEXT =
  "I hear that you are asking about a medication decision. MedBuddy cannot decide whether to start, stop, continue, change, skip, or dose a medication. Please contact the prescribing clinic or a pharmacist for patient-specific guidance. 我了解您正在詢問用藥決定。MedBuddy 無法替您決定是否開始、停止、繼續、調整、略過或改變藥物劑量。請聯絡開立處方的診所或藥師取得個人化建議。";

/** Fixed boundary for requests that require clinical diagnosis or prescribing. */
export const MEDICAL_ADVICE_REFUSAL_TEXT =
  "MedBuddy cannot diagnose a condition or prescribe or recommend a treatment. Please contact a qualified clinician or pharmacist. If symptoms may be severe or urgent, contact local emergency services. MedBuddy 無法診斷疾病、開立處方或建議治療。請聯絡合格的醫療專業人員或藥師。如果症狀可能嚴重或緊急，請聯絡當地緊急服務。";
