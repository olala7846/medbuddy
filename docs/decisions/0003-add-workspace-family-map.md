# ADR-0003: Add One Bounded Workspace Family Map

**Status:** Accepted and implemented
**Date:** 2026-08-04

## Context

The LINE conversation loop works, but an agent that sees only recent messages
repeatedly falls back to impersonal labels and cannot consistently interpret
relative terms such as “Mom.” A general profile, relationship graph, or medical
memory would add policy and safety surface before the value is proven.

## Decision

Store one current, raw-text family map per isolated LINE workspace. The model
receives that map with attributed recent messages and may replace it through one
server-bound `update_workspace_family_map` tool. Chat binds workspace, actor,
and source-message identity; the model supplies only expected revision and the
complete replacement content. Firestore and in-memory adapters enforce a
4,000-character limit, source validation, and compare-and-set revisions.

The map records explicitly stated direct relationships among observed members.
It is not a reviewed care record, cannot grant authority, and is never consulted
by deterministic medical refusal.

## Consequences

- Groups and DMs share one workspace-scoped model without cross-chat identity.
- Any observed member may correct or clear the map through ordinary language.
- There is no history, undo, roster lookup, relationship ontology, or general
  multi-tool runtime.
- Rolling continuity, retrieval, extra tools, and stronger semantic validation
  remain later efforts.

The complete behavioral and verification contract is in
[`../proposals/WORKSPACE_FAMILY_MAP_DESIGN.md`](../proposals/WORKSPACE_FAMILY_MAP_DESIGN.md).
