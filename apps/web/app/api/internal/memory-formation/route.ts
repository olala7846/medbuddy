import { handleMemoryFormationRequest } from "../../../../src/memory-formation-route.js";

export async function POST(request: Request): Promise<Response> {
  return handleMemoryFormationRequest(request);
}
