# ADR-0002: Deliver a LINE-First Conversational Prototype

> **Follow-up:** ADR-0003 adds the first bounded memory/tool increment: one
> workspace family map and one server-bound replacement tool. The other
> deferrals below still apply.

## Status

Accepted; supersedes ADR-0001 for channel and delivery sequence.

## Date

2026-08-03

## Context

ADR-0001 selected Telegram and sequenced structured capture, consent, review, and visit briefs before richer conversation. The current product direction instead tests whether a general conversational agent is useful in the users' existing communication channel. LINE is the first live channel. Live credentials must not block a synthetic end-to-end proof.

## Decision

- Deliver LINE DM/group text conversation first.
- Map one external conversation to one opaque, isolated workspace.
- Use direct LINE HTTPS adapters and the existing Vertex boundary.
- Reply to all eligible DM text and only explicit bot mentions in groups/rooms.
- Keep deterministic medical-decision refusal in code.
- Defer memory, tools, specialized medical behavior, attachments, and structured care workflows.

## Consequences

The Telegram specification is historical, not executable. Existing care-record and capture modules remain available but are not on the critical path. The first production limitation is at-most-once claimed-event processing: a crash after a claim can lose a reply, but duplicate replies are prevented. Add durable recovery only after the conversation loop proves useful.
