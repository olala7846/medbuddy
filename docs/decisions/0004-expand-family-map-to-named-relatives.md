# ADR-0004: Expand the Family Map to Explicitly Named Relatives

**Status:** Accepted
**Date:** 2026-08-04

## Context

The first workspace family map restricted every stored person and relationship
target to an observed LINE participant. In a live fictionalized verification
shape, a participant explicitly named two sons, but MedBuddy refused to retain
them because neither son had sent a LINE message. A later turn therefore failed
to derive that the sons were siblings even though the explicit parent-child
statement remained in recent context. The raw map also drifted into compact
identifier assignments rather than the readable family summary the product
intended.

The persistence seam already stores one bounded raw-text replacement and does
not require a participant ID for every name. The restriction existed in domain
language and model instructions rather than the Firestore contract.

## Decision

Treat every explicitly identified person in one workspace as a workspace
person. An observed participant has an opaque member binding; an explicitly
named relative may have no LINE identity. Store direct, explicitly stated
relationships between either kind and derive indirect relationships only for
conversation.

Every non-empty map uses three human-readable sections in order:
`Participants`, `Named relatives`, and `Direct relationships`. The map remains
one current raw-text document with the existing replacement tool, revision
checks, 4,000-character limit, and workspace isolation.

A join event or greeting never links a participant to a name-only relative.
An attributed identity statement or uniquely resolving direct-relationship
statement may link them; ambiguous matches require clarification.

## Consequences

- MedBuddy can remember named relatives who never participate in LINE and can
  answer derived sibling or grandparent questions after recent messages expire.
- Participant identity remains workspace-local and opaque; named relatives do
  not gain authorization or medical authority.
- The model-visible tool and Firestore document schema do not expand.
- Readable organization is prompt- and evaluation-enforced rather than parsed
  into a relationship ontology in this prototype.
- Existing maps are not replayed or migrated. Their next explicit replacement
  normalizes them into the readable organization.

The complete behavior remains specified in
[`../proposals/WORKSPACE_FAMILY_MAP_DESIGN.md`](../proposals/WORKSPACE_FAMILY_MAP_DESIGN.md).
