import fs from "fs";
import path from "path";

export type Platform = "ios" | "android";

export type DetectedApp = {
  platform: Platform;
  bundleId: string;
  source: string;
};

type BuildConfiguration = {
  name: string;
  bundleId?: string;
};

const TEST_DIR_NAMES = ["test", "tests", "e2e", "integration_test"];
const XCODE_APPLICATION_PRODUCT_TYPE = '"com.apple.product-type.application"';

function readTextFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// ponytail: only looks one level up (from tests/, e2e/...), walk to the git root if monorepos need it
function getSearchRoots(cwd: string): string[] {
  const basename = path.basename(cwd).toLowerCase();
  return TEST_DIR_NAMES.includes(basename) ? [cwd, path.dirname(cwd)] : [cwd];
}

function isUnresolvedBuildSetting(value: string): boolean {
  return value.includes("$(") || value.includes("${");
}

function unquote(value: string): string {
  return value.trim().replace(/^"(.*)"$/, "$1");
}

function findObjectBody(pbxproj: string, id: string, isa: string): string | undefined {
  const pattern = new RegExp(`${id}(?: /\\*[^*]*\\*/)? = \\{\\s*isa = ${isa};([\\s\\S]*?)\\n\\s*\\};`);
  return pbxproj.match(pattern)?.[1];
}

function readBuildConfiguration(pbxproj: string, id: string): BuildConfiguration {
  const pattern = new RegExp(`${id}(?: /\\*[^*]*\\*/)? = \\{\\s*isa = XCBuildConfiguration;[\\s\\S]*?buildSettings = \\{([\\s\\S]*?)\\n\\s*\\};([\\s\\S]*?)\\n\\s*\\};`);
  const match = pbxproj.match(pattern);
  const buildSettings = match?.[1] ?? "";
  const rest = match?.[2] ?? "";
  const name = unquote(rest.match(/name = ([^;]+);/)?.[1] ?? "");
  const bundleId = buildSettings.match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/)?.[1];
  return { name, bundleId: bundleId === undefined ? undefined : unquote(bundleId) };
}

function listApplicationTargetConfigurationListIds(pbxproj: string): string[] {
  const targetPattern = /([0-9A-Fa-f]{24})(?: \/\*[^*]*\*\/)? = \{\s*isa = PBXNativeTarget;([\s\S]*?)\n\s*\};/g;
  return [...pbxproj.matchAll(targetPattern)]
    .map((match) => match[2])
    .filter((body) => body.includes(`productType = ${XCODE_APPLICATION_PRODUCT_TYPE};`))
    .map((body) => body.match(/buildConfigurationList = ([0-9A-Fa-f]{24})/)?.[1])
    .filter((id): id is string => id !== undefined);
}

export function findIosAppBundleId(pbxproj: string): string | undefined {
  for (const listId of listApplicationTargetConfigurationListIds(pbxproj)) {
    const listBody = findObjectBody(pbxproj, listId, "XCConfigurationList") ?? "";
    const configurationIds = listBody.match(/buildConfigurations = \(([\s\S]*?)\);/)?.[1].match(/[0-9A-Fa-f]{24}/g) ?? [];
    const usable = configurationIds
      .map((id) => readBuildConfiguration(pbxproj, id))
      .filter((config) => config.bundleId !== undefined && !isUnresolvedBuildSetting(config.bundleId));
    const defaultName = unquote(listBody.match(/defaultConfigurationName = ([^;]+);/)?.[1] ?? "");
    const chosen = usable.find((config) => config.name === "Release")
      ?? usable.find((config) => config.name === defaultName)
      ?? usable[0];
    if (chosen?.bundleId) return chosen.bundleId;
  }
  return undefined;
}

function stripGradleComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function extractBlock(content: string, blockName: string): string | undefined {
  const start = content.search(new RegExp(`\\b${blockName}\\s*\\{`));
  if (start === -1) return undefined;
  const open = content.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    if (content[i] === "{") depth++;
    if (content[i] === "}") depth--;
    if (depth === 0) return content.slice(open + 1, i);
  }
  return undefined;
}

export function findAndroidApplicationId(gradle: string): string | undefined {
  const content = stripGradleComments(gradle);
  const defaultConfig = extractBlock(content, "defaultConfig") ?? "";
  if (/\bapplicationId\b(?!Suffix)/.test(defaultConfig)) {
    // a non-literal applicationId (variable, function call) can't be resolved, so don't guess
    return defaultConfig.match(/\bapplicationId\s*=?\s*["']([^"'$]+)["']/)?.[1];
  }
  // without an applicationId, the Android Gradle Plugin uses the namespace
  return content.match(/\bnamespace\s*=?\s*["']([^"'$]+)["']/)?.[1];
}

function detectIosApps(dir: string, root: string): DetectedApp[] {
  return listDir(dir)
    .filter((entry) => entry.endsWith(".xcodeproj"))
    .flatMap((entry) => {
      const pbxproj = readTextFile(path.join(dir, entry, "project.pbxproj"));
      const bundleId = pbxproj === undefined ? undefined : findIosAppBundleId(pbxproj);
      const source = path.relative(root, path.join(dir, entry)) || entry;
      return bundleId ? [{ platform: "ios" as const, bundleId, source }] : [];
    });
}

function detectAndroidApps(dir: string, root: string): DetectedApp[] {
  for (const filename of ["build.gradle.kts", "build.gradle"]) {
    const gradlePath = path.join(dir, "app", filename);
    const gradle = readTextFile(gradlePath);
    const applicationId = gradle === undefined ? undefined : findAndroidApplicationId(gradle);
    if (applicationId) return [{ platform: "android", bundleId: applicationId, source: path.relative(root, gradlePath) }];
  }
  return [];
}

function detectExpoApps(dir: string, root: string): DetectedApp[] {
  const appJsonPath = path.join(dir, "app.json");
  const raw = readTextFile(appJsonPath);
  if (raw === undefined) return [];
  try {
    const parsed = JSON.parse(raw);
    const expo = parsed.expo ?? parsed;
    const source = path.relative(root, appJsonPath);
    const apps: DetectedApp[] = [];
    if (typeof expo.ios?.bundleIdentifier === "string") apps.push({ platform: "ios", bundleId: expo.ios.bundleIdentifier, source });
    if (typeof expo.android?.package === "string") apps.push({ platform: "android", bundleId: expo.android.package, source });
    return apps;
  } catch {
    return [];
  }
}

export function detectApps(cwd: string): DetectedApp[] {
  const apps = getSearchRoots(cwd).flatMap((root) => [
    ...detectIosApps(root, cwd),
    ...detectIosApps(path.join(root, "ios"), cwd),
    ...detectAndroidApps(root, cwd),
    ...detectAndroidApps(path.join(root, "android"), cwd),
    ...detectExpoApps(root, cwd),
  ]);
  const seen = new Set<string>();
  return apps.filter((app) => {
    const key = `${app.platform}:${app.bundleId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
