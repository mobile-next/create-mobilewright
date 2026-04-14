#!/usr/bin/env node

import prompts from "prompts";

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

  const { language, testDir } = response;

  if (!language || !testDir) {
    process.exit(0);
  }

  console.log(`Language: ${language}, Test dir: ${testDir}`);
}

main();
