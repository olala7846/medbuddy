import {
  CJK_FAMILY_RELATIONSHIP_TERM_PATTERN,
  ENGLISH_FAMILY_RELATIONSHIP_TERM_PATTERN,
  ConversationToolDeclarationSchema,
  type ConversationContext,
  type ConversationToolDeclaration,
  type ConversationToolExecutionContext,
  type ConversationToolJsonObject,
  type ConversationToolResultDisposition,
  type ConversationTurnTools,
  type Message,
} from "@medbuddy/contracts";
import { z } from "zod";

import { type MedicationLookupRenderResult } from "../grounding/render.js";

export const FAMILY_MAP_UPDATE_FAILURE_TEXT =
  "I couldn’t save that family-map change. Please try again.";
export const AMBIGUOUS_RELATIONSHIP_CLARIFICATION_TEXT =
  "Which observed member do you mean? Please name them before I update this chat’s family map.";
export const CONVERSATION_MAX_MODEL_STEPS = 3;
export const CONVERSATION_MAX_TOOL_CALLS = 2;
export const CONVERSATION_TOOL_INPUT_MAX_UTF16 = 8_000;
export const CONVERSATION_TOOL_RESULT_MAX_UTF16 = 8_000;
export const CONVERSATION_TOOL_EXCHANGE_MAX_UTF16 = 9_000;

export const FAMILY_MAP_TOOL_NAME = "update_workspace_family_map";
const MAX_MODEL_TOOL_CAPABILITIES = 8;
const CONVERSATION_TOOL_DECLARATION_MAX_DEPTH = 16;
const CONVERSATION_TOOL_DECLARATION_MAX_NODES = 512;
const CONVERSATION_TOOL_DECLARATION_MAX_UTF16 = 16_000;
const CONVERSATION_TOOL_VALUE_MAX_DEPTH = 32;
const CONVERSATION_TOOL_VALUE_MAX_NODES = 1_024;

type BoundSafeParse = (
  value: unknown,
) => z.ZodSafeParseResult<ConversationToolJsonObject>;

export type BoundConversationToolCapability = Readonly<{
  declaration: ConversationToolDeclaration;
  requiredBeforeReply: boolean;
  inputSchema: z.ZodType<ConversationToolJsonObject>;
  parseInput: BoundSafeParse;
  parseOutput: BoundSafeParse;
  classifyResult(output: ConversationToolJsonObject): ConversationToolResultDisposition;
  execute(
    input: ConversationToolJsonObject,
    context: ConversationToolExecutionContext,
  ): Promise<unknown>;
}>;

function hasBoundedPlainJsonValue(
  value: unknown,
  bounds: { maxDepth: number; maxNodes: number; maxUtf16: number },
): boolean {
  const pending: Array<{ value: unknown; depth: number; leaving?: boolean }> = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  let nodeCount = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.leaving === true) {
      ancestors.delete(current.value as object);
      continue;
    }
    nodeCount += 1;
    if (
      nodeCount > bounds.maxNodes
      || current.depth > bounds.maxDepth
    ) return false;
    if (
      current.value === null
      || typeof current.value === "string"
      || typeof current.value === "boolean"
    ) continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (typeof current.value !== "object" || ancestors.has(current.value)) return false;
    ancestors.add(current.value);
    pending.push({ ...current, leaving: true });
    if (Array.isArray(current.value)) {
      if (
        Object.getPrototypeOf(current.value) !== Array.prototype
        || current.value.length > bounds.maxNodes - nodeCount
      ) return false;
      const expectedKeys = new Set(["length"]);
      for (let index = 0; index < current.value.length; index += 1) {
        expectedKeys.add(String(index));
      }
      const keys = Reflect.ownKeys(current.value);
      if (
        keys.length !== current.value.length + 1
        || keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
      ) return false;
      for (let index = 0; index < current.value.length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
        if (descriptor?.enumerable !== true || !("value" in descriptor)) return false;
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(current.value);
    if (keys.length > bounds.maxNodes - nodeCount) return false;
    for (const key of keys) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      if (descriptor?.enumerable !== true || !("value" in descriptor)) return false;
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  try {
    const rendered = JSON.stringify(value);
    return rendered !== undefined
      && rendered.length <= bounds.maxUtf16;
  } catch {
    return false;
  }
}

function hasBoundedPlainJsonDeclaration(value: unknown): boolean {
  return hasBoundedPlainJsonValue(value, {
    maxDepth: CONVERSATION_TOOL_DECLARATION_MAX_DEPTH,
    maxNodes: CONVERSATION_TOOL_DECLARATION_MAX_NODES,
    maxUtf16: CONVERSATION_TOOL_DECLARATION_MAX_UTF16,
  });
}

export function bindModelTools(
  tools: ConversationTurnTools | undefined,
): Map<string, BoundConversationToolCapability> | null {
  try {
    const capabilities = tools?.modelTools ?? [];
    if (capabilities.length > MAX_MODEL_TOOL_CAPABILITIES) return null;
    const bound = new Map<string, BoundConversationToolCapability>();
    for (const capability of capabilities) {
      if (!hasBoundedPlainJsonDeclaration(capability.declaration.parameters)) return null;
      const declaration = ConversationToolDeclarationSchema.safeParse(capability.declaration);
      if (
        !declaration.success
        || declaration.data.name === FAMILY_MAP_TOOL_NAME
        || bound.has(declaration.data.name)
        || containsReservedTrustedScopeKey(capability.declaration.parameters)
        || typeof capability.inputSchema?.safeParse !== "function"
        || typeof capability.outputSchema?.safeParse !== "function"
        || typeof capability.classifyResult !== "function"
        || typeof capability.execute !== "function"
      ) return null;
      const inputSchema = capability.inputSchema;
      const outputSchema = capability.outputSchema;
      const parseInput = inputSchema.safeParse.bind(inputSchema) as BoundSafeParse;
      const parseOutput = outputSchema.safeParse.bind(outputSchema) as BoundSafeParse;
      const classifyResult = capability.classifyResult.bind(capability) as (
        output: ConversationToolJsonObject,
      ) => ConversationToolResultDisposition;
      const execute = capability.execute.bind(capability) as (
        input: ConversationToolJsonObject,
        context: ConversationToolExecutionContext,
      ) => Promise<unknown>;
      bound.set(declaration.data.name, Object.freeze({
        declaration: declaration.data,
        requiredBeforeReply: capability.requiredBeforeReply === true,
        inputSchema: capability.inputSchema as z.ZodType<ConversationToolJsonObject>,
        parseInput,
        parseOutput,
        classifyResult,
        execute,
      }));
    }
    return bound;
  } catch {
    return null;
  }
}

const RESERVED_TRUSTED_SCOPE_KEYS = new Set([
  "workspaceid",
  "actormemberid",
  "sourcemessageid",
]);

function isReservedTrustedScopeKey(key: string): boolean {
  return RESERVED_TRUSTED_SCOPE_KEYS.has(key.replace(/[^a-z0-9]/giu, "").toLowerCase());
}

function containsReservedTrustedScopeKey(value: unknown, ancestors = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (ancestors.has(value)) return true;
  ancestors.add(value);
  const reserved = Reflect.ownKeys(value).some((key) => {
    if (typeof key !== "string") return true;
    const nested = (value as Record<string, unknown>)[key];
    if (isReservedTrustedScopeKey(key)) return true;
    if (key === "$ref" && typeof nested === "string") {
      return nested.split("/").some((segment) => isReservedTrustedScopeKey(segment));
    }
    return containsReservedTrustedScopeKey(nested, ancestors);
  });
  ancestors.delete(value);
  return reserved;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    && hasBoundedPlainJsonValue(value, {
      maxDepth: CONVERSATION_TOOL_VALUE_MAX_DEPTH,
      maxNodes: CONVERSATION_TOOL_VALUE_MAX_NODES,
      maxUtf16: Number.MAX_SAFE_INTEGER,
    });
}

function isBoundedPlainJsonObject(value: unknown, maxUtf16: number): value is Record<string, unknown> {
  if (!isPlainJsonObject(value)) return false;
  try {
    return JSON.stringify(value).length <= maxUtf16;
  } catch {
    return false;
  }
}

type CanonicalJsonObjectSnapshot = {
  readonly serialized: string;
  readonly value: ConversationToolJsonObject;
};

export function canonicalJsonObjectSnapshot(
  value: unknown,
  maxUtf16: number,
): CanonicalJsonObjectSnapshot | null {
  if (
    !isBoundedPlainJsonObject(value, maxUtf16)
    || containsReservedTrustedScopeKey(value)
  ) return null;
  try {
    const serialized = JSON.stringify(value);
    const snapshot: unknown = JSON.parse(serialized);
    if (
      !isBoundedPlainJsonObject(snapshot, maxUtf16)
      || containsReservedTrustedScopeKey(snapshot)
    ) return null;
    return { serialized, value: snapshot as ConversationToolJsonObject };
  } catch {
    return null;
  }
}

export function cloneCanonicalSnapshot(snapshot: CanonicalJsonObjectSnapshot): ConversationToolJsonObject {
  return JSON.parse(snapshot.serialized) as ConversationToolJsonObject;
}

export function remainsValidAfterCallback(
  snapshot: CanonicalJsonObjectSnapshot,
  parse: BoundSafeParse,
  maxUtf16: number,
): boolean {
  if (canonicalJsonObjectSnapshot(snapshot.value, maxUtf16) === null) return false;
  try {
    const reparsed = parse(cloneCanonicalSnapshot(snapshot));
    return reparsed.success
      && canonicalJsonObjectSnapshot(reparsed.data, maxUtf16) !== null;
  } catch {
    return false;
  }
}

export function needsRelationshipTargetClarification(
  focalMessage: Message,
  context: ConversationContext,
): boolean {
  const normalizedBody = focalMessage.body.normalize("NFKC").trim().replace(/[.!。！]+$/u, "");
  const statedIdentity = /^(?:i am|i['’]m)\s+([\p{L}\p{M}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}'’.-]*){0,3})$/iu
    .exec(normalizedBody)?.[1];
  if (statedIdentity !== undefined) {
    let inNamedRelatives = false;
    let matches = 0;
    for (const rawLine of context.familyMap.content.split("\n")) {
      const line = rawLine.trim();
      if (line === "Named relatives") {
        inNamedRelatives = true;
        continue;
      }
      if (/^(?:Participants|Direct relationships|Members)$/u.test(line)) {
        inNamedRelatives = false;
        continue;
      }
      const entryName = inNamedRelatives ? /^-\s+(.+?)(?:\s+\(|$)/u.exec(line)?.[1] : undefined;
      if (entryName?.localeCompare(statedIdentity, undefined, { sensitivity: "base" }) === 0) matches += 1;
    }
    if (matches > 1) return true;
  }

  if (!/\b(?:(?:she|he)\s+is|they\s+are)\s+(?:my|our|the)\s+(?:mother|mom|father|dad|parent|sister|brother|daughter|son|grandmother|grandma|grandfather|grandpa|caregiver)\b/i.test(focalMessage.body)) {
    return false;
  }
  const observed = new Set(
    context.messages.flatMap((message) =>
      message.authorMemberId === "MEDBUDDY" ? [] : [message.authorMemberId],
    ),
  );
  for (const match of context.familyMap.content.matchAll(/\bmember:[A-Za-z0-9][A-Za-z0-9_-]{0,127}\b/g)) {
    observed.add(match[0] as never);
  }
  return observed.size > 1;
}

const FAMILY_RELATION_TERM = ENGLISH_FAMILY_RELATIONSHIP_TERM_PATTERN;
const FAMILY_PERSON_NAME = "[\\p{L}\\p{M}][\\p{L}\\p{M}'’.-]*(?:\\s+[\\p{L}\\p{M}][\\p{L}\\p{M}'’.-]*){0,3}";
const CJK_FAMILY_RELATION_TERM = CJK_FAMILY_RELATIONSHIP_TERM_PATTERN;
const CJK_PERSON_NAME = "[\\p{L}\\p{M}]{1,40}";
const CJK_PERSON_LIST = `${CJK_PERSON_NAME}(?:和${CJK_PERSON_NAME}){1,5}`;

/** Only the current attributed turn can grant the family-map write capability. */
export function focalAuthorizesFamilyMapUpdate(body: string): boolean {
  const normalized = body.normalize("NFKC").replace(/^\s*@\S+\s*/u, "").trim();
  const explicitCorrection = new RegExp(
    `^correction\\s*:\\s*${FAMILY_PERSON_NAME}\\s+(?:is|are)\\s+(?:(?:${FAMILY_PERSON_NAME})(?:['’]s)|my|our)\\s+(?:${FAMILY_RELATION_TERM})\\s*,\\s*not\\s+(?:(?:his|her|their|my|our)\\s+)?(?:${FAMILY_RELATION_TERM})[.!]?$`,
    "iu",
  ).test(normalized);
  if (explicitCorrection) return true;
  const unsafeAuthority = /[?¿]/u.test(normalized) ||
    /\b(?:who|whom|whose|what|which|whether)\b/iu.test(normalized) ||
    /^(?:please\s+)?(?:tell|show|explain)\b/iu.test(normalized) ||
    /^(?:is|are|am|do|does|did|can|could|would|should|will|have|has)\b/iu.test(normalized) ||
    /\b(?:not|no|never|don['’]?t|do\s+not|doesn['’]?t|does\s+not|unknown|unsure|uncertain|wonder|if|maybe|perhaps|possibly)\b/iu.test(normalized) ||
    /\b(?:not\s+sure|don['’]?t\s+know|do\s+not\s+know)\b/iu.test(normalized) ||
    /(?:誰|谁|什麼|什么|哪(?:個|个|位)?|是否|是不是|嗎|吗|呢|不確定|不知道|だれ|誰|ですか|ますか|누구|인가요|나요)/u.test(normalized);
  if (unsafeAuthority) return false;

  const statement = normalized.replace(/[.!。！]+$/u, "").trim();
  const explicitCjkRelationshipList = new RegExp(
    `^(?:我的|我們的)(?:${CJK_FAMILY_RELATION_TERM})是${CJK_PERSON_LIST}$`,
    "u",
  ).test(statement);
  const explicitCjkCompoundDeclaration = new RegExp(
    `^我是${CJK_PERSON_NAME}[,，]是${CJK_PERSON_NAME}的(?:${CJK_FAMILY_RELATION_TERM})[,，]也是${CJK_PERSON_LIST}的(?:${CJK_FAMILY_RELATION_TERM})$`,
    "u",
  ).test(statement);
  if (explicitCjkRelationshipList || explicitCjkCompoundDeclaration) return true;
  if (/^(?:please\s+)?(?:remember|forget|remove|delete|clear|correct|update)\s+(?:(?:the|my|our|this\s+chat['’]s)\s+)?(?:family\s+map|family\s+(?:name|relationship|member)|direct\s+relationship|relationship|relative|member|person)$/iu.test(statement) ||
      new RegExp(`^(?:please\\s+)?remember\\s+(?:the\\s+)?family\\s+name\\s+${FAMILY_PERSON_NAME}$`, "iu").test(statement) ||
      /^(?:please\s+)?forget\s+everything\s+in\s+(?:the|my|our|this\s+chat['’]s)\s+family\s+map$/iu.test(statement) ||
      new RegExp(`^(?:please\\s+)?forget\\s+that\\s+${FAMILY_PERSON_NAME}\\s+(?:is|are)\\s+(?:(?:${FAMILY_PERSON_NAME})(?:['’]s)|my|our)\\s+(?:${FAMILY_RELATION_TERM})$`, "iu").test(statement) ||
      new RegExp(`^(?:please\\s+)?(?:forget|remove|delete|clear|correct|update)\\s+(?:(?:the|my|our)\\s+)?(?:${FAMILY_RELATION_TERM})$`, "iu").test(statement) ||
      /^(?:請)?(?:記住|忘記|清除|刪除|更正)(?:這個|我的|我們的)?(?:家人|家庭地圖|家庭關係|關係|名字|成員)$/u.test(statement)) {
    return true;
  }

  return statement.split(/[.!。！]+/u).some((rawClause) => {
    const clause = rawClause.trim();
    const englishClause = clause.replace(/^(?:actually|correction)\s*[:,]?\s*/iu, "");
    const informalIdentity = /^(?:i am|i['’]m)\s+(.+)$/iu.exec(englishClause);
    const explicitNameIntroduction = new RegExp(`^(?:my name is|call me)\\s+${FAMILY_PERSON_NAME}$`, "iu").test(englishClause) ||
      (informalIdentity !== null && new RegExp(`^\\p{Lu}[\\p{L}\\p{M}'’.-]*(?:\\s+\\p{Lu}[\\p{L}\\p{M}'’.-]*){0,3}$`, "u").test(informalIdentity[1]!));
    return explicitNameIntroduction ||
      new RegExp(`^${FAMILY_PERSON_NAME}\\s+(?:is|are)\\s+(?:(?:${FAMILY_PERSON_NAME})(?:['’]s)|my|our)\\s+(?:${FAMILY_RELATION_TERM})$`, "iu").test(englishClause) ||
      new RegExp(`^(?:my|our)\\s+(?:${FAMILY_RELATION_TERM})\\s+(?:is|are)\\s+${FAMILY_PERSON_NAME}$`, "iu").test(englishClause) ||
      /^我是[\p{L}\p{M}]{1,40}$/u.test(clause) ||
      /^[\p{L}\p{M}]{1,40}是[\p{L}\p{M}]{1,40}的(?:媽媽|母親|爸爸|父親|姊姊|姐姐|妹妹|哥哥|弟弟|女兒|兒子|祖母|祖父|阿姨|叔叔|照顧者)$/u.test(clause);
  });
}

export function focalRequiresFamilyMapUpdate(body: string): boolean {
  const normalized = body.normalize("NFKC").replace(/^\s*@\S+\s*/u, "").trim();
  return /^(?:please\s+)?(?:forget|remove|delete|clear|correct|update)\b/iu.test(normalized)
    || /^correction\s*:/iu.test(normalized)
    || /^(?:請)?(?:忘記|清除|刪除|更正)/u.test(normalized);
}

export function renderLookup(result: MedicationLookupRenderResult): string {
  if (result.kind === "UNSUPPORTED") {
    return result.text;
  }

  return result.cards.flatMap((card) => [
    `Here is general source-card information for ${card.displayName}.`,
    ...card.claims.map((claim) => claim.text),
    ...card.claims.map(
      (claim) =>
        `Source: ${claim.sourceOrganization} (${claim.sourceUrl}; retrieved ${claim.retrievedAt}; snapshot ${claim.snapshotVersion}).`,
    ),
    ...card.limitations,
  ]).join("\n");
}
