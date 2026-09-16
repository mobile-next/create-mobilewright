import fs from "fs";
import os from "os";
import path from "path";

export type FakePackage = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
};

export function createTempDir(name = "project"): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "create-mobilewright-")), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeFile(dir: string, relativePath: string, content: string): string {
  const filePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

export function installFakePackage(nodeModulesParent: string, pkg: FakePackage): string {
  const packageDir = path.join(nodeModulesParent, "node_modules", pkg.name);
  writeFile(packageDir, "package.json", JSON.stringify(pkg));
  return packageDir;
}
