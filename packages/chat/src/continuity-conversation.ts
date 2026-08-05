import { createHash } from "node:crypto";

import {
  AssembledContextSchema,
  AcceptContinuityResponseInputSchema,
  CompactionJobSchema,
  CONTINUITY_POLICIES,
  type ContinuityConversation,
  type ContinuityRepository,
  type ContinuityTaskDispatcher,
  type ContinuityPolicy,
  MessageSchema,
  type MessageRepository,
  ObserveContinuityConversationInputSchema,
  type ObserveContinuityConversationInput,
  type ObserveContinuityConversationResult,
  OutboundCandidateSchema,
  type ConversationResponder,
  type WorkspaceFamilyMapRepository,
} from "@medbuddy/contracts";

import { assembleConversationContext } from "./conversation-continuity.js";
import { planHigherLevelCompaction, planLevelOneCompaction } from "./compaction.js";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Observes source evidence before deciding whether to reply. Delivery remains
 * a separate acceptance step so rejected LINE text never becomes evidence.
 */
export class ContinuityThreadConversationService implements ContinuityConversation {
  constructor(private readonly dependencies: {
    continuity: ContinuityRepository;
    messages: MessageRepository;
    familyMaps: WorkspaceFamilyMapRepository;
    responder: ConversationResponder;
    systemInstructions: string;
    policy?: ContinuityPolicy;
    dispatcher?: ContinuityTaskDispatcher;
    now?: () => string;
  }) {}

  async observe(inputValue: ObserveContinuityConversationInput): Promise<ObserveContinuityConversationResult> {
    const input = ObserveContinuityConversationInputSchema.parse(inputValue);
    const accepted = await this.dependencies.continuity.acceptSourceEvent({
      receiptKey: input.receiptKey,
      id: input.sourceEventId,
      workspaceId: input.workspaceId,
      occurredAt: input.occurredAt,
      acceptedAt: input.acceptedAt,
      ...(input.providerMessageId === undefined ? {} : { providerMessageId: input.providerMessageId }),
      authorMemberId: input.authorMemberId,
      payload: input.payload,
    });
    if (accepted.kind === "DUPLICATE") return { kind: "DUPLICATE" };

    if (input.payload.kind === "TEXT" && input.providerMessageId !== undefined) {
      await this.dependencies.messages.putMessage({
        id: input.providerMessageId,
        workspaceId: input.workspaceId,
        authorMemberId: input.authorMemberId,
        body: input.payload.body,
        createdAt: input.occurredAt,
        attachmentIds: [],
        captureIntent: "PASSIVE",
        processingStatus: "IGNORED",
        processingAttempts: 0,
      });
    }
    if (input.payload.kind === "ATTACHMENT") {
      await this.dependencies.continuity.putAttachment({
        id: input.payload.attachmentId,
        workspaceId: input.workspaceId,
        sourceEventId: accepted.event.id,
        mediaClass: input.payload.mediaClass,
        state: input.payload.mediaClass === "OTHER" ? "FAILED" : "PENDING",
        attempts: 0,
      });
    }
    await this.scheduleWithoutBlocking(input.workspaceId);
    if (input.payload.kind !== "TEXT" || !input.payload.replyRequested || input.providerMessageId === undefined) {
      return { kind: "OBSERVED", sourceEventId: accepted.event.id };
    }

    const [sources, readySegments, familyMap, activeJob] = await Promise.all([
      this.dependencies.continuity.listSourceEvents(input.workspaceId),
      this.dependencies.continuity.listReadySegments(input.workspaceId),
      this.dependencies.familyMaps.get(input.workspaceId),
      this.dependencies.continuity.getActiveCompactionJob(input.workspaceId),
    ]);
    const attachmentIds = [...new Set(sources.flatMap((event) =>
      event.payload.kind === "ATTACHMENT" ? [event.payload.attachmentId] : []))];
    const attachments = (await Promise.all(attachmentIds.map((attachmentId) =>
      this.dependencies.continuity.getAttachment(input.workspaceId, attachmentId))))
      .filter((attachment) => attachment !== null);
    const assembled = assembleConversationContext({
      workspaceId: input.workspaceId,
      focalSourceEventId: accepted.event.id,
      sourceEvents: sources,
      attachments,
      readySegments,
      familyMap,
      system: this.dependencies.systemInstructions,
      compactionPending: activeJob !== null,
      policy: this.dependencies.policy ?? CONTINUITY_POLICIES.production,
    });
    const assembledContext = AssembledContextSchema.parse({
      workspaceId: assembled.workspaceId,
      focalSourceEventId: assembled.focalSourceEventId,
      system: assembled.system,
      familyMap: assembled.familyMap,
      agentActions: assembled.agentActions,
      history: assembled.history,
      recentConversation: assembled.recentConversation,
      omittedSourceEventCount: assembled.omittedSourceEventCount,
    });
    const focalMessage = MessageSchema.parse({
      id: input.providerMessageId,
      workspaceId: input.workspaceId,
      authorMemberId: input.authorMemberId,
      body: input.payload.body,
      createdAt: input.occurredAt,
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "IGNORED",
      processingAttempts: 0,
      revision: accepted.event.sourceSequence,
    });
    const response = await this.dependencies.responder.respond({
      messageId: focalMessage.id,
      context: {
        workspaceId: input.workspaceId,
        messages: [focalMessage],
        familyMap: {
          workspaceId: familyMap.workspaceId,
          content: familyMap.content,
          revision: familyMap.revision,
        },
        assembledContext,
      },
    }, {
      updateWorkspaceFamilyMap: {
        update: (update) => this.dependencies.familyMaps.replace({
          workspaceId: input.workspaceId,
          actorMemberId: input.authorMemberId,
          sourceMessageId: input.providerMessageId!,
          expectedRevision: update.expectedRevision,
          content: update.content,
          updatedAt: input.acceptedAt,
        }),
      },
    });
    if (response.kind === "TECHNICAL_FAILURE" || response.responseText === undefined) {
      return { kind: "TECHNICAL_FAILURE", sourceEventId: accepted.event.id };
    }
    const candidateId = OutboundCandidateSchema.shape.id.parse(
      `outbound-candidate:${digest(`${input.workspaceId}\u0000${accepted.event.id}`)}`,
    );
    const candidate = await this.dependencies.continuity.createOutboundCandidate({
      id: candidateId,
      workspaceId: input.workspaceId,
      focalSourceEventId: accepted.event.id,
      body: response.responseText,
      createdAt: input.acceptedAt,
      state: "PENDING",
    });
    return {
      kind: "RESPONSE_CANDIDATE",
      sourceEventId: accepted.event.id,
      candidateId: candidate.id,
      responseText: candidate.body,
    };
  }

  async acceptDeliveredResponse(inputValue: Parameters<ContinuityConversation["acceptDeliveredResponse"]>[0]): Promise<void> {
    const input = AcceptContinuityResponseInputSchema.parse(inputValue);
    const event = await this.dependencies.continuity.publishOutboundCandidate(
      input.workspaceId,
      input.candidateId,
      input.acceptedAt,
    );
    if (event.payload.kind !== "TEXT" || event.providerMessageId === undefined) {
      throw new Error("Published outbound source evidence is malformed.");
    }
    await this.dependencies.messages.putMessage({
      id: event.providerMessageId,
      workspaceId: event.workspaceId,
      authorMemberId: "MEDBUDDY",
      body: event.payload.body,
      createdAt: event.acceptedAt,
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "IGNORED",
      processingAttempts: 0,
    });
    await this.scheduleWithoutBlocking(input.workspaceId);
  }

  private async scheduleWithoutBlocking(workspaceId: ObserveContinuityConversationInput["workspaceId"]): Promise<void> {
    if (this.dependencies.dispatcher === undefined) return;
    try {
      const active = await this.dependencies.continuity.getActiveCompactionJob(workspaceId);
      if (active !== null) {
        await this.dependencies.dispatcher.dispatch({ workspaceId, jobId: active.id });
        return;
      }
      const [sources, ready] = await Promise.all([
        this.dependencies.continuity.listSourceEvents(workspaceId),
        this.dependencies.continuity.listReadySegments(workspaceId),
      ]);
      const policy = this.dependencies.policy ?? CONTINUITY_POLICIES.production;
      const plan = planLevelOneCompaction(workspaceId, sources, ready, policy)
        ?? planHigherLevelCompaction(workspaceId, ready, policy);
      if (plan === null) return;
      const job = await this.dependencies.continuity.claimCompactionJob(CompactionJobSchema.parse({
        id: plan.id,
        workspaceId,
        level: plan.level,
        firstSourceSequence: plan.firstSourceSequence,
        lastSourceSequence: plan.lastSourceSequence,
        orderedSourceDigest: plan.orderedSourceDigest,
        childSegmentIds: plan.childSegmentIds,
        policyVersion: plan.policyVersion,
        status: "PENDING",
        attempts: 0,
        createdAt: this.dependencies.now?.() ?? new Date().toISOString(),
      }));
      await this.dependencies.dispatcher.dispatch({ workspaceId, jobId: job.id });
    } catch {
      // Durable state or the next source event retries scheduling; replies continue.
    }
  }
}
