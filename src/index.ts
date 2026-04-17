#!/usr/bin/env node

import fs from "fs";
import path from "path";
import prompts from "prompts";
import { execSync } from "child_process";

type Language = "ts" | "js";

function getSearchDirs(cwd: string): string[] {
  const dirs = [cwd];
  const basename = path.basename(cwd).toLowerCase();
  if (basename === "test" || basename === "tests") {
    dirs.push(path.dirname(cwd));
  }
  return dirs;
}

function detectIosBundleId(dirs: string[]): string | undefined {
  for (const dir of dirs) {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry.endsWith(".xcodeproj")) {
        const pbxprojPath = path.join(dir, entry, "project.pbxproj");
        if (fs.existsSync(pbxprojPath)) {
          const content = fs.readFileSync(pbxprojPath, "utf-8");
          const match = content.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";]+)"?\s*;/);
          if (match) {
            return match[1].trim();
          }
        }
      }
    }
  }
  return undefined;
}

function detectAndroidPackageName(dirs: string[]): string | undefined {
  for (const dir of dirs) {
    const appDir = path.join(dir, "app");
    if (!fs.existsSync(appDir)) continue;

    for (const filename of ["build.gradle.kts", "build.gradle"]) {
      const gradlePath = path.join(appDir, filename);
      if (!fs.existsSync(gradlePath)) continue;

      const content = fs.readFileSync(gradlePath, "utf-8");
      const appIdMatch = content.match(/applicationId\s*=?\s*"([^"]+)"/);
      if (appIdMatch) return appIdMatch[1];

      const namespaceMatch = content.match(/namespace\s*=?\s*"([^"]+)"/);
      if (namespaceMatch) return namespaceMatch[1];
    }
  }
  return undefined;
}

function detectBundleId(): string {
  const dirs = getSearchDirs(process.cwd());
  return detectIosBundleId(dirs) ?? detectAndroidPackageName(dirs) ?? "";
}

function createPackageJson(targetDir: string, language: Language): void {
  const pkgPath = path.join(targetDir, "package.json");

  let pkg: Record<string, unknown> = {};
  if (fs.existsSync(pkgPath)) {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  }

  const devDeps: Record<string, string> = {
    ...(typeof pkg.devDependencies === "object" && pkg.devDependencies !== null
      ? (pkg.devDependencies as Record<string, string>)
      : {}),
    "@mobilewright/test": "0.0.22",
    "mobilewright": "0.0.22",
  };

  if (language === "ts") {
    devDeps["@types/node"] = "latest";
  }

  pkg.devDependencies = devDeps;

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

function createConfigFile(targetDir: string, testDir: string, language: Language, bundleId: string): void {
  const ext = language === "ts" ? "ts" : "js";
  const configPath = path.join(targetDir, `mobilewright.config.${ext}`);

  const importLine = language === "ts"
    ? `import { defineConfig } from 'mobilewright';\n`
    : `const { defineConfig } = require('mobilewright');\n`;

  const exportLine = language === "ts"
    ? "export default defineConfig"
    : "module.exports = defineConfig";

  const bundleIdLine = bundleId ? `\n  bundleId: '${bundleId}',` : "";

  const content = `${importLine}
${exportLine}({
  testDir: './${testDir}',${bundleIdLine}
  reporter: 'html',
});
`;

  fs.writeFileSync(configPath, content);
}

function createTestFile(targetDir: string, testDir: string, language: Language): void {
  const ext = language === "ts" ? "ts" : "js";
  const fullTestDir = path.join(targetDir, testDir);
  fs.mkdirSync(fullTestDir, { recursive: true });
  const importLine = language === "ts"
    ? `import { test, expect } from '@mobilewright/test';`
    : `const { test, expect } = require('@mobilewright/test');`;

  const content = `${importLine}

test('app launches and shows home screen', async ({ screen }) => {
  await expect(screen.getByText('Welcome')).toBeVisible();
});
`;
  fs.writeFileSync(path.join(fullTestDir, `example.spec.${ext}`), content);
}

function runNpmInstall(targetDir: string): void {
  console.log("\nInstalling dependencies...\n");

  try {
    execSync("npm install", {
      cwd: targetDir,
      stdio: "inherit",
    });
  } catch {
    console.error("Failed to install dependencies.");
    process.exit(1);
  }
}

async function main() {
  console.log(
    "Getting started with writing mobile automation and end-to-end tests"
  );

  const detectedBundleId = detectBundleId();

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
        type: "text",
        name: "testDir",
        message: "Directory name for test files?",
        initial: "tests",
      },
      {
        type: "text",
        name: "bundleId",
        message: "What is the app bundle ID to test? (Leave empty to skip)",
        initial: detectedBundleId,
      },
    ],
    {
      onCancel: () => {
        process.exit(0);
      },
    }
  );

  const { language, testDir, bundleId } = response as {
    language: Language;
    testDir: string;
    bundleId: string;
  };

  if (!language || !testDir) {
    process.exit(0);
  }

  const targetDir = process.cwd();

  createPackageJson(targetDir, language);
  createConfigFile(targetDir, testDir, language, bundleId);
  createTestFile(targetDir, testDir, language);

  runNpmInstall(targetDir);

  console.log(`
Success! Created mobilewright project.

Inside the "${testDir}" directory, you can run:
  npx mobilewright test

Visit https://mobilewright.dev for more information.`);
}

main();
