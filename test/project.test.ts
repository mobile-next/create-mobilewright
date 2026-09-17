import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import {
  chooseDefaultTestDir,
  createConfigContent,
  createNewPackageJson,
  createTestContent,
  createTsconfigContent,
  detectOtherTestRunners,
  findInstallProblem,
  isSupportedNodeVersion,
  ISOLATED_TEST_DIR,
  installCommands,
  normalizeTestDir,
  PackageJson,
  patchGitignore,
  readPackageJson,
  planInstall,
  typesNodeRange,
  UserFacingError,
  validateTestDir,
  withTestScript,
} from "../src/project";
import { createTempDir, installFakePackage, writeFile } from "./helpers";

function packageJsonFileWith(content: string): string {
  return writeFile(createTempDir(), "package.json", content);
}

function assertRejectedWithMessage(pkgPath: string, message: RegExp): void {
  assert.throws(() => readPackageJson(pkgPath), (error: unknown) => error instanceof UserFacingError && message.test(error.message));
}

const ANY_MOBILEWRIGHT_VERSION = "0.0.59";

function typescriptInstallFor(pkg: PackageJson) {
  return planInstall(pkg, "ts", "24.21.0");
}

function installMobilewrightWithOnePlaywright(projectDir: string): void {
  installFakePackage(projectDir, { name: "playwright", version: "1.63.0" });
  installFakePackage(projectDir, { name: "@playwright/test", version: "1.63.0" });
  // like the real packages, "exports" hides ./package.json from require.resolve
  installFakePackage(projectDir, { name: "mobilewright", version: ANY_MOBILEWRIGHT_VERSION, exports: { ".": "./dist/index.js" } });
  installFakePackage(projectDir, { name: "@mobilewright/test", version: ANY_MOBILEWRIGHT_VERSION, exports: { ".": "./dist/index.js" } });
}

test("node versions older than 22.12 are rejected before any prompt", () => {
  for (const version of ["16.20.2", "18.20.8", "20.19.0", "21.7.3", "22.11.0"]) {
    assert.equal(isSupportedNodeVersion(version), false, version);
  }
  for (const version of ["22.12.0", "22.19.0", "23.11.1", "24.21.0", "25.8.1", "v26.0.0"]) {
    assert.equal(isSupportedNodeVersion(version), true, version);
  }
});

test("package.json: missing file means a new project", () => {
  assert.equal(readPackageJson(path.join(createTempDir(), "package.json")), undefined);
});

test("package.json: an empty file is treated as an empty object", () => {
  assert.deepEqual(readPackageJson(packageJsonFileWith("  \n")), {});
});

test("package.json: a UTF-8 BOM is accepted, like npm does", () => {
  assert.deepEqual(readPackageJson(packageJsonFileWith('﻿{ "name": "bom" }')), { name: "bom" });
});

test("package.json: malformed JSON gives a readable error", () => {
  assertRejectedWithMessage(packageJsonFileWith('{ "name": "x", }'), /is not valid JSON.*Fix it and run again/);
});

test("package.json: null, arrays and strings give a readable error", () => {
  for (const content of ["null", "[]", '"text"']) {
    assertRejectedWithMessage(packageJsonFileWith(content), /must contain a JSON object/);
  }
});

test("new package.json gets a valid name and is private", () => {
  assert.deepEqual(createNewPackageJson("/work/My Cool App!"), { name: "my-cool-app", version: "1.0.0", private: true });
  assert.equal(createNewPackageJson("/work/!!!").name, "mobilewright-tests");
});

test("new package.json gets a test script", () => {
  assert.equal(withTestScript(createNewPackageJson("/work/app")).scripts?.test, "mobilewright test");
});

test("npm's placeholder test script is replaced, a real one is kept", () => {
  const placeholder = { scripts: { test: 'echo "Error: no test specified" && exit 1' } };
  assert.equal(withTestScript(placeholder).scripts?.test, "mobilewright test");
  assert.equal(withTestScript({ scripts: { test: "jest" } }).scripts?.test, "jest");
});

test("install: mobilewright is installed @latest, never a pinned version", () => {
  assert.deepEqual(planInstall({}, "js", "24.21.0"), { dependencies: [], devDependencies: ["mobilewright@latest", "@mobilewright/test@latest"] });
});

test("install: TypeScript projects also get typescript and @types/node for the running node", () => {
  assert.deepEqual(typescriptInstallFor({}).devDependencies, ["mobilewright@latest", "@mobilewright/test@latest", "@types/node@^24", "typescript"]);
});

test("install: an older mobilewright in devDependencies is upgraded to the latest", () => {
  assert.deepEqual(planInstall({ devDependencies: { mobilewright: "^0.0.45" } }, "js", "24.21.0").devDependencies, ["mobilewright@latest", "@mobilewright/test@latest"]);
});

test("install: a package already in dependencies stays in dependencies", () => {
  const plan = planInstall({ dependencies: { mobilewright: "0.0.45" } }, "js", "24.21.0");
  assert.deepEqual(plan, { dependencies: ["mobilewright@latest"], devDependencies: ["@mobilewright/test@latest"] });
});

test("install: workspace, file and git specs are never replaced", () => {
  const pkg = { devDependencies: { mobilewright: "workspace:*", "@mobilewright/test": "file:../mobilewright/packages/test" } };
  assert.deepEqual(planInstall(pkg, "js", "24.21.0"), { dependencies: [], devDependencies: [] });
});

test("install: existing @types/node and typescript are kept", () => {
  const plan = typescriptInstallFor({ devDependencies: { "@types/node": "^22.0.0", typescript: "^4.9.5" } });
  assert.deepEqual(plan.devDependencies, ["mobilewright@latest", "@mobilewright/test@latest"]);
});

test("dependencies: @types/node uses a published major (there is no @types/node 23)", () => {
  assert.equal(typesNodeRange("22.12.0"), "^22");
  assert.equal(typesNodeRange("23.11.1"), "^22");
  assert.equal(typesNodeRange("24.21.0"), "^24");
  assert.equal(typesNodeRange("25.8.1"), "^25");
  assert.equal(typesNodeRange("v27.0.0"), "^26");
});

test("install: commands quote every spec and never use a pinned mobilewright version", () => {
  assert.deepEqual(installCommands({ dependencies: ["mobilewright"], devDependencies: ["@mobilewright/test", "@types/node@^24"] }), [
    'npm install --save-dev --include=dev "@mobilewright/test" "@types/node@^24"',
    'npm install --save-prod --include=dev "mobilewright"',
  ]);
});

test("install: nothing to add still runs npm install so existing dependencies are present", () => {
  assert.deepEqual(installCommands({ dependencies: [], devDependencies: [] }), ["npm install --include=dev"]);
});

test("install: the input package.json object is not mutated", () => {
  const pkg: PackageJson = { devDependencies: { other: "1.0.0" }, scripts: { test: "echo no test specified" } };
  planInstall(pkg, "ts", "24.21.0");
  withTestScript(pkg);
  assert.deepEqual(pkg, { devDependencies: { other: "1.0.0" }, scripts: { test: "echo no test specified" } });
});

test("config: always sets the platform", () => {
  const config = createConfigContent({ language: "ts", testDir: "tests", platform: "android", bundleId: "com.acme.app" });
  assert.match(config, /platform: "android",/);
});

test("config: JavaScript uses import syntax so it also works in \"type\": \"module\" packages", () => {
  for (const content of [createConfigContent({ language: "js", testDir: "tests", platform: "ios", bundleId: "" }), createTestContent("js")]) {
    assert.doesNotMatch(content, /require\(|module\.exports/);
    assert.match(content, /^import /m);
  }
});

test("config: user input is escaped so it cannot break or inject code", () => {
  const config = createConfigContent({ language: "js", testDir: "it's", platform: "ios", bundleId: "x'}); require('fs'); ({a:'" });
  assert.match(config, /testDir: "\.\/it's",/);
  assert.match(config, /bundleId: "x'}\); require\('fs'\); \(\{a:'",/);
});

test("config: bundleId is omitted when left empty", () => {
  assert.doesNotMatch(createConfigContent({ language: "ts", testDir: "tests", platform: "ios", bundleId: "" }), /bundleId/);
});

test("example test has no unused fixtures (fails noUnusedParameters and eslint otherwise)", () => {
  assert.match(createTestContent("ts"), /async \(\{ screen \}\)/);
});

test("tsconfig: loads node types and includes the config and test directory", () => {
  const tsconfig = JSON.parse(createTsconfigContent("mobile-tests"));
  assert.deepEqual(tsconfig.compilerOptions.types, ["node"]);
  assert.equal(tsconfig.compilerOptions.module, "preserve");
  assert.deepEqual(tsconfig.include, ["mobilewright.config.ts", "mobile-tests/**/*.ts"]);
});

test("gitignore: created when missing", () => {
  assert.equal(patchGitignore(undefined), "# mobilewright\nnode_modules/\n/test-results/\n/playwright-report/\n");
});

test("gitignore: only missing entries are appended", () => {
  assert.equal(patchGitignore("node_modules\n.env\n"), "node_modules\n.env\n\n# mobilewright\n/test-results/\n/playwright-report/\n");
});

test("gitignore: nothing to do when every entry exists", () => {
  assert.equal(patchGitignore("node_modules/\ntest-results/\n/playwright-report\n"), undefined);
});

test("test dir: plain projects use tests/", () => {
  const dir = createTempDir();
  assert.equal(chooseDefaultTestDir(dir, detectOtherTestRunners(dir, {})), "tests");
});

test("test dir: projects with jest, vitest or playwright use a separate directory", () => {
  const withJest = createTempDir();
  assert.deepEqual(detectOtherTestRunners(withJest, { devDependencies: { jest: "^29.0.0" } }), ["jest"]);

  const withPlaywrightConfig = createTempDir();
  writeFile(withPlaywrightConfig, "playwright.config.ts", "export default {};");
  const runners = detectOtherTestRunners(withPlaywrightConfig, { devDependencies: { vitest: "^3.0.0" } });
  assert.deepEqual(runners, ["playwright", "vitest"]);
  assert.equal(chooseDefaultTestDir(withPlaywrightConfig, runners), ISOLATED_TEST_DIR);
});

test("test dir: an existing tests/ directory with test files is not reused", () => {
  const dir = createTempDir();
  writeFile(dir, "tests/unit/sum.test.js", "");
  assert.equal(chooseDefaultTestDir(dir, []), ISOLATED_TEST_DIR);
});

test("install check: success when mobilewright and a single Playwright copy are installed", () => {
  const dir = createTempDir();
  installMobilewrightWithOnePlaywright(dir);
  assert.equal(findInstallProblem(dir), undefined);
});

test("install check: reports when mobilewright was not installed (e.g. NODE_ENV=production)", () => {
  assert.match(findInstallProblem(createTempDir()) ?? "", /mobilewright was not installed/);
});

test("install check: reports two Playwright copies caused by the project's own playwright", () => {
  const dir = createTempDir();
  installFakePackage(dir, { name: "playwright", version: "1.45.3" });
  installFakePackage(dir, { name: "@playwright/test", version: "1.45.3" });
  const mobilewright = installFakePackage(dir, { name: "mobilewright", version: ANY_MOBILEWRIGHT_VERSION });
  installFakePackage(mobilewright, { name: "playwright", version: "1.63.0" });
  const mobilewrightTest = installFakePackage(dir, { name: "@mobilewright/test", version: ANY_MOBILEWRIGHT_VERSION });
  const nestedPlaywrightTest = installFakePackage(mobilewrightTest, { name: "@playwright/test", version: "1.63.0" });
  installFakePackage(nestedPlaywrightTest, { name: "playwright", version: "1.63.0" });

  const problem = findInstallProblem(dir) ?? "";

  assert.match(problem, /Two different copies of Playwright/);
  assert.match(problem, /separate subdirectory/);
});

test("test dir: paths that escape the project are rejected", () => {
  const project = createTempDir();
  for (const input of ["../outside", "tests/../../outside", "/elsewhere/tests", ".."]) {
    assert.equal(validateTestDir(project, input), "The test directory must be inside the current project", input);
  }
  assert.equal(validateTestDir(project, "   "), "Please enter a directory name");
});

test("test dir: nested, dotted and absolute paths inside the project are accepted and normalized", () => {
  const project = createTempDir();
  for (const input of ["tests", "tests/e2e", "./tests/", path.join(project, "tests"), "..tests"]) {
    assert.equal(validateTestDir(project, input), true, input);
  }
  assert.equal(normalizeTestDir(project, "./tests/"), "tests");
  assert.equal(normalizeTestDir(project, path.join(project, "mobile", "e2e")), "mobile/e2e");
  assert.equal(normalizeTestDir(project, " tests/e2e "), "tests/e2e");
});
