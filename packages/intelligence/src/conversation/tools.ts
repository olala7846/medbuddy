import type { MedicationGrounding, MedicationQuery } from "@medbuddy/contracts";

import { renderMedicationCards, type MedicationLookupRenderResult } from "../grounding/render.js";

/**
 * The responder's only medication tool is a read-only source-card lookup.
 * It deliberately receives no repository, Firestore, or mutation capability.
 */
export async function lookupMedication(
  grounding: MedicationGrounding,
  query: MedicationQuery,
): Promise<MedicationLookupRenderResult> {
  return renderMedicationCards(await grounding.lookup(query));
}
