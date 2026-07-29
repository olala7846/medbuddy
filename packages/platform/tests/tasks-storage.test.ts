import { describe, expect, it } from "vitest";
import { AttachmentDocumentSchema, CaptureJobInputSchema } from "@medbuddy/contracts";

import {
  CloudTasksCaptureDispatcher,
  PrivateAttachmentStorage,
  taskAuthorizationToken,
  verifyTaskCallback,
} from "../src/index.js";

describe("Cloud Tasks capture dispatcher", () => {
  it("sends a deterministic OIDC-authenticated callback with canonical IDs only", async () => {
    let request: unknown;
    const dispatcher = new CloudTasksCaptureDispatcher(
      {
        queuePath: () => "projects/demo/locations/us-west1/queues/capture",
        taskPath: () => "projects/demo/locations/us-west1/queues/capture/tasks/workspace_demo-message_visit_1",
        createTask: async (input) => {
          request = input;
          return [{} as never, input, {}] as [never, typeof input, object];
        },
      },
      {
        projectId: "demo",
        location: "us-west1",
        queue: "capture",
        callbackUrl: "https://service.example.internal/capture",
        serviceAccountEmail: "capture@demo.iam.gserviceaccount.com",
      },
    );

    await dispatcher.dispatch(CaptureJobInputSchema.parse({
      workspaceId: "workspace:demo",
      messageId: "message:visit-1",
    }));

    expect(request).toMatchObject({
      task: {
        httpRequest: {
          oidcToken: {
            serviceAccountEmail: "capture@demo.iam.gserviceaccount.com",
            audience: "https://service.example.internal/capture",
          },
        },
      },
    });
    const body = (request as { task: { httpRequest: { body: string } } }).task.httpRequest.body;
    expect(JSON.parse(Buffer.from(body, "base64").toString("utf8"))).toEqual({
      workspaceId: "workspace:demo",
      messageId: "message:visit-1",
    });
  });
});

describe("Cloud Tasks callback verification", () => {
  it("requires a verified configured service account", async () => {
    await verifyTaskCallback({
      authorization: "Bearer task-token",
      audience: "https://service.example.internal/capture",
      serviceAccountEmail: "capture@demo.iam.gserviceaccount.com",
      verifier: {
        async verifyIdToken() {
          return {
            getPayload: () => ({
              email: "capture@demo.iam.gserviceaccount.com",
              email_verified: true,
            }),
          };
        },
      },
    });

    await expect(
      verifyTaskCallback({
        authorization: "Bearer task-token",
        audience: "https://service.example.internal/capture",
        serviceAccountEmail: "capture@demo.iam.gserviceaccount.com",
        verifier: {
          async verifyIdToken() {
            return { getPayload: () => ({ email: "attacker@example.com", email_verified: true }) };
          },
        },
      }),
    ).rejects.toThrow("not authorized");
    expect(() => taskAuthorizationToken(undefined)).toThrow("bearer token");
  });
});

describe("private attachment storage", () => {
  it("writes validated metadata to the canonical workspace/message object path without URLs", async () => {
    const saves: Array<{ path: string; bytes: Uint8Array; options: unknown }> = [];
    const attachment = AttachmentDocumentSchema.parse({
      id: "attachment:label-1",
      workspaceId: "workspace:demo",
      messageId: "message:visit-1",
      mimeType: "image/png",
      byteSize: 3,
      checksum: "a".repeat(64),
      objectPath: "workspaces/workspace:demo/messages/message:visit-1/attachment:label-1",
    });
    const storage = new PrivateAttachmentStorage(
      {
        bucket: () => ({
          file: (path: string) => ({
            save: async (bytes: Uint8Array, options: unknown) => {
              saves.push({ path, bytes, options });
            },
          }),
        }),
      } as never,
      "private-medbuddy-attachments",
    );

    await storage.upload({ attachment, bytes: new Uint8Array([1, 2, 3]) });

    expect(saves).toEqual([
      {
        path: attachment.objectPath,
        bytes: new Uint8Array([1, 2, 3]),
        options: {
          resumable: false,
          metadata: { contentType: "image/png", metadata: { checksum: attachment.checksum } },
        },
      },
    ]);
    await expect(storage.upload({ attachment, bytes: new Uint8Array([1]) })).rejects.toThrow("declared size");
  });
});
