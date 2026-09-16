// minimal but structurally faithful project.pbxproj / build.gradle content

export type XcodeTarget = {
  id: string;
  listId: string;
  name: string;
  productType: string;
  defaultConfiguration: string;
  configurations: { id: string; name: string; bundleId: string }[];
};

export const APPLICATION = "com.apple.product-type.application";
export const UNIT_TESTS = "com.apple.product-type.bundle.unit-test";
export const APP_EXTENSION = "com.apple.product-type.app-extension";
export const FRAMEWORK = "com.apple.product-type.framework";

let nextId = 0;
export function xcodeId(): string {
  nextId += 1;
  return nextId.toString(16).toUpperCase().padStart(24, "0");
}

export function xcodeTarget(name: string, productType: string, bundleIds: Record<string, string>, defaultConfiguration = "Release"): XcodeTarget {
  return {
    id: xcodeId(),
    listId: xcodeId(),
    name,
    productType,
    defaultConfiguration,
    configurations: Object.entries(bundleIds).map(([configName, bundleId]) => ({ id: xcodeId(), name: configName, bundleId })),
  };
}

// Xcode only quotes values containing special characters
function quoteIfNeeded(value: string): string {
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : `"${value}"`;
}

export function pbxproj(targets: XcodeTarget[]): string {
  const nativeTargets = targets.map((target) => {
    return `\t\t${target.id} /* ${target.name} */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = ${target.listId} /* Build configuration list for PBXNativeTarget "${target.name}" */;
\t\t\tbuildPhases = (
\t\t\t);
\t\t\tname = ${target.name};
\t\t\tproductName = ${target.name};
\t\t\tproductType = "${target.productType}";
\t\t};`;
  });

  const buildConfigurations = targets.flatMap((target) => target.configurations.map((config) => `\t\t${config.id} /* ${config.name} */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tINFOPLIST_FILE = ${target.name}/Info.plist;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${quoteIfNeeded(config.bundleId)};
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t};
\t\t\tname = ${config.name};
\t\t};`));

  const configurationLists = targets.map((target) => `\t\t${target.listId} /* Build configuration list for PBXNativeTarget "${target.name}" */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
${target.configurations.map((config) => `\t\t\t\t${config.id} /* ${config.name} */,`).join("\n")}
\t\t\t);
\t\t\tdefaultConfigurationName = ${target.defaultConfiguration};
\t\t};`);

  return `// !$*UTF8*$!
{
\tobjects = {

/* Begin PBXNativeTarget section */
${nativeTargets.join("\n")}
/* End PBXNativeTarget section */

/* Begin XCBuildConfiguration section */
${buildConfigurations.join("\n")}
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
${configurationLists.join("\n")}
/* End XCConfigurationList section */
\t};
}
`;
}

export function gradle(androidBlock: string): string {
  return `plugins {
    id 'com.android.application'
}

android {
${androidBlock}
}

dependencies {
    implementation 'androidx.core:core-ktx:1.13.1'
}
`;
}
