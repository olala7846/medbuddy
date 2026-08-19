import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);

export const PACKAGE_DEPENDENCY_POLICY = Object.freeze({
  contracts: [],
  chat: ["contracts", "care-record"],
  "care-record": ["contracts"],
  intelligence: ["contracts"],
  platform: ["contracts", "chat", "care-record", "intelligence"],
});

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listDirectories(parentPath) {
  if (!fs.existsSync(parentPath)) {
    return [];
  }

  return fs
    .readdirSync(parentPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function discoverModules(rootDir) {
  const modules = [];

  for (const kind of ["packages", "apps"]) {
    for (const directoryName of listDirectories(path.join(rootDir, kind))) {
      const root = path.join(rootDir, kind, directoryName);
      const manifestPath = path.join(root, "package.json");
      const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : undefined;

      modules.push({
        directoryName,
        kind: kind === "packages" ? "package" : "app",
        manifest,
        manifestPath,
        packageName: manifest?.name,
        root,
      });
    }
  }

  return modules;
}

function collectSourceFiles(rootDir) {
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(entryPath);
      }
    }
  }

  visit(rootDir);
  return files.sort();
}

function moduleForPath(filePath, modules) {
  const absolutePath = path.resolve(filePath);

  return modules.find((module) => {
    const relative = path.relative(module.root, absolutePath);
    return (
      relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });
}

function scriptKindFor(filePath) {
  const extension = path.extname(filePath);
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function importSpecifiers(filePath) {
  const contents = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const imports = [];

  function record(node, literal) {
    if (!literal || !ts.isStringLiteralLike(literal)) {
      return;
    }

    const position = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile));
    imports.push({
      column: position.character + 1,
      line: position.line + 1,
      specifier: literal.text,
    });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node, node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node, node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      record(node, node.arguments[0]);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function violation(rootDir, filePath, location, rule, message) {
  return {
    column: location.column,
    file: toPosix(path.relative(rootDir, filePath)),
    line: location.line,
    message,
    rule,
    specifier: location.specifier,
  };
}

function declaredRuntimeDependency(sourceModule, targetPackageName) {
  return Boolean(sourceModule.manifest?.dependencies?.[targetPackageName]);
}

function isExportedSpecifier(targetModule, specifier) {
  const exportKey = specifier === targetModule.packageName
    ? "."
    : `.${specifier.slice(targetModule.packageName.length)}`;
  return Boolean(targetModule.manifest?.exports?.[exportKey]);
}

function validateWorkspaceImport({
  rootDir,
  filePath,
  location,
  sourceModule,
  targetModule,
}) {
  const violations = [];

  const relativeSourcePath = toPosix(path.relative(sourceModule?.root ?? rootDir, filePath));
  if (
    location.specifier === "@medbuddy/intelligence/legacy-testing"
    && !relativeSourcePath.startsWith("tests/")
  ) {
    violations.push(
      violation(
        rootDir,
        filePath,
        location,
        "test-only-entry-point",
        'Import "@medbuddy/intelligence/legacy-testing" only from a module tests/ directory.',
      ),
    );
  }

  if (!isExportedSpecifier(targetModule, location.specifier)) {
    violations.push(
      violation(
        rootDir,
        filePath,
        location,
        "public-entry-point",
        `Import another module through its public entry point "${targetModule.packageName}".`,
      ),
    );
    return violations;
  }

  if (relativeSourcePath.startsWith("tests/")) return violations;

  if (sourceModule?.kind === "package") {
    const allowedDependencies = PACKAGE_DEPENDENCY_POLICY[sourceModule.directoryName];
    if (!allowedDependencies?.includes(targetModule.directoryName)) {
      const allowedNames =
        allowedDependencies?.map((name) => `@medbuddy/${name}`).join(", ") || "none";
      violations.push(
        violation(
          rootDir,
          filePath,
          location,
          "dependency-direction",
          `Package "${sourceModule.directoryName}" may depend on: ${allowedNames}.`,
        ),
      );
    }
  }

  if (
    sourceModule &&
    sourceModule !== targetModule &&
    !declaredRuntimeDependency(sourceModule, targetModule.packageName)
  ) {
    violations.push(
      violation(
        rootDir,
        filePath,
        location,
        "undeclared-workspace-dependency",
        `Declare "${targetModule.packageName}" in ${toPosix(
          path.relative(rootDir, sourceModule.manifestPath),
        )} dependencies.`,
      ),
    );
  }

  return violations;
}

export function checkModuleBoundaries(rootDir = process.cwd()) {
  const absoluteRoot = path.resolve(rootDir);
  const modules = discoverModules(absoluteRoot);
  const violations = [];

  for (const module of modules) {
    const relativeManifest = toPosix(path.relative(absoluteRoot, module.manifestPath));
    if (!module.manifest) {
      violations.push({
        column: 1,
        file: relativeManifest,
        line: 1,
        message: `Workspace module "${module.directoryName}" must have a package.json.`,
        rule: "workspace-manifest",
        specifier: module.directoryName,
      });
    } else if (!module.packageName) {
      violations.push({
        column: 1,
        file: relativeManifest,
        line: 1,
        message: `Workspace module "${module.directoryName}" must declare a package name.`,
        rule: "workspace-package-name",
        specifier: module.directoryName,
      });
    }

    if (
      module.kind === "package" &&
      !Object.hasOwn(PACKAGE_DEPENDENCY_POLICY, module.directoryName)
    ) {
      violations.push({
        column: 1,
        file: relativeManifest,
        line: 1,
        message: `Add package "${module.directoryName}" to PACKAGE_DEPENDENCY_POLICY before introducing it.`,
        rule: "missing-dependency-policy",
        specifier: module.directoryName,
      });
    }
  }

  const namedModules = modules.filter((module) => module.packageName);

  for (const filePath of collectSourceFiles(absoluteRoot)) {
    const sourceModule = moduleForPath(filePath, modules);

    for (const location of importSpecifiers(filePath)) {
      if (location.specifier.startsWith(".")) {
        const targetPath = path.resolve(path.dirname(filePath), location.specifier);
        const targetModule = moduleForPath(targetPath, modules);
        const relativeSourcePath = toPosix(path.relative(sourceModule?.root ?? absoluteRoot, filePath));
        const importsLegacyRuntime = location.specifier.endsWith("/conversation/responder.js")
          || location.specifier.endsWith("/adapters/legacy-vertex-conversation.js");
        const isLegacyHarness = relativeSourcePath === "src/legacy-testing.ts"
          || relativeSourcePath === "src/adapters/legacy-vertex-conversation.ts";

        if (
          importsLegacyRuntime
          && !relativeSourcePath.startsWith("tests/")
          && !isLegacyHarness
        ) {
          violations.push(
            violation(
              absoluteRoot,
              filePath,
              location,
              "legacy-runtime-isolation",
              "Production modules cannot import the legacy conversation runtime.",
            ),
          );
        }

        if (targetModule && targetModule !== sourceModule) {
          violations.push(
            violation(
              absoluteRoot,
              filePath,
              location,
              "cross-module-relative-import",
              `Import another module through its public entry point "${targetModule.packageName}".`,
            ),
          );
        }
        continue;
      }

      const targetModule = namedModules.find(
        (module) =>
          location.specifier === module.packageName ||
          location.specifier.startsWith(`${module.packageName}/`),
      );

      if (targetModule) {
        violations.push(
          ...validateWorkspaceImport({
            filePath,
            location,
            rootDir: absoluteRoot,
            sourceModule,
            targetModule,
          }),
        );
      } else if (location.specifier.startsWith("@medbuddy/")) {
        violations.push(
          violation(
            absoluteRoot,
            filePath,
            location,
            "unknown-workspace-package",
            `No workspace package provides "${location.specifier}".`,
          ),
        );
      }
    }
  }

  return violations.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.rule.localeCompare(right.rule),
  );
}

export function formatViolation(item) {
  return `${item.file}:${item.line}:${item.column} [${item.rule}] ${item.specifier} — ${item.message}`;
}

function runCli() {
  const violations = checkModuleBoundaries(process.cwd());
  if (violations.length === 0) {
    console.log("Module boundaries are valid.");
    return;
  }

  console.error(
    `Module boundary check failed with ${violations.length} violation${
      violations.length === 1 ? "" : "s"
    }:`,
  );
  for (const item of violations) {
    console.error(formatViolation(item));
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
