# ADR-0004: Expand the Family Map to Explicitly Named Relatives

**Status:** Accepted
**Date:** 2026-08-04

## Context

Initially, maps allowed stored people and relationship targets only if they were
observed LINE participants. In a live fictionalized verification, a participant
named two sons. MedBuddy did not retain them because neither had sent a LINE
message. A later turn could not derive that they were siblings, although the
direct parent-child statement was still in recent context. The map also drifted
into compact identifier assignments instead of a readable family summary.

The existing persistence seam stores one bounded raw-text replacement and
allows names without participant IDs. Domain language and model instructions,
not the Firestore contract, imposed the restriction.

## Decision

Treat each explicitly identified person as a workspace person. Observed
participants have opaque member bindings. Named relatives can have no LINE
identity. Store only direct, explicitly stated relationships between either
kind. Derive indirect relationships only for conversation.

Each non-empty map has these sections, in order: `Participants`, `Named
relatives`, and `Direct relationships`. It remains one current raw-text
document with the existing replacement tool, revision checks, 4,000-character
limit, and workspace isolation.

A join event or greeting does not link a participant to a name-only relative.
An attributed identity statement or a uniquely resolving direct-relationship
statement can link them. Ambiguous matches require clarification.

## Consequences

- MedBuddy can retain named relatives who never participate in LINE. It can
  answer derived sibling or grandparent questions after recent messages expire.
- Participant identity stays opaque and workspace-local. Named relatives gain
  no authorization or medical authority.
- The model-visible tool and Firestore document schema do not expand.
- Prompts and evaluation enforce the readable organization. The prototype does
  not parse it into a relationship ontology.
- Existing maps are not replayed or migrated. Their next explicit replacement
  normalizes them into the readable organization.

The complete behavior remains specified in
[`../proposals/WORKSPACE_FAMILY_MAP_DESIGN.md`](../proposals/WORKSPACE_FAMILY_MAP_DESIGN.md).
