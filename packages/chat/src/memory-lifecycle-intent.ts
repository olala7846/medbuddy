export type ExplicitMemoryLifecycleAction = "CORRECTED" | "WITHDRAWN" | "FORGOTTEN" | "DELETED";

const DIRECT_CORRECTION_PATTERNS = [
  /^(?:(?:please\s+)?correct(?:\s+(?:it|this|that))?|correction)\s*[：:]\s*(?:i|we)\s+confirm(?:\s+that)?\s+\S.+[.!。！]?$/iu,
  /^(?:(?:please\s+)?correct(?:\s+(?:it|this|that))?|correction)\s*[：:]\s*(?:set|change|update)\s+(?:my|our|the|this|that)\s+\S.+\s+(?:to|as)\s+\S.+[.!。！]?$/iu,
  /^(?:please\s+)?correct\s+(?:it|this|that|(?:my|our|the)\s+\S.+)\s+to\s+\S.+[.!。！]?$/iu,
  /^(?:請)?(?:更正|修正)(?:一下)?\s*(?:我(?:們)?(?:的)?|這(?:個|筆|份)?|該|那(?:個|筆|份)?)\S.+?(?:為|成)\S.+[。！]?$/u,
] as const;

function normalizedCommand(bodyValue: string): string {
  return bodyValue.normalize("NFKC").replace(/^\s*@\S+\s*/u, "").replace(/\s+/gu, " ").trim();
}

function hasAttributedCorrection(body: string): boolean {
  const englishCorrection = /^(?:(?:please\s+)?correct\b|correction\b)/iu.test(body);
  const chineseCorrection = /^(?:請)?(?:更正|修正)/u.test(body);
  return (englishCorrection && /\b(?:according\s+to|per|based\s+on)\b/iu.test(body))
    || (chineseCorrection && /(?:根據|依照|按照)/u.test(body));
}

/** Grants lifecycle write authority only to direct, affirmative commands. */
export function classifyExplicitMemoryLifecycle(bodyValue: string): ExplicitMemoryLifecycleAction | null {
  const body = normalizedCommand(bodyValue);
  if (body.length === 0 || /[?？]/u.test(body)) return null;
  if (/\b(?:if|unless|whether|wonder|maybe|perhaps|possibly|might|could|would|unsure|uncertain|suppose|think|guess|seems?|apparently)\b|(?:如果|假如|若|萬一|要是|除非|也許|或許|可能|不確定|是不是|我想|我猜|似乎|好像)/iu.test(body)) {
    return null;
  }
  if (/[：:]\s*(?:is|are|was|were|do|does|did|can|could|would|should|will|has|have)\b|[：:]\s*(?:是否|是不是|有沒有)/iu.test(body)) return null;
  if (/\b(?:said|says|asked|asks|told|quoted|reported|reports|heard|hears|claims?)\b|(?:她說|他說|有人說|轉述|聽說|表示|聲稱|照.+說的|根據.+說法|按照.+要求)/iu.test(body)) {
    return null;
  }
  if (hasAttributedCorrection(body)) return null;
  if (DIRECT_CORRECTION_PATTERNS.some((pattern) => pattern.test(body))) return "CORRECTED";

  const commands: readonly [ExplicitMemoryLifecycleAction, RegExp][] = [
    ["WITHDRAWN", /^(?:please\s+)?(?:withdraw|retract)\s+\S.+[.!。！]?$/iu],
    ["WITHDRAWN", /^(?:請)?撤回\s*\S.+[。！]?$/u],
    ["FORGOTTEN", /^(?:please\s+)?forget\s+\S.+[.!。！]?$/iu],
    ["FORGOTTEN", /^(?:請)?忘記\s*\S.+[。！]?$/u],
    ["DELETED", /^(?:please\s+)?(?:delete|remove)\s+\S.+[.!。！]?$/iu],
    ["DELETED", /^(?:請)?刪除\s*\S.+[。！]?$/u],
  ];
  return commands.find(([, pattern]) => pattern.test(body))?.[0] ?? null;
}
