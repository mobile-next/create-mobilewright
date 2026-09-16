import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { detectApps, DetectedApp, findAndroidApplicationId, findIosAppBundleId } from "../src/detect";
import { APP_EXTENSION, APPLICATION, FRAMEWORK, gradle, pbxproj, UNIT_TESTS, xcodeTarget } from "./fixtures";
import { createTempDir, writeFile } from "./helpers";

function addXcodeProject(dir: string, relativePath: string, content: string): void {
  writeFile(dir, path.join(relativePath, "project.pbxproj"), content);
}

function appXcodeProject(bundleId: string): string {
  return pbxproj([xcodeTarget("MyApp", APPLICATION, { Debug: bundleId, Release: bundleId })]);
}

function bundleIdsOf(apps: DetectedApp[]): string[] {
  return apps.map((app) => `${app.platform}:${app.bundleId}`);
}

test("ios: picks the application target even when the unit test target is listed first", () => {
  const project = pbxproj([
    xcodeTarget("MyAppTests", UNIT_TESTS, { Debug: "com.acme.myappTests", Release: "com.acme.myappTests" }),
    xcodeTarget("MyApp", APPLICATION, { Debug: "com.acme.myapp", Release: "com.acme.myapp" }),
  ]);
  assert.equal(findIosAppBundleId(project), "com.acme.myapp");
});

test("ios: ignores widget extensions and frameworks", () => {
  const project = pbxproj([
    xcodeTarget("HomeWidget", APP_EXTENSION, { Release: "com.acme.myapp.HomeWidget" }),
    xcodeTarget("AcmeKit", FRAMEWORK, { Release: "com.acme.AcmeKit" }),
    xcodeTarget("MyApp", APPLICATION, { Release: "com.acme.myapp" }),
  ]);
  assert.equal(findIosAppBundleId(project), "com.acme.myapp");
});

test("ios: prefers the Release configuration over a Debug suffix", () => {
  const project = pbxproj([xcodeTarget("MyApp", APPLICATION, { Debug: "com.acme.myapp.dev", Release: "com.acme.myapp" })]);
  assert.equal(findIosAppBundleId(project), "com.acme.myapp");
});

test("ios: never suggests unresolved build settings like $(PRODUCT_NAME:rfc1034identifier)", () => {
  const project = pbxproj([
    xcodeTarget("MyApp", APPLICATION, { Debug: "org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)", Release: "${BUNDLE_PREFIX}.myapp" }),
  ]);
  assert.equal(findIosAppBundleId(project), undefined);
});

test("ios: a project with only a framework target yields nothing", () => {
  assert.equal(findIosAppBundleId(pbxproj([xcodeTarget("AcmeKit", FRAMEWORK, { Release: "com.acme.AcmeKit" })])), undefined);
});

test("android: reads single and double quoted applicationId from defaultConfig", () => {
  assert.equal(findAndroidApplicationId(gradle(`defaultConfig {\n  applicationId 'com.acme.single'\n}`)), "com.acme.single");
  assert.equal(findAndroidApplicationId(gradle(`defaultConfig {\n  applicationId = "com.acme.kts"\n}`)), "com.acme.kts");
});

test("android: ignores a commented-out applicationId", () => {
  const content = gradle(`defaultConfig {\n  // applicationId "com.acme.oldshop"\n  /* applicationId "com.acme.older" */\n  applicationId "com.acme.shop"\n}`);
  assert.equal(findAndroidApplicationId(content), "com.acme.shop");
});

test("android: defaultConfig wins over a product flavor listed first", () => {
  const content = gradle(`productFlavors {\n  staging {\n    applicationId = "com.acme.shop.staging"\n  }\n}\ndefaultConfig {\n  applicationId = "com.acme.shop"\n  applicationIdSuffix = ".debug"\n}`);
  assert.equal(findAndroidApplicationId(content), "com.acme.shop");
});

test("android: a variable applicationId is not replaced by a different namespace", () => {
  const content = gradle(`namespace "com.acme.core"\ndefaultConfig {\n  applicationId appIdFromProperties\n}`);
  assert.equal(findAndroidApplicationId(content), undefined);
});

test("android: without applicationId, the namespace is the application id", () => {
  assert.equal(findAndroidApplicationId(gradle(`namespace = "com.acme.nsonly"\ndefaultConfig {\n  minSdk = 24\n}`)), "com.acme.nsonly");
});

test("detectApps: react native layout with ios/ and android/ subdirectories", () => {
  const dir = createTempDir();
  addXcodeProject(dir, "ios/MyApp.xcodeproj", appXcodeProject("com.acme.rn"));
  writeFile(dir, "android/app/build.gradle", gradle(`defaultConfig {\n  applicationId "com.acme.rn.android"\n}`));

  const apps = detectApps(dir);

  assert.deepEqual(bundleIdsOf(apps), ["ios:com.acme.rn", "android:com.acme.rn.android"]);
  assert.equal(apps[0].source, path.join("ios", "MyApp.xcodeproj"));
});

test("detectApps: finds the app when running from an e2e/ subdirectory", () => {
  const root = createTempDir();
  addXcodeProject(root, "ios/MyApp.xcodeproj", appXcodeProject("com.acme.fromparent"));
  const e2e = path.join(root, "e2e");
  fs.mkdirSync(e2e);

  assert.deepEqual(bundleIdsOf(detectApps(e2e)), ["ios:com.acme.fromparent"]);
});

test("detectApps: reads expo app.json", () => {
  const dir = createTempDir();
  writeFile(dir, "app.json", JSON.stringify({ expo: { ios: { bundleIdentifier: "com.acme.expo" }, android: { package: "com.acme.expo.android" } } }));

  assert.deepEqual(bundleIdsOf(detectApps(dir)), ["ios:com.acme.expo", "android:com.acme.expo.android"]);
});

test("detectApps: skips the framework project when there are several .xcodeproj", () => {
  const dir = createTempDir();
  addXcodeProject(dir, "AcmeKit.xcodeproj", pbxproj([xcodeTarget("AcmeKit", FRAMEWORK, { Release: "com.acme.AcmeKit" })]));
  addXcodeProject(dir, "MyApp.xcodeproj", appXcodeProject("com.acme.myapp"));

  assert.deepEqual(bundleIdsOf(detectApps(dir)), ["ios:com.acme.myapp"]);
});

test("detectApps: an unreadable project file does not crash", { skip: process.getuid?.() === 0 }, () => {
  const dir = createTempDir();
  addXcodeProject(dir, "MyApp.xcodeproj", appXcodeProject("com.acme.myapp"));
  const pbxprojPath = path.join(dir, "MyApp.xcodeproj", "project.pbxproj");
  fs.chmodSync(pbxprojPath, 0o000);
  try {
    assert.deepEqual(detectApps(dir), []);
  } finally {
    fs.chmodSync(pbxprojPath, 0o644);
  }
});

test("detectApps: an empty directory yields nothing", () => {
  assert.deepEqual(detectApps(createTempDir()), []);
});
