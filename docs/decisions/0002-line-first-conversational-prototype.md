# ADR-0002: Deliver a LINE-First Conversational Prototype

> **Follow-up:** ADR-0003 implements the first bounded memory/tool increment: one
> workspace family map and one server-bound replacement tool. The broader
> deferrals below remain in force.

## Status

Accepted; supersedes ADR-0001 for channel and delivery sequence.

## Date

2026-08-03

## Context

ADR-0001 selected Telegram and sequenced structured capture, consent, review, and visit briefs before richer conversation. The latest product direction instead prioritizes learning whether a general conversational agent is useful in the communication channel the intended users already use. LINE is now the first live channel, and live credentials should not block a synthetic end-to-end proof.

## Decision

- Deliver LINE DM/group text conversation first.
- Map one external conversation to one opaque, isolated workspace.
- Use direct LINE HTTPS adapters and the existing Vertex boundary.
- Reply to all eligible DM text and only explicit bot mentions in groups/rooms.
- Keep deterministic medical-decision refusal in code.
- Defer memory, tools, specialized medical behavior, attachments, and structured care workflows.

## Consequences

The Telegram spec is historical rather than executable. Existing care-record and capture modules remain available but are not on the critical path. The first production limitation is at-most-once claimed event processing: a crash after claim may lose a reply, while duplicate replies are prevented. A durable recovery design can be added only after the conversation loop proves useful.
