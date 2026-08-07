export type ExplicitMemoryLifecycleAction = "CORRECTED" | "WITHDRAWN" | "FORGOTTEN" | "DELETED";

function normalizedCommand(bodyValue: string): string {
  return bodyValue.normalize("NFKC").replace(/^\s*@\S+\s*/u, "").replace(/\s+/gu, " ").trim();
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

  const commands: readonly [ExplicitMemoryLifecycleAction, RegExp][] = [
    ["CORRECTED", /^(?:(?:please\s+)?correct(?:\s+(?:it|this|that))?|correction)\s*[：:]\s*\S.+[.!。！]?$/iu],
    ["CORRECTED", /^(?:please\s+)?correct\s+\S.+\s+to\s+\S.+[.!。！]?$/iu],
    ["CORRECTED", /^(?:請)?(?:更正|修正)(?:一下)?\s*[：:]\s*\S.+[。！]?$/u],
    ["WITHDRAWN", /^(?:please\s+)?(?:withdraw|retract)\s+\S.+[.!。！]?$/iu],
    ["WITHDRAWN", /^(?:請)?撤回\s*\S.+[。！]?$/u],
    ["FORGOTTEN", /^(?:please\s+)?forget\s+\S.+[.!。！]?$/iu],
    ["FORGOTTEN", /^(?:請)?忘記\s*\S.+[。！]?$/u],
    ["DELETED", /^(?:please\s+)?(?:delete|remove)\s+\S.+[.!。！]?$/iu],
    ["DELETED", /^(?:請)?刪除\s*\S.+[。！]?$/u],
  ];
  return commands.find(([, pattern]) => pattern.test(body))?.[0] ?? null;
}
