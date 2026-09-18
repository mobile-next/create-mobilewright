import fs from "fs";
import path from "path";
import type { Platform } from "./detect";
import { installAllCommand, installDevCommand, installProdCommand, PackageManager } from "./package-manager";

export type Language = "ts" | "js";

export type PackageJson = {
  name?: string;
  type?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  jest?: unknown;
  workspaces?: unknown;
  packageManager?: string;
  [key: string]: unknown;
};

export type ProjectFiles = {
  language: Language;
  testDir: string;
  platform: Platform;
  bundleId: string;
};

export type TestRunner = "playwright" | "jest" | "vitest";

export type InstallPlan = {
  dependencies: string[];
  devDependencies: string[];
};

export class UserFacingError extends Error {}

// mobilewright's own engines field; also the first 22.x with unflagged require(esm)
export const MINIMUM_NODE_VERSION = "22.12.0";
export const DEFAULT_TEST_DIR = "tests";
export const ISOLATED_TEST_DIR = "mobile-tests";

// odd releases don't always get their own @types/node major (there is no @types/node 23)
// ponytail: static list, add new majors as they are published; newer node falls back to the newest known
const PUBLISHED_TYPES_NODE_MAJORS = [22, 24, 25, 26];

const MOBILEWRIGHT_PACKAGES = ["mobilewright", "@mobilewright/test"];
// only a semver range or a dist-tag comes from the registry; anything with ":", "/" or "@"
// (workspace:, file:, git urls, git@host:repo, owner/repo, ../path, npm: aliases) is a custom build, never replace it
const REGISTRY_SPEC = /^[\w.^~<>=*|\s-]*$/;

const NPM_PLACEHOLDER_TEST_SCRIPT = "no test specified";
const MOBILEWRIGHT_TEST_SCRIPT = "mobilewright test";

export function isSupportedNodeVersion(version: string): boolean {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  const [minimumMajor, minimumMinor] = MINIMUM_NODE_VERSION.split(".").map(Number);
  return major > minimumMajor || (major === minimumMajor && minor >= minimumMinor);
}

export function readPackageJson(pkgPath: string): PackageJson | undefined {
  if (!fs.existsSync(pkgPath)) return undefined;
  const raw = fs.readFileSync(pkgPath, "utf-8").replace(/^\uFEFF/, "");
  if (raw.trim() === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UserFacingError(`${pkgPath} is not valid JSON (${(error as Error).message}). Fix it and run again.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UserFacingError(`${pkgPath} must contain a JSON object. Fix it and run again.`);
  }
  return parsed as PackageJson;
}

function toPackageName(dirName: string): string {
  const name = dirName.toLowerCase().replace(/[^a-z0-9-._~]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  return name || "mobilewright-tests";
}

export function createNewPackageJson(targetDir: string): PackageJson {
  return {
    name: toPackageName(path.basename(targetDir)),
    version: "1.0.0",
    private: true,
  };
}

function hasDependency(pkg: PackageJson, name: string): boolean {
  return pkg.dependencies?.[name] !== undefined || pkg.devDependencies?.[name] !== undefined;
}

export function withTestScript(pkg: PackageJson): PackageJson {
  const current = pkg.scripts?.test;
  if (current !== undefined && !current.includes(NPM_PLACEHOLDER_TEST_SCRIPT)) return pkg;
  return { ...pkg, scripts: { ...(pkg.scripts ?? {}), test: MOBILEWRIGHT_TEST_SCRIPT } };
}

export function typesNodeRange(nodeVersion: string): string {
  const nodeMajor = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
  const candidates = PUBLISHED_TYPES_NODE_MAJORS.filter((major) => major <= nodeMajor);
  return `^${candidates.length > 0 ? Math.max(...candidates) : PUBLISHED_TYPES_NODE_MAJORS[0]}`;
}

// like create-playwright, nothing is pinned here. @latest is explicit because a bare name
// keeps whatever range package.json already has (e.g. ^0.0.45 would never be upgraded)
export function planInstall(pkg: PackageJson, language: Language, nodeVersion: string): InstallPlan {
  const isRegistrySpec = (spec: string | undefined) => spec === undefined || REGISTRY_SPEC.test(spec);
  const mobilewright = MOBILEWRIGHT_PACKAGES.filter((name) => isRegistrySpec(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]));
  const latest = (names: string[]) => names.map((name) => `${name}@latest`);
  const typescriptPackages = language === "ts"
    ? [
      ...(hasDependency(pkg, "@types/node") ? [] : [`@types/node@${typesNodeRange(nodeVersion)}`]),
      ...(hasDependency(pkg, "typescript") ? [] : ["typescript"]),
    ]
    : [];
  return {
    // a package the project already lists under dependencies stays there
    dependencies: latest(mobilewright.filter((name) => pkg.dependencies?.[name] !== undefined)),
    devDependencies: [...latest(mobilewright.filter((name) => pkg.dependencies?.[name] === undefined)), ...typescriptPackages],
  };
}

export function installCommands({ dependencies, devDependencies }: InstallPlan, packageManager: PackageManager, pkg: PackageJson = {}): string[] {
  const isWorkspaceRoot = pkg.workspaces !== undefined;
  const commands = [
    ...(devDependencies.length > 0 ? [installDevCommand(packageManager, devDependencies, isWorkspaceRoot)] : []),
    ...(dependencies.length > 0 ? [installProdCommand(packageManager, dependencies, isWorkspaceRoot)] : []),
  ];
  return commands.length > 0 ? commands : [installAllCommand(packageManager)];
}

// JSON.stringify gives a valid JS string literal for any user input
function literal(value: string): string {
  return JSON.stringify(value);
}

export function validateTestDir(targetDir: string, input: string): true | string {
  const value = input.trim();
  if (value === "") return "Please enter a directory name";
  const relative = path.relative(targetDir, path.resolve(targetDir, value));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return "The test directory must be inside the current project";
  }
  return true;
}

// "./tests/", "/abs/project/tests" and "tests" all become "tests"
export function normalizeTestDir(targetDir: string, input: string): string {
  const relative = path.relative(targetDir, path.resolve(targetDir, input.trim())) || ".";
  return relative.split(path.sep).join("/");
}

export function createConfigContent({ language, testDir, platform, bundleId }: ProjectFiles): string {
  const lines = [
    ...(language === "js" ? ["// @ts-check"] : []),
    // import syntax works in both "type": "module" and CommonJS packages, the runner transpiles it
    "import { defineConfig } from 'mobilewright';",
    "",
    "export default defineConfig({",
    `  testDir: ${literal(`./${testDir}`)},`,
    `  platform: ${literal(platform)},`,
    ...(bundleId ? [`  bundleId: ${literal(bundleId)},`] : []),
    // open: 'never': otherwise a failing run in a terminal serves the report and blocks until Ctrl-C
    "  reporter: [['html', { open: 'never' }]],",
    "});",
    "",
  ];
  return lines.join("\n");
}

export function createTestContent(language: Language): string {
  return [
    ...(language === "js" ? ["// @ts-check"] : []),
    "// this is a skeleton test for mobilewright (see https://github.com/mobile-next/mobilewright/blob/main/README.md)",
    "// for documentation see: https://mobilewright.dev/docs/",
    "// for agent skill see: https://github.com/mobile-next/mobilewright-skill",
    "import { test, expect } from '@mobilewright/test';",
    "",
    "test('app launches and shows home screen', async ({ screen }) => {",
    "  await expect(screen.getByText('Welcome')).toBeVisible();",
    "});",
    "",
  ].join("\n");
}

export function createTsconfigContent(testDir: string): string {
  const tsconfig = {
    compilerOptions: {
      target: "es2022",
      module: "preserve",
      moduleResolution: "bundler",
      types: ["node"],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ["mobilewright.config.ts", `${testDir}/**/*.ts`],
  };
  return JSON.stringify(tsconfig, null, 2) + "\n";
}

export function patchGitignore(existing: string | undefined): string | undefined {
  const entries: [string, RegExp][] = [
    ["node_modules/", /^\/?node_modules\/?$/m],
    ["/test-results/", /^\/?test-results\/?$/m],
    ["/playwright-report/", /^\/?playwright-report\/?$/m],
    ["/mobilewright-report/", /^\/?mobilewright-report\/?$/m],
  ];
  const missing = entries.filter(([, pattern]) => !pattern.test(existing ?? "")).map(([entry]) => entry);
  if (missing.length === 0) return undefined;
  const base = existing ? existing.trimEnd() + "\n\n" : "";
  return `${base}# mobilewright\n${missing.join("\n")}\n`;
}

function hasFileStartingWith(dir: string, prefix: string): boolean {
  try {
    return fs.readdirSync(dir).some((entry) => entry.startsWith(prefix));
  } catch {
    return false;
  }
}

export function detectOtherTestRunners(targetDir: string, pkg: PackageJson): TestRunner[] {
  const runners: TestRunner[] = [];
  if (hasDependency(pkg, "@playwright/test") || hasFileStartingWith(targetDir, "playwright.config.")) runners.push("playwright");
  if (hasDependency(pkg, "jest") || pkg.jest !== undefined || hasFileStartingWith(targetDir, "jest.config.")) runners.push("jest");
  if (hasDependency(pkg, "vitest") || hasFileStartingWith(targetDir, "vitest.config.")) runners.push("vitest");
  return runners;
}

function directoryHasTestFiles(dir: string): boolean {
  try {
    return fs.readdirSync(dir, { recursive: true, encoding: "utf-8" }).some((entry) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(entry));
  } catch {
    return false;
  }
}

export function chooseDefaultTestDir(targetDir: string, runners: TestRunner[]): string {
  const testsDirIsTaken = directoryHasTestFiles(path.join(targetDir, DEFAULT_TEST_DIR));
  return runners.length > 0 || testsDirIsTaken ? ISOLATED_TEST_DIR : DEFAULT_TEST_DIR;
}

export function describeRunnerExclusion(runner: TestRunner, testDir: string): string {
  switch (runner) {
    case "jest":
      return `jest:       add testPathIgnorePatterns: ["/node_modules/", "/${testDir}/"]`;
    case "vitest":
      return `vitest:     add test: { exclude: [...configDefaults.exclude, "${testDir}/**"] }`;
    case "playwright":
      return `playwright: add testIgnore: "${testDir}/**" (if its testDir includes ${testDir})`;
  }
}

// walks node_modules like node does; require.resolve can't be used because packages
// with an "exports" field (mobilewright, playwright) don't export ./package.json
function resolvePackageJson(name: string, fromDir: string): string | undefined {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    if (path.dirname(dir) === dir) return undefined;
  }
}

function readVersion(pkgJsonPath: string): string {
  try {
    return JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")).version ?? "unknown version";
  } catch {
    return "unknown version";
  }
}

export function findInstallProblem(targetDir: string): string | undefined {
  const mobilewright = resolvePackageJson("mobilewright", targetDir);
  const mobilewrightTest = resolvePackageJson("@mobilewright/test", targetDir);
  if (!mobilewright || !mobilewrightTest) {
    return "mobilewright was not installed. If NODE_ENV=production or npm's omit=dev is set, unset it and run npm install again.";
  }

  const playwrightTest = resolvePackageJson("@playwright/test", path.dirname(mobilewrightTest));
  const runnerPlaywright = resolvePackageJson("playwright", path.dirname(mobilewright));
  const testPlaywright = playwrightTest ? resolvePackageJson("playwright", path.dirname(playwrightTest)) : undefined;
  if (runnerPlaywright && testPlaywright && runnerPlaywright !== testPlaywright) {
    return [
      "Two different copies of Playwright were installed, so tests would fail with \"did not expect test() to be called here\":",
      `  ${path.dirname(runnerPlaywright)} (${readVersion(runnerPlaywright)})`,
      `  ${path.dirname(testPlaywright)} (${readVersion(testPlaywright)})`,
      "This happens when the project already depends on another version of playwright or @playwright/test.",
      "Run npm init mobilewright@latest in a separate subdirectory (e.g. mobile/) instead.",
    ].join("\n");
  }
  return undefined;
}
