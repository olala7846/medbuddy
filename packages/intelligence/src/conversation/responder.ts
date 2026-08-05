import {
  ConversationTurnRequestSchema,
  type ConversationContext,
  type ConversationTurnRequest,
  type ConversationResponder as ConversationResponderPort,
  type ConversationResult,
  type ConversationTurnTools,
  type ConversationTelemetryEntry,
  type ConversationTelemetryLogger,
  type MedicationGrounding,
  type Message,
  UpdateWorkspaceFamilyMapInputSchema,
} from "@medbuddy/contracts";
import { z } from "zod";

import { type MedicationLookupRenderResult } from "../grounding/render.js";
import {
  routeDiagnosisOrPrescribingRequest,
  routeMedicationDecision,
} from "../safety/route.js";
import { lookupMedication } from "./tools.js";

export const ConversationInstructionSchema = z.union([
  z.object({ kind: z.literal("ACKNOWLEDGE") }).strict(),
  z.object({
    kind: z.literal("REPLY"),
    text: z.string().trim().min(1).max(5_000),
  }).strict(),
  z.object({
    kind: z.literal("LOOKUP_MEDICATION"),
    query: z.object({
      medicationCode: z.string().trim().min(1).optional(),
      displayName: z.string().trim().min(1).optional(),
    }).strict().refine(
      (query) => query.medicationCode !== undefined || query.displayName !== undefined,
      "A medication lookup needs a code or display name.",
    ),
  }).strict(),
  z.object({
    kind: z.literal("UPDATE_WORKSPACE_FAMILY_MAP"),
    input: UpdateWorkspaceFamilyMapInputSchema,
    continuation: z.unknown().optional(),
  }).strict(),
]);

type ConversationInstruction = z.infer<typeof ConversationInstructionSchema>;

export class ConversationProviderError extends Error {
  constructor(
    readonly code: "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "MALFORMED_TRANSPORT",
  ) {
    super(code);
  }
}

/** A provider may return bounded prose, but deterministic safety routes run first. */
export interface ConversationProvider {
  respond(input: {
    focalMessage: Message;
    context: ConversationContext;
    toolResult?: unknown;
    toolHistory?: readonly unknown[];
    familyMapUpdatesAllowed?: boolean;
    familyMapUpdateRequired?: boolean;
  }): Promise<unknown>;
}

/** Deterministic fixture adapter; it makes no network or live-model calls. */
export class FixedConversationProvider implements ConversationProvider {
  readonly requests: Parameters<ConversationProvider["respond"]>[0][] = [];

  constructor(private readonly outputs: ReadonlyMap<Message["id"], unknown>) {}

  async respond(input: Parameters<ConversationProvider["respond"]>[0]): Promise<unknown> {
    this.requests.push(input);
    const output = this.outputs.get(input.focalMessage.id) ?? { kind: "ACKNOWLEDGE" };
    if (output instanceof Error) {
      throw output;
    }
    if (Array.isArray(output)) {
      return output[this.requests.filter(
        (request) => request.focalMessage.id === input.focalMessage.id,
      ).length - 1];
    }
    return output;
  }
}

const acknowledgmentText =
  "Thanks for sharing. I can help record what you observed or show general information from a supplied medication source card.";

export const FAMILY_MAP_UPDATE_FAILURE_TEXT =
  "I couldn’t save that family-map change. Please try again.";
export const AMBIGUOUS_RELATIONSHIP_CLARIFICATION_TEXT =
  "Which observed member do you mean? Please name them before I update this chat’s family map.";

function needsRelationshipTargetClarification(
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

const FAMILY_RELATION_TERM = "mother|mom|father|dad|parent|sister|brother|daughter|son|child|grandmother|grandma|grandfather|grandpa|aunt|uncle|wife|husband|spouse|caregiver";
const FAMILY_PERSON_NAME = "[\\p{L}\\p{M}][\\p{L}\\p{M}'’.-]*(?:\\s+[\\p{L}\\p{M}][\\p{L}\\p{M}'’.-]*){0,3}";
const CJK_FAMILY_RELATION_TERM = "媽媽|母親|爸爸|父親|姊姊|姐姐|妹妹|哥哥|弟弟|女兒|兒子|孩子|祖母|祖父|阿姨|叔叔|妻子|丈夫|配偶|照顧者";
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

function focalRequiresFamilyMapUpdate(body: string): boolean {
  const normalized = body.normalize("NFKC").replace(/^\s*@\S+\s*/u, "").trim();
  return /^(?:please\s+)?(?:forget|remove|delete|clear|correct|update)\b/iu.test(normalized)
    || /^correction\s*:/iu.test(normalized)
    || /^(?:請)?(?:忘記|清除|刪除|更正)/u.test(normalized);
}

function renderLookup(result: MedicationLookupRenderResult): string {
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

function technicalFailure(toolCalls?: number): ConversationResult {
  return toolCalls === undefined
    ? { kind: "TECHNICAL_FAILURE", retryable: true }
    : { kind: "TECHNICAL_FAILURE", retryable: true, toolCalls };
}

function characterCountClass(content: string): "EMPTY" | "SHORT" | "MEDIUM" | "LARGE" {
  const count = [...content].length;
  if (count === 0) return "EMPTY";
  if (count <= 500) return "SHORT";
  if (count <= 2_000) return "MEDIUM";
  return "LARGE";
}

/**
 * Handles a Chat-supplied, bounded conversation turn without canonical writes.
 * Diagnosis, prescribing, and medication decisions are rejected before provider
 * invocation; source-card medication prose is deterministically rendered.
 */
export class ConversationResponder implements ConversationResponderPort {
  constructor(
    private readonly grounding: MedicationGrounding,
    private readonly provider: ConversationProvider,
    private readonly turnTimeoutMs = 25_000,
    private readonly telemetry?: ConversationTelemetryLogger,
  ) {}

  async respond(input: ConversationTurnRequest, tools?: ConversationTurnTools): Promise<ConversationResult> {
    const request = ConversationTurnRequestSchema.safeParse(input);
    if (!request.success) {
      return technicalFailure();
    }

    const focalMessage = request.data.context.messages.find(
      (message) => message.id === request.data.messageId,
    );
    if (focalMessage === undefined) {
      return technicalFailure();
    }

    const refusal = routeDiagnosisOrPrescribingRequest(focalMessage)
      ?? routeMedicationDecision(focalMessage);
    if (refusal !== null) {
      return {
        kind: refusal.kind,
        responseText: refusal.responseText,
        retryable: refusal.retryable,
      };
    }
    if (needsRelationshipTargetClarification(focalMessage, request.data.context)) {
      return {
        kind: "RESPONDED",
        responseText: AMBIGUOUS_RELATIONSHIP_CLARIFICATION_TEXT,
        retryable: false,
        toolCalls: 0,
      };
    }

    try {
      const deadline = Date.now() + this.turnTimeoutMs;
      const focalAllowsFamilyMapUpdate = focalAuthorizesFamilyMapUpdate(focalMessage.body);
      const focalRequiresFamilyMapTool = focalRequiresFamilyMapUpdate(focalMessage.body);
      let toolCalls = 0;
      let retryAfterConflict = false;
      let terminalToolFailure = false;
      let toolResult: unknown;
      const toolHistory: unknown[] = [];
      for (let modelStep = 0; modelStep < 3; modelStep += 1) {
        let output: unknown;
        try {
          output = await this.beforeDeadline(() => this.provider.respond({
            focalMessage,
            context: request.data.context,
            toolResult,
            toolHistory: [...toolHistory],
            familyMapUpdatesAllowed: focalAllowsFamilyMapUpdate && (toolCalls === 0 || retryAfterConflict),
            familyMapUpdateRequired: focalRequiresFamilyMapTool,
          }), deadline);
        } catch (error) {
          if (!terminalToolFailure) throw error;
          this.log({ event: "conversation_tool_loop_completed", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return {
            kind: "RESPONDED",
            responseText: FAMILY_MAP_UPDATE_FAILURE_TEXT,
            retryable: false,
            toolCalls,
          };
        }
        if (terminalToolFailure) {
          this.log({ event: "conversation_tool_loop_completed", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return {
            kind: "RESPONDED",
            responseText: FAMILY_MAP_UPDATE_FAILURE_TEXT,
            retryable: false,
            toolCalls,
          };
        }
        const instruction = ConversationInstructionSchema.safeParse(output);
        if (!instruction.success) {
          this.log({ event: "conversation_tool_loop_exhausted", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return technicalFailure(toolCalls || undefined);
        }
        if (instruction.data.kind !== "UPDATE_WORKSPACE_FAMILY_MAP") {
          const response = await this.respondToInstruction(instruction.data);
          this.log({ event: "conversation_tool_loop_completed", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return toolCalls === 0 ? response : { ...response, toolCalls };
        }
        if (!focalAllowsFamilyMapUpdate || tools === undefined || terminalToolFailure || (toolCalls > 0 && !retryAfterConflict)) {
          this.log({ event: "conversation_tool_loop_exhausted", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return technicalFailure(toolCalls || undefined);
        }
        toolCalls += 1;
        const updateInput = instruction.data.input;
        this.log({
          event: "family_map_tool_requested",
          priorRevision: updateInput.expectedRevision,
          characterCountClass: characterCountClass(updateInput.content),
          toolAttemptCount: toolCalls,
          modelStepCount: modelStep + 1,
        });
        const result = await this.beforeDeadline(
          () => tools.updateWorkspaceFamilyMap.update(updateInput),
          deadline,
        );
        if (result.kind === "REJECTED" || result.kind === "TECHNICAL_FAILURE") {
          terminalToolFailure = true;
          retryAfterConflict = false;
          toolResult = { call: updateInput, result, continuation: instruction.data.continuation };
          toolHistory.push(toolResult);
          this.log({
            event: result.kind === "REJECTED" ? "family_map_rejected" : "family_map_failed",
            outcome: result.kind === "REJECTED" ? result.code : "TECHNICAL_FAILURE",
            priorRevision: updateInput.expectedRevision,
            characterCountClass: characterCountClass(updateInput.content),
            toolAttemptCount: toolCalls,
            modelStepCount: modelStep + 1,
          });
          continue;
        }
        if (result.kind === "REVISION_CONFLICT") {
          if (toolCalls > 1) return technicalFailure(toolCalls);
          retryAfterConflict = true;
          toolResult = { call: updateInput, result, continuation: instruction.data.continuation };
          toolHistory.push(toolResult);
          this.log({ event: "family_map_revision_conflict", priorRevision: updateInput.expectedRevision, resultingRevision: result.familyMap.revision, toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          continue;
        }
        retryAfterConflict = false;
        toolResult = { call: updateInput, result, continuation: instruction.data.continuation };
        toolHistory.push(toolResult);
        this.log({
          event: result.kind === "UPDATED" ? "family_map_updated" : "family_map_no_change",
          priorRevision: updateInput.expectedRevision,
          resultingRevision: result.familyMap.revision,
          characterCountClass: characterCountClass(result.familyMap.content),
          toolAttemptCount: toolCalls,
          modelStepCount: modelStep + 1,
        });
      }
      this.log({ event: "conversation_tool_loop_exhausted", toolAttemptCount: toolCalls, modelStepCount: 3 });
      return technicalFailure(toolCalls);
    } catch {
      return technicalFailure();
    }
  }

  private log(entry: ConversationTelemetryEntry): void {
    this.telemetry?.write(entry);
  }

  private async beforeDeadline<Value>(operation: () => Promise<Value>, deadline: number): Promise<Value> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new ConversationProviderError("PROVIDER_TIMEOUT");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new ConversationProviderError("PROVIDER_TIMEOUT")),
            remainingMs,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async respondToInstruction(instruction: ConversationInstruction): Promise<ConversationResult> {
    if (instruction.kind === "ACKNOWLEDGE") {
      return { kind: "RESPONDED", responseText: acknowledgmentText, retryable: false };
    }
    if (instruction.kind === "REPLY") {
      return { kind: "RESPONDED", responseText: instruction.text, retryable: false };
    }

    if (instruction.kind === "LOOKUP_MEDICATION") return {
      kind: "RESPONDED",
      responseText: renderLookup(await lookupMedication(this.grounding, instruction.query)),
      retryable: false,
    };
    return technicalFailure();
  }
}
