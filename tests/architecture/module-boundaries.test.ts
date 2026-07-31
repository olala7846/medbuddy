import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkModuleBoundaries,
  formatViolation,
} from "../../scripts/check-module-boundaries.mjs";

const temporaryDirectories: string[] = [];

const packageDependencies: Record<string, string[]> = {
  contracts: [],
  chat: ["contracts", "care-record"],
  "care-record": ["contracts"],
  intelligence: ["contracts"],
  platform: ["contracts", "chat", "care-record", "intelligence"],
};

function writeFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createProject(
  files: Record<string, string>,
  dependencyOverrides: Record<string, string[]> = {},
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medbuddy-boundaries-"));
  temporaryDirectories.push(root);

  for (const [name, defaultDependencies] of Object.entries(packageDependencies)) {
    const dependencies = dependencyOverrides[name] ?? defaultDependencies;
    writeFile(
      root,
      `packages/${name}/package.json`,
      JSON.stringify({
        name: `@medbuddy/${name}`,
        exports: { ".": "./src/index.ts" },
        dependencies: Object.fromEntries(
          dependencies.map((dependency) => [`@medbuddy/${dependency}`, "0.0.0"]),
        ),
      }),
    );
  }

  writeFile(
    root,
    "apps/web/package.json",
    JSON.stringify({
      name: "@medbuddy/web",
      exports: { ".": "./src/index.ts" },
      dependencies: Object.fromEntries(
        Object.keys(packageDependencies).map((dependency) => [
          `@medbuddy/${dependency}`,
          "0.0.0",
        ]),
      ),
    }),
  );

  for (const [relativePath, contents] of Object.entries(files)) {
    writeFile(root, relativePath, contents);
  }

  return root;
}

function rulesFor(root: string): string[] {
  return checkModuleBoundaries(root).map((item) => item.rule);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("module boundary policy", () => {
  it("accepts internal imports and every approved dependency direction", () => {
    const root = createProject({
      "apps/web/src/composition.ts":
        'import "@medbuddy/chat"; import("@medbuddy/platform");',
      "packages/care-record/src/index.ts":
        'import type {} from "@medbuddy/contracts";',
      "packages/chat/src/index.ts": 'export {} from "@medbuddy/contracts";',
      "packages/contracts/src/auth.ts": 'import { id } from "./ids.js";',
      "packages/contracts/src/ids.ts": "export const id = 1;",
      "packages/intelligence/src/index.ts":
        'const contracts = require("@medbuddy/contracts"); void contracts;',
      "packages/platform/src/index.ts":
        'import "@medbuddy/chat"; import "@medbuddy/care-record"; import "@medbuddy/intelligence";',
      "tests/integration/golden-path.test.ts":
        'import "@medbuddy/contracts"; import("@medbuddy/intelligence");',
    });

    expect(checkModuleBoundaries(root)).toEqual([]);
  });

  it("rejects package subpath imports and recommends the public entry point", () => {
    const root = createProject({
      "packages/intelligence/src/index.ts":
        'import type {} from "@medbuddy/contracts/src/auth.js";',
    });

    const [item] = checkModuleBoundaries(root);
    expect(item?.rule).toBe("public-entry-point");
    expect(formatViolation(item!)).toContain(
      'Import another module through its public entry point "@medbuddy/contracts".',
    );
  });

  it("rejects relative imports that cross module boundaries", () => {
    const root = createProject({
      "packages/care-record/src/index.ts":
        'export * from "../../intelligence/src/index.js";',
      "scripts/seed.ts": 'import "../packages/contracts";',
    });

    expect(rulesFor(root)).toEqual([
      "cross-module-relative-import",
      "cross-module-relative-import",
    ]);
  });

  it("rejects dependencies opposite to the approved direction", () => {
    const root = createProject(
      {
        "packages/care-record/src/index.ts": 'import "@medbuddy/intelligence";',
      },
      {
        "care-record": ["contracts", "intelligence"],
      },
    );

    expect(rulesFor(root)).toContain("dependency-direction");
  });

  it("rejects workspace imports missing from runtime dependencies", () => {
    const root = createProject(
      {
        "packages/platform/src/index.ts": 'import("@medbuddy/chat");',
      },
      {
        platform: ["contracts", "care-record", "intelligence"],
      },
    );

    expect(rulesFor(root)).toContain("undeclared-workspace-dependency");
  });

  it("fails closed when a new package has no dependency policy", () => {
    const root = createProject({
      "packages/reporting/package.json":
        '{"name":"@medbuddy/reporting","dependencies":{}}',
      "packages/reporting/src/index.ts": "export {};",
    });

    expect(rulesFor(root)).toContain("missing-dependency-policy");
  });

  it("rejects imports for unknown MedBuddy package names", () => {
    const root = createProject({
      "tests/integration/unknown.test.ts": 'import "@medbuddy/missing";',
    });

    expect(rulesFor(root)).toContain("unknown-workspace-package");
  });
});
