import type { MedicationGrounding, MedicationQuery } from "@medbuddy/contracts";

import { fixtureMedicationSourceCards } from "../fixtures/medication/source-cards.js";
import { CommittedSourceCardGrounding } from "./grounding/lookup.js";
import {
  renderMedicationCards,
  type MedicationLookupRenderResult,
} from "./grounding/render.js";

export { CommittedSourceCardGrounding } from "./grounding/lookup.js";
export {
  renderMedicationCards,
  type MedicationLookupRenderResult,
  type RenderedMedicationCard,
  type RenderedMedicationClaim,
} from "./grounding/render.js";
export * from "./safety/route.js";
export * from "./safety/templates.js";

export function createFixtureMedicationGrounding(): MedicationGrounding {
  return new CommittedSourceCardGrounding(fixtureMedicationSourceCards);
}

export async function renderMedicationLookup(
  grounding: MedicationGrounding,
  query: MedicationQuery,
): Promise<MedicationLookupRenderResult> {
  return renderMedicationCards(await grounding.lookup(query));
}

export * from "./capture/fixed.js";
export * from "./capture/processor.js";
export * from "./capture/validate.js";
export * from "./conversation/responder.js";
export * from "./conversation/tools.js";
