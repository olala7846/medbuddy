# ADR-0003: Add One Bounded Workspace Family Map

**Status:** Accepted and implemented
**Date:** 2026-08-04

> **Amended by ADR-0004:** named relatives no longer need to be observed LINE
> participants. The bounded raw-text tool and storage contract remain.

## Context

The LINE loop works. With only recent messages, the agent uses impersonal
labels and cannot reliably interpret terms such as “Mom.” General profiles,
relationship graphs, or medical memory add policy and safety surface before the
value is proven.

## Decision

Store one current raw-text family map per isolated LINE workspace. The model
receives it with attributed recent messages. It can replace it only with the
server-bound `update_workspace_family_map` tool. Chat binds workspace, actor,
and source-message identity. The model supplies only expected revision and full
replacement content. Firestore and in-memory adapters enforce a 4,000-character
limit, source validation, and compare-and-set revisions.

The initial map recorded direct relationships explicitly stated among observed
members. It is not a reviewed care record, grants no authority, and deterministic
medical refusal never uses it.

## Consequences

- Groups and DMs use one workspace-scoped model. Identity cannot cross chats.
- An observed participant can correct or clear the map through ordinary language.
- There is no history, undo, roster lookup, relationship ontology, or general
  multi-tool runtime.
- Defer rolling continuity, retrieval, extra tools, and stronger semantic
  validation.

See [`../proposals/WORKSPACE_FAMILY_MAP_DESIGN.md`](../proposals/WORKSPACE_FAMILY_MAP_DESIGN.md)
for the full behavioral and verification contract.
