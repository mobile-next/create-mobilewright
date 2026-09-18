import fs from "fs";
import path from "path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "yarn-classic" | "bun";

type Lockfile = {
  file: string;
  packageManager: PackageManager;
};

const LOCKFILES: Lockfile[] = [
  { file: "pnpm-lock.yaml", packageManager: "pnpm" },
  { file: "bun.lock", packageManager: "bun" },
  { file: "bun.lockb", packageManager: "bun" },
  { file: "yarn.lock", packageManager: "yarn" },
  { file: "package-lock.json", packageManager: "npm" },
];

function isYarnClassic(targetDir: string, version: string | undefined): boolean {
  // berry keeps its settings in .yarnrc.yml; yarn 1 has no such file
  if (fs.existsSync(path.join(targetDir, ".yarnrc.yml"))) return false;
  return version === undefined || version.startsWith("0.") || version.startsWith("1.");
}

function fromUserAgent(targetDir: string, userAgent: string): PackageManager | undefined {
  const match = userAgent.match(/^(npm|pnpm|yarn|bun)\/(\S+)/);
  if (!match) return undefined;
  const [, name, version] = match;
  if (name === "yarn") return isYarnClassic(targetDir, version) ? "yarn-classic" : "yarn";
  return name as PackageManager;
}

/**
 * The lockfile in the project wins over the tool that started us: `npm init mobilewright`
 * inside a pnpm project should still install with pnpm.
 */
export function detectPackageManager(targetDir: string, packageManagerField?: string, userAgent = process.env.npm_config_user_agent): PackageManager {
  const lockfile = LOCKFILES.find((candidate) => fs.existsSync(path.join(targetDir, candidate.file)));
  const declared = packageManagerField?.match(/^(npm|pnpm|yarn|bun)@?(\S+)?/);
  const detected = lockfile?.packageManager ?? (declared ? (declared[1] as PackageManager) : undefined);

  if (detected === "yarn") {
    return isYarnClassic(targetDir, declared?.[1] === "yarn" ? declared[2] : undefined) ? "yarn-classic" : "yarn";
  }
  if (detected) return detected;
  return (userAgent ? fromUserAgent(targetDir, userAgent) : undefined) ?? "npm";
}

// yarn 1 and pnpm refuse to add a dependency in a workspace root without this flag
function workspaceFlag(packageManager: PackageManager, isWorkspaceRoot: boolean): string {
  if (!isWorkspaceRoot) return "";
  if (packageManager === "pnpm") return "-w ";
  return packageManager === "yarn-classic" ? "-W " : "";
}

export function installDevCommand(packageManager: PackageManager, specs: string[], isWorkspaceRoot = false): string {
  const quoted = specs.map((spec) => `"${spec}"`).join(" ");
  const workspace = workspaceFlag(packageManager, isWorkspaceRoot);
  switch (packageManager) {
    case "pnpm":
      return `pnpm add --save-dev ${workspace}${quoted}`;
    case "yarn":
    case "yarn-classic":
      return `yarn add --dev ${workspace}${quoted}`;
    case "bun":
      return `bun add --development ${quoted}`;
    case "npm":
      // --include=dev: otherwise NODE_ENV=production silently skips devDependencies
      return `npm install --save-dev --include=dev ${quoted}`;
  }
}

export function installProdCommand(packageManager: PackageManager, specs: string[], isWorkspaceRoot = false): string {
  const quoted = specs.map((spec) => `"${spec}"`).join(" ");
  const workspace = workspaceFlag(packageManager, isWorkspaceRoot);
  switch (packageManager) {
    case "pnpm":
      return `pnpm add ${workspace}${quoted}`;
    case "yarn":
    case "yarn-classic":
      return `yarn add ${workspace}${quoted}`;
    case "bun":
      return `bun add ${quoted}`;
    case "npm":
      return `npm install --save-prod --include=dev ${quoted}`;
  }
}

export function installAllCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm install";
    case "yarn":
    case "yarn-classic":
      return "yarn install";
    case "bun":
      return "bun install";
    case "npm":
      return "npm install --include=dev";
  }
}

/** How the user runs the mobilewright binary that was just installed. */
export function runCommand(packageManager: PackageManager, args: string): string {
  switch (packageManager) {
    case "pnpm":
      return `pnpm exec mobilewright ${args}`;
    case "yarn":
    case "yarn-classic":
      return `yarn mobilewright ${args}`;
    case "bun":
      return `bunx mobilewright ${args}`;
    case "npm":
      return `npx mobilewright ${args}`;
  }
}

export function createProjectCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm create mobilewright";
    case "yarn":
    case "yarn-classic":
      return "yarn create mobilewright";
    case "bun":
      return "bun create mobilewright";
    case "npm":
      return "npm init mobilewright@latest";
  }
}
