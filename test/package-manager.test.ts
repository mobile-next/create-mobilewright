import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProjectCommand,
  detectPackageManager,
  isWorkspaceRoot,
  installAllCommand,
  installDevCommand,
  installProdCommand,
  PackageManager,
  runCommand,
} from "../src/package-manager";
import fs from "fs";
import path from "path";
import { createTempDir, writeFile } from "./helpers";

const NPM_USER_AGENT = "npm/11.19.0 node/v24.21.0 darwin arm64 workspaces/false";
const PNPM_USER_AGENT = "pnpm/12.4.2 npm/? node/v24.21.0 darwin arm64";
const YARN_CLASSIC_USER_AGENT = "yarn/1.22.22 npm/? node/v24.21.0 darwin arm64";
const YARN_BERRY_USER_AGENT = "yarn/4.18.0 npm/? node/v24.21.0 darwin arm64";
const BUN_USER_AGENT = "bun/1.3.14 npm/? node/v24.3.0 darwin arm64";

function projectWith(files: Record<string, string>): string {
  const dir = createTempDir();
  for (const [name, content] of Object.entries(files)) writeFile(dir, name, content);
  return dir;
}

test("a lockfile decides the package manager, whichever tool started us", () => {
  assert.equal(detectPackageManager(projectWith({ "pnpm-lock.yaml": "" }), undefined, NPM_USER_AGENT), "pnpm");
  assert.equal(detectPackageManager(projectWith({ "bun.lockb": "" }), undefined, NPM_USER_AGENT), "bun");
  assert.equal(detectPackageManager(projectWith({ "package-lock.json": "{}" }), undefined, PNPM_USER_AGENT), "npm");
});

test("a yarn.lock without .yarnrc.yml means yarn classic, with it means berry", () => {
  assert.equal(detectPackageManager(projectWith({ "yarn.lock": "" })), "yarn-classic");
  assert.equal(detectPackageManager(projectWith({ "yarn.lock": "", ".yarnrc.yml": "nodeLinker: pnp" })), "yarn");
});

test("the packageManager field is used when there is no lockfile", () => {
  assert.equal(detectPackageManager(createTempDir(), "pnpm@9.12.0", NPM_USER_AGENT), "pnpm");
  assert.equal(detectPackageManager(createTempDir(), "yarn@4.18.0"), "yarn");
});

test("otherwise the tool that started us decides", () => {
  assert.equal(detectPackageManager(createTempDir(), undefined, PNPM_USER_AGENT), "pnpm");
  assert.equal(detectPackageManager(createTempDir(), undefined, YARN_CLASSIC_USER_AGENT), "yarn-classic");
  assert.equal(detectPackageManager(createTempDir(), undefined, YARN_BERRY_USER_AGENT), "yarn");
  assert.equal(detectPackageManager(createTempDir(), undefined, BUN_USER_AGENT), "bun");
  assert.equal(detectPackageManager(createTempDir(), undefined, undefined), "npm");
  assert.equal(detectPackageManager(createTempDir(), undefined, "deno/2.0.0"), "npm");
});

test("a package inside a workspace uses the workspace root's package manager", () => {
  const root = projectWith({ "pnpm-lock.yaml": "", "pnpm-workspace.yaml": "packages:\n  - packages/*" });
  const child = path.join(root, "packages", "app");
  fs.mkdirSync(child, { recursive: true });
  writeFile(child, "package.json", '{"name":"app"}');

  assert.equal(detectPackageManager(child, undefined, NPM_USER_AGENT), "pnpm");
  assert.equal(detectPackageManager(root, undefined, NPM_USER_AGENT), "pnpm");
});

test("a lockfile outside the repository, for example in the home directory, is ignored", () => {
  const home = createTempDir("home");
  writeFile(home, "yarn.lock", "");
  const project = path.join(home, "my-project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  writeFile(project, "package.json", '{"name":"my-project"}');
  const nested = path.join(project, "e2e");
  fs.mkdirSync(nested);

  assert.equal(detectPackageManager(project, undefined, NPM_USER_AGENT, home), "npm");
  assert.equal(detectPackageManager(nested, undefined, NPM_USER_AGENT, home), "npm");
});

test("pnpm workspace roots are recognized without a workspaces field in package.json", () => {
  assert.equal(isWorkspaceRoot(projectWith({ "pnpm-workspace.yaml": "packages:\n  - packages/*" }), undefined), true);
  assert.equal(isWorkspaceRoot(createTempDir(), ["packages/*"]), true);
  assert.equal(isWorkspaceRoot(createTempDir(), undefined), false);
});

test("each package manager gets its own install commands", () => {
  const expected: Record<PackageManager, [string, string]> = {
    npm: ['npm install --save-dev --include=dev "mobilewright@latest"', "npm install --include=dev"],
    pnpm: ['pnpm add --save-dev "mobilewright@latest"', "pnpm install"],
    yarn: ['yarn add --dev "mobilewright@latest"', "yarn install"],
    "yarn-classic": ['yarn add --dev "mobilewright@latest"', "yarn install"],
    bun: ['bun add --development "mobilewright@latest"', "bun install"],
  };
  for (const [packageManager, [dev, all]] of Object.entries(expected) as [PackageManager, [string, string]][]) {
    assert.equal(installDevCommand(packageManager, ["mobilewright@latest"]), dev);
    assert.equal(installAllCommand(packageManager), all);
  }
});

test("yarn classic and pnpm need a workspace flag in a workspace root", () => {
  assert.equal(installDevCommand("yarn-classic", ["mobilewright@latest"], true), 'yarn add --dev -W "mobilewright@latest"');
  assert.equal(installProdCommand("pnpm", ["mobilewright@latest"], true), 'pnpm add -w "mobilewright@latest"');
  assert.equal(installDevCommand("yarn", ["mobilewright@latest"], true), 'yarn add --dev "mobilewright@latest"');
  assert.equal(installDevCommand("npm", ["mobilewright@latest"], true), 'npm install --save-dev --include=dev "mobilewright@latest"');
});

test("the printed run command matches the package manager", () => {
  assert.equal(runCommand("npm", "test"), "npx mobilewright test");
  assert.equal(runCommand("pnpm", "test --list"), "pnpm exec mobilewright test --list");
  assert.equal(runCommand("yarn-classic", "doctor"), "yarn mobilewright doctor");
  assert.equal(runCommand("bun", "test"), "bunx mobilewright test");
});

test("the retry hint uses the same package manager", () => {
  assert.equal(createProjectCommand("npm"), "npm init mobilewright@latest");
  assert.equal(createProjectCommand("pnpm"), "pnpm create mobilewright");
  assert.equal(createProjectCommand("bun"), "bun create mobilewright");
});
