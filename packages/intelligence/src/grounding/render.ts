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

const mandatoryLimitations = [
  "General source-card information cannot establish patient-specific purpose, timing, duration, interaction safety, or prescribing rationale.",
  "Only the cited considerations are shown; absence of another warning does not establish safety or completeness.",
] as const;

function withMandatoryLimitations(limitations: readonly string[]): string[] {
  const normalized = limitations.map((limitation) => limitation.toLocaleLowerCase("en-US"));
  const additions = mandatoryLimitations.filter((limitation, index) => {
    const requiredPhrase = index === 0
      ? "general information cannot establish patient-specific"
      : "absence of another warning does not establish safety or completeness";
    return !normalized.some((existing) => existing.includes(requiredPhrase));
  });

  return [...limitations, ...additions];
}

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
      limitations: withMandatoryLimitations(card.limitations),
      snapshotVersion: card.snapshotVersion,
    })),
  };
}
