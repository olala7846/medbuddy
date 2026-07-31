import { apiError, sessionResponse } from "../../../../src/local-demo/http.js";
import { getLocalDemoHost } from "../../../../src/local-demo/runtime.js";

export async function POST() {
  try {
    return sessionResponse(await (await getLocalDemoHost()).signInReviewer());
  } catch (error) {
    return apiError(error);
  }
}
