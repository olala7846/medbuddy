import {
  AcceptedFormationEventSchema,
  formationRenderedUtf16,
  type AcceptedFormationEvent,
  type SourceEvent,
} from "@medbuddy/contracts";

/** Mechanical metadata projection executed inside trusted source acceptance. */
export function acceptedFormationEventForSource(event: SourceEvent): AcceptedFormationEvent {
  if (event.payload.kind === "TEXT" && event.authorMemberId !== "MEDBUDDY") {
    const evidence = {
      workspaceId: event.workspaceId,
      canonicalSourceRef: event.id,
      canonicalSource: event,
      sourceSequence: event.sourceSequence,
      providerMessageId: event.providerMessageId!,
      authorMemberId: event.authorMemberId,
      effectiveText: event.payload.body,
      sourceKind: "TEXT",
      lineageSourceRefs: [event.id],
      acceptedAt: event.acceptedAt,
    };
    return AcceptedFormationEventSchema.parse({
      workspaceId: event.workspaceId, sourceEventId: event.id, sourceSequence: event.sourceSequence,
      acceptedAt: event.acceptedAt, kind: "ELIGIBLE_HUMAN_TEXT",
      renderedUtf16: formationRenderedUtf16([evidence]),
    });
  }
  return AcceptedFormationEventSchema.parse({
    workspaceId: event.workspaceId, sourceEventId: event.id, sourceSequence: event.sourceSequence,
    acceptedAt: event.acceptedAt,
    kind: event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND" ? "LIFECYCLE" : "EXCLUDED",
    renderedUtf16: 0,
  });
}
