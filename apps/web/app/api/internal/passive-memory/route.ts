import { handlePassiveMemoryRequest } from "../../../../src/passive-memory-route.js";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  return handlePassiveMemoryRequest(request);
}
