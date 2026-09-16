#!/usr/bin/env node

import "./no-color";
import fs from "fs";
import path from "path";
import prompts from "prompts";
import { execSync } from "child_process";
import { detectApps, DetectedApp, Platform } from "./detect";
import {
  chooseDefaultTestDir,
  createConfigContent,
  createNewPackageJson,
  createTestContent,
  createTsconfigContent,
  describeRunnerExclusion,
  detectOtherTestRunners,
  findInstallProblem,
  isSupportedNodeVersion,
  Language,
  MINIMUM_NODE_VERSION,
  normalizeTestDir,
  patchGitignore,
  readPackageJson,
  TestRunner,
  updatePackageJson,
  UserFacingError,
  validateTestDir,
} from "./project";

type Answers = {
  language: Language;
  platform: Platform;
  bundleId: string;
  testDir: string;
};

const CANCELLED_EXIT_CODE = 130;

function exitIfNodeIsUnsupported(): void {
  const version = process.versions.node;
  if (isSupportedNodeVersion(version)) return;
  console.error(`mobilewright requires Node.js ${MINIMUM_NODE_VERSION} or newer (you have ${version}).`);
  console.error("Upgrade Node.js (for example: nvm install 24) and run npm init mobilewright@latest again.");
  process.exit(1);
}

function findDetectedApp(apps: DetectedApp[], platform: Platform): DetectedApp | undefined {
  return apps.find((app) => app.platform === platform);
}

async function askQuestions(targetDir: string, apps: DetectedApp[], defaultTestDir: string): Promise<Answers> {
  const platforms: Platform[] = ["ios", "android"];
  const detectedPlatform = apps[0]?.platform ?? "ios";

  const response = await prompts(
    [
      {
        type: "select",
        name: "language",
        message: "Do you want to use TypeScript or JavaScript?",
        choices: [
          { title: "TypeScript", value: "ts" },
          { title: "JavaScript", value: "js" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "platform",
        message: "Which platform do you want to test?",
        choices: [
          { title: "iOS", value: "ios" },
          { title: "Android", value: "android" },
        ],
        initial: platforms.indexOf(detectedPlatform),
      },
      {
        type: "text",
        name: "bundleId",
        message: (platform: Platform) => {
          const detected = findDetectedApp(apps, platform);
          const hint = detected ? `detected from ${detected.source}` : "leave empty to skip";
          return `What is the app bundle ID to test? (${hint})`;
        },
        initial: (platform: Platform) => findDetectedApp(apps, platform)?.bundleId ?? "",
        format: (value: string) => value.trim(),
      },
      {
        type: "text",
        name: "testDir",
        message: "Directory name for test files?",
        initial: defaultTestDir,
        format: (value: string) => normalizeTestDir(targetDir, value),
        validate: (value: string) => validateTestDir(targetDir, value),
      },
    ],
    {
      onCancel: () => {
        console.log("\nCancelled. No files were changed.");
        process.exit(CANCELLED_EXIT_CODE);
      },
    }
  );
  return response as Answers;
}

function writeFileIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content);
}

function writeProjectFiles(targetDir: string, answers: Answers): void {
  const { language, testDir } = answers;
  const validation = validateTestDir(targetDir, testDir);
  if (validation !== true) throw new UserFacingError(validation);
  const pkgPath = path.join(targetDir, "package.json");
  const pkg = readPackageJson(pkgPath) ?? createNewPackageJson(targetDir);
  fs.writeFileSync(pkgPath, JSON.stringify(updatePackageJson(pkg, language, process.versions.node), null, 2) + "\n");

  fs.writeFileSync(path.join(targetDir, `mobilewright.config.${language}`), createConfigContent(answers));

  const fullTestDir = path.join(targetDir, testDir);
  fs.mkdirSync(fullTestDir, { recursive: true });
  fs.writeFileSync(path.join(fullTestDir, `example.spec.${language}`), createTestContent(language));

  if (language === "ts") {
    writeFileIfMissing(path.join(targetDir, "tsconfig.json"), createTsconfigContent(testDir));
  }

  const gitignorePath = path.join(targetDir, ".gitignore");
  const gitignore = patchGitignore(fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : undefined);
  if (gitignore !== undefined) fs.writeFileSync(gitignorePath, gitignore);
}

function runNpmInstall(targetDir: string): void {
  console.log("\nInstalling dependencies...\n");

  try {
    // --include=dev: otherwise NODE_ENV=production silently skips every devDependency
    execSync("npm install --include=dev", {
      cwd: targetDir,
      stdio: "inherit",
    });
  } catch {
    console.error("Failed to install dependencies.");
    process.exit(1);
  }
}

function printSuccess(runners: TestRunner[], testDir: string): void {
  console.log(`
Success! Created mobilewright project.

From this directory, you can run:
  npx mobilewright test

Visit https://mobilewright.dev for more information.`);

  if (runners.length > 0) {
    console.log(`
Your project also uses ${runners.join(", ")}. To keep it from picking up the mobile tests in "${testDir}":`);
    for (const runner of runners) {
      console.log(`  ${describeRunnerExclusion(runner, testDir)}`);
    }
  }
}

async function main() {
  exitIfNodeIsUnsupported();

  console.log(
    "Getting started with writing mobile automation and end-to-end tests"
  );

  const targetDir = process.cwd();
  const existingPkg = readPackageJson(path.join(targetDir, "package.json")) ?? {};
  const runners = detectOtherTestRunners(targetDir, existingPkg);
  const answers = await askQuestions(targetDir, detectApps(targetDir), chooseDefaultTestDir(targetDir, runners));

  writeProjectFiles(targetDir, answers);
  runNpmInstall(targetDir);

  const problem = findInstallProblem(targetDir);
  if (problem) {
    console.error(`\n${problem}`);
    process.exit(1);
  }

  printSuccess(runners, answers.testDir);
}

main().catch((error) => {
  if (error instanceof UserFacingError) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
