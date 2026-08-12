import { describe, expect, it } from "vitest";
import { AttachmentDocumentSchema, AttachmentTaskInputSchema, CaptureJobInputSchema, ContinuityTaskInputSchema } from "@medbuddy/contracts";

import {
  CloudTasksCaptureDispatcher,
  CloudTasksAttachmentDispatcher,
  CloudTasksContinuityDispatcher,
  CloudTasksMemoryFormationDispatcher,
  CloudTasksPassiveMemoryDispatcher,
  ContinuityPrivateAttachmentStorage,
  EncryptedLineAttachmentLocatorStore,
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
        taskPath: (_project, _location, _queue, taskId) => `projects/demo/locations/us-west1/queues/capture/tasks/${taskId}`,
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

  it("uses distinct task names for distinct canonical ID pairs", async () => {
    const names: string[] = [];
    const dispatcher = new CloudTasksCaptureDispatcher({
      queuePath: () => "queue", taskPath: (_p, _l, _q, taskId) => { names.push(taskId); return taskId; },
      createTask: async (input) => [{} as never, input, {}] as [never, typeof input, object],
    }, { projectId: "demo", location: "us-west1", queue: "capture", callbackUrl: "https://example.test/capture", serviceAccountEmail: "capture@demo.iam.gserviceaccount.com" });
    await dispatcher.dispatch(CaptureJobInputSchema.parse({ workspaceId: "workspace:a-b", messageId: "message:c" }));
    await dispatcher.dispatch(CaptureJobInputSchema.parse({ workspaceId: "workspace:a", messageId: "message:b-c" }));
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
  });

  it("treats an already-created deterministic task as an idempotent duplicate", async () => {
    const dispatcher = new CloudTasksCaptureDispatcher({
      queuePath: () => "queue", taskPath: () => "task",
      createTask: async () => { throw { code: 6 }; },
    }, { projectId: "demo", location: "us-west1", queue: "capture", callbackUrl: "https://example.test/capture", serviceAccountEmail: "capture@demo.iam.gserviceaccount.com" });
    await expect(dispatcher.dispatch(CaptureJobInputSchema.parse({ workspaceId: "workspace:demo", messageId: "message:visit-1" }))).resolves.toBeUndefined();
  });
});

describe("Cloud Tasks continuity dispatcher", () => {
  it("uses the deterministic job identity and an OIDC-authenticated private callback", async () => {
    const requests: unknown[] = [];
    const dispatcher = new CloudTasksContinuityDispatcher({
      queuePath: () => "queue",
      taskPath: (_project, _location, _queue, taskId) => taskId,
      createTask: async (input) => {
        requests.push(input);
        return [{} as never, input, {}] as [never, typeof input, object];
      },
    }, {
      projectId: "fictional-project",
      location: "us-west1",
      queue: "continuity",
      callbackUrl: "https://fictional.example.test/api/internal/continuity",
      serviceAccountEmail: "continuity@fictional-project.iam.gserviceaccount.com",
    });
    const input = ContinuityTaskInputSchema.parse({
      workspaceId: "workspace:orchard",
      jobId: `compaction-job:${"a".repeat(64)}`,
    });
    await dispatcher.dispatch(input);
    await dispatcher.dispatch(input);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      task: {
        name: `continuity-${"a".repeat(64)}`,
        httpRequest: {
          oidcToken: {
            audience: "https://fictional.example.test/api/internal/continuity",
            serviceAccountEmail: "continuity@fictional-project.iam.gserviceaccount.com",
          },
        },
      },
    });
  });

  it("converges an already-created task without changing its name", async () => {
    const dispatcher = new CloudTasksContinuityDispatcher({
      queuePath: () => "queue",
      taskPath: () => "task",
      createTask: async () => { throw { code: "ALREADY_EXISTS" }; },
    }, {
      projectId: "fictional-project",
      location: "us-west1",
      queue: "continuity",
      callbackUrl: "https://fictional.example.test/api/internal/continuity",
      serviceAccountEmail: "continuity@fictional-project.iam.gserviceaccount.com",
    });
    await expect(dispatcher.dispatch(ContinuityTaskInputSchema.parse({
      workspaceId: "workspace:orchard",
      jobId: `compaction-job:${"a".repeat(64)}`,
    }))).resolves.toBeUndefined();
  });
});

describe("Cloud Tasks attachment dispatcher", () => {
  it("uses a deterministic task whose callback body contains opaque IDs only", async () => {
    const requests: unknown[] = [];
    const dispatcher = new CloudTasksAttachmentDispatcher({
      queuePath: () => "queue",
      taskPath: (_project, _location, _queue, taskId) => taskId,
      createTask: async (input) => {
        requests.push(input);
        return [{} as never, input, {}] as [never, typeof input, object];
      },
    }, {
      projectId: "fictional-project",
      location: "us-west1",
      queue: "attachments",
      callbackUrl: "https://fictional.example.test/api/internal/attachment",
      serviceAccountEmail: "attachments@fictional-project.iam.gserviceaccount.com",
    });
    const input = AttachmentTaskInputSchema.parse({
      workspaceId: "workspace:orchard",
      attachmentId: "attachment:fictional-1",
    });
    await dispatcher.dispatch(input);
    const request = requests[0] as { task: { name: string; httpRequest: { body: string } } };
    expect(request.task.name).toMatch(/^attachment-[a-f0-9]{64}$/);
    expect(JSON.parse(Buffer.from(request.task.httpRequest.body, "base64").toString("utf8"))).toEqual(input);
    expect(JSON.stringify(request)).not.toContain("provider-message");
  });
});

describe("Cloud Tasks memory formation dispatchers", () => {
  it("uses a generation-specific delayed identity and content-free OIDC body", async () => {
    const requests: unknown[] = [];
    const client = { queuePath: () => "queue", taskPath: (_p: string, _l: string, _q: string, id: string) => id,
      createTask: async (input: never) => { requests.push(input); return [{} as never, input, {}] as never; } };
    const options = { projectId: "fictional", location: "us", queue: "memory",
      callbackUrl: "https://fictional.example.test/api/internal/memory-formation",
      serviceAccountEmail: "tasks@fictional.iam.gserviceaccount.com" };
    const dispatcher = new CloudTasksMemoryFormationDispatcher(client, options);
    await dispatcher.dispatch({ workspaceId: "workspace:fictional" as never, generation: 7,
      policyVersion: "memory-formation-v1", scheduleTime: "2026-08-06T12:10:00.000Z" });
    const request = requests[0] as { task: { name: string; scheduleTime: { seconds: number }; httpRequest: { body: string; oidcToken: unknown } } };
    expect(request.task.name).toMatch(/^memory-formation-[a-f0-9]{64}$/);
    expect(request.task.scheduleTime.seconds).toBe(1_786_018_200);
    expect(JSON.parse(Buffer.from(request.task.httpRequest.body, "base64").toString())).toEqual({
      workspaceId: "workspace:fictional", generation: 7, policyVersion: "memory-formation-v1",
    });
    expect(request.task.httpRequest.oidcToken).toMatchObject({ audience: options.callbackUrl });
  });

  it("uses a durable generation-specific private identity for recovery dispatches", async () => {
    const requests: unknown[] = [];
    const client = { queuePath: () => "queue", taskPath: (_p: string, _l: string, _q: string, id: string) => id,
      createTask: async (input: never) => { requests.push(input); return [{} as never, input, {}] as never; } };
    const dispatcher = new CloudTasksPassiveMemoryDispatcher(client, { projectId: "fictional", location: "us", queue: "memory",
      callbackUrl: "https://fictional.example.test/api/internal/passive-memory",
      serviceAccountEmail: "tasks@fictional.iam.gserviceaccount.com" });
    await dispatcher.dispatch({ workspaceId: "workspace:fictional" as never,
      jobId: "passive-memory-job:formation-1-1-g1" as never, dispatchGeneration: 1 });
    await dispatcher.dispatch({ workspaceId: "workspace:fictional" as never,
      jobId: "passive-memory-job:formation-1-1-g1" as never, dispatchGeneration: 2 });
    expect(requests).toHaveLength(2);
    const names: string[] = [];
    for (const request of requests) {
      const task = (request as { task: { name?: string; httpRequest: { body: string; oidcToken: unknown } } }).task;
      expect(task.name).toMatch(/^passive-memory-[a-f0-9]{64}$/);
      names.push(task.name!);
      expect(JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString("utf8"))).toEqual({
        workspaceId: "workspace:fictional", jobId: "passive-memory-job:formation-1-1-g1",
      });
      expect(task.httpRequest.oidcToken).toMatchObject({ audience: "https://fictional.example.test/api/internal/passive-memory" });
    }
    expect(names[0]).not.toBe(names[1]);
  });

  it("surfaces a passive task enqueue failure so durable recovery can retry it", async () => {
    const dispatcher = new CloudTasksPassiveMemoryDispatcher({
      queuePath: () => "queue", taskPath: () => "unused",
      createTask: async () => { throw { code: "UNAVAILABLE" }; },
    }, { projectId: "fictional", location: "us", queue: "memory",
      callbackUrl: "https://fictional.example.test/api/internal/passive-memory",
      serviceAccountEmail: "tasks@fictional.iam.gserviceaccount.com" });

    await expect(dispatcher.dispatch({ workspaceId: "workspace:fictional" as never,
      jobId: "passive-memory-job:formation-1-1-g1" as never, dispatchGeneration: 1 })).rejects.toMatchObject({ code: "UNAVAILABLE" });
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

  it("derives a private object path and validates signature, size, and checksum", async () => {
    const saves: Array<{ path: string; bytes: Uint8Array; options: unknown }> = [];
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const checksum = "7f47b756761a46e6d4a4d96f0d8a4448f8449235009d1f3ad1493f5c773c19e8";
    const storage = new ContinuityPrivateAttachmentStorage({
      bucket: () => ({
        file: (path: string) => ({
          save: async (savedBytes: Uint8Array, options: unknown) => saves.push({ path, bytes: savedBytes, options }),
        }),
      }),
    } as never, "private-fictional-bucket");
    await storage.saveValidated({
      workspaceId: "workspace:orchard" as never,
      attachmentId: "attachment:fictional-1" as never,
      mimeType: "image/png",
      bytes,
      checksum,
    });
    expect(saves).toMatchObject([{
      path: "continuity/workspaces/workspace:orchard/attachments/attachment:fictional-1",
      bytes,
    }]);
    await expect(storage.saveValidated({
      workspaceId: "workspace:orchard" as never,
      attachmentId: "attachment:fictional-2" as never,
      mimeType: "application/pdf",
      bytes,
      checksum,
    })).rejects.toThrow(/signature/i);
    await expect(storage.saveValidated({
      workspaceId: "workspace:orchard" as never,
      attachmentId: "attachment:fictional-3" as never,
      mimeType: "image/png",
      bytes,
      checksum: "a".repeat(64),
    })).rejects.toThrow(/checksum/i);
  });
});

describe("encrypted LINE attachment locator", () => {
  it("stores ciphertext only and binds decryption to the opaque workspace scope", async () => {
    const documents = new Map<string, unknown>();
    const persistence = {
      async put(workspaceId: string, attachmentId: string, value: unknown) {
        documents.set(`${workspaceId}\0${attachmentId}`, structuredClone(value));
      },
      async get(workspaceId: string, attachmentId: string) {
        return documents.get(`${workspaceId}\0${attachmentId}`) ?? null;
      },
    };
    const key = Buffer.alloc(32, 7).toString("base64");
    const locator = new EncryptedLineAttachmentLocatorStore(persistence, {
      version: "locator-v1",
      keyBase64: key,
    });
    await locator.put({
      workspaceId: "workspace:orchard" as never,
      attachmentId: "attachment:fictional-1" as never,
      providerMessageId: "fictional-provider-message",
    });
    const stored = documents.get("workspace:orchard\0attachment:fictional-1");
    expect(JSON.stringify(stored)).not.toContain("fictional-provider-message");
    await expect(locator.resolve({
      workspaceId: "workspace:orchard" as never,
      attachmentId: "attachment:fictional-1" as never,
    })).resolves.toBe("fictional-provider-message");

    documents.set("workspace:other\0attachment:fictional-1", stored);
    await expect(locator.resolve({
      workspaceId: "workspace:other" as never,
      attachmentId: "attachment:fictional-1" as never,
    })).rejects.toThrow(/scope|decrypt|workspace/i);
  });

  it("rejects malformed runtime key material without echoing it", () => {
    const secret = "fictional-invalid-key-material";
    expect(() => new EncryptedLineAttachmentLocatorStore({
      async put() {}, async get() { return null; },
    }, { version: "locator-v1", keyBase64: secret })).toThrow(/key/i);
    expect(() => new EncryptedLineAttachmentLocatorStore({
      async put() {}, async get() { return null; },
    }, { version: "locator-v1", keyBase64: secret })).not.toThrow(secret);
  });
});
