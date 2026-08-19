import { ChatGoogle, type ChatGoogleParams } from "@langchain/google/node";
import { z } from "zod";

const VertexAgentModelConfigurationSchema = z.object({
  projectId: z.string().trim().min(1),
  location: z.string().trim().min(1),
  model: z.string().trim().min(1),
}).strict();

export type VertexAgentModelConfiguration = z.infer<typeof VertexAgentModelConfigurationSchema>;

type GoogleApiClient = NonNullable<ChatGoogleParams["apiClient"]>;

/** Build the private agent model in Vertex mode with framework retries disabled. */
export function createVertexAgentModel(
  configuration: VertexAgentModelConfiguration,
  apiClient?: GoogleApiClient,
): ChatGoogle {
  const parsed = VertexAgentModelConfigurationSchema.parse(configuration);
  return new ChatGoogle({
    model: parsed.model,
    platformType: "gcp",
    location: parsed.location,
    maxRetries: 0,
    maxOutputTokens: 2_048,
    thinkingLevel: "low",
    googleAuthOptions: { projectId: parsed.projectId },
    ...(apiClient === undefined ? {} : { apiClient }),
  });
}
