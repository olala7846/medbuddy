import type { MedicationSourceCard } from "@medbuddy/contracts";

export interface RenderedMedicationClaim {
  text: string;
  sourceOrganization: string;
  sourceUrl: string;
  retrievedAt: string;
  snapshotVersion: string;
}

export interface RenderedMedicationCard {
  medicationCode: string;
  displayName: string;
  identityFields: Record<string, string>;
  claims: RenderedMedicationClaim[];
  limitations: string[];
  snapshotVersion: string;
}

export type MedicationLookupRenderResult =
  | { kind: "GROUNDED"; cards: RenderedMedicationCard[] }
  | { kind: "UNSUPPORTED"; claims: []; text: string };

const unsupportedText =
  "This medicine is not in the targeted fictional prototype data. I cannot identify it, assess completeness, or infer safety from that absence. Please check the readable label and ask a pharmacist or prescribing clinic.";

/** Renders every medication claim with the source-card metadata that supports it. */
export function renderMedicationCards(
  cards: readonly MedicationSourceCard[],
): MedicationLookupRenderResult {
  if (cards.length === 0) {
    return { kind: "UNSUPPORTED", claims: [], text: unsupportedText };
  }

  return {
    kind: "GROUNDED",
    cards: cards.map((card) => ({
      medicationCode: card.medicationCode,
      displayName: card.displayName,
      identityFields: { ...card.identityFields },
      claims: card.generalConsiderations.map((claim) => ({
        ...claim,
        snapshotVersion: card.snapshotVersion,
      })),
      limitations: [...card.limitations],
      snapshotVersion: card.snapshotVersion,
    })),
  };
}
