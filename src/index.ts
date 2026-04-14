#!/usr/bin/env node

import fs from "fs";
import path from "path";
import prompts from "prompts";
import spawn from "cross-spawn";

type Language = "ts" | "js";

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
    "@mobilewright/test": "latest",
  };

  if (language === "ts") {
    devDeps["@types/node"] = "latest";
  }

  pkg.devDependencies = devDeps;

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

function createConfigFile(targetDir: string, language: Language): void {
  const ext = language === "ts" ? "ts" : "js";
  const configPath = path.join(targetDir, `mobilewright.config.${ext}`);
  const content =
    language === "ts" ? "export default {};\n" : "module.exports = {};\n";

  fs.writeFileSync(configPath, content);
}

function createTestFile(targetDir: string, testDir: string, language: Language): void {
  const ext = language === "ts" ? "ts" : "js";
  const fullTestDir = path.join(targetDir, testDir);
  fs.mkdirSync(fullTestDir, { recursive: true });
  fs.writeFileSync(path.join(fullTestDir, `example.spec.${ext}`), "");
}

function runNpmInstall(targetDir: string): void {
  console.log("\nInstalling dependencies...\n");

  const result = spawn.sync("npm", ["install"], {
    cwd: targetDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error("Failed to install dependencies.");
    process.exit(1);
  }
}

async function main() {
  console.log(
    "Getting started with writing mobile automation and end-to-end tests"
  );

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
    ],
    {
      onCancel: () => {
        process.exit(0);
      },
    }
  );

  const { language, testDir } = response as {
    language: Language;
    testDir: string;
  };

  if (!language || !testDir) {
    process.exit(0);
  }

  const targetDir = process.cwd();

  createPackageJson(targetDir, language);
  createConfigFile(targetDir, language);
  createTestFile(targetDir, testDir, language);

  runNpmInstall(targetDir);

  console.log(`
Success! Created mobilewright project.

Inside the "${testDir}" directory, you can run:
  npx mobilewright test

Visit https://mobilewright.dev for more information.`);
}

main();
