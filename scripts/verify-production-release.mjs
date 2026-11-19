import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const minimumNext = [16, 4, 5];
const apps = [
  { name: "storefront", directory: "outputs/geme" },
  { name: "admin", directory: "outputs/geme-admin" },
];

function parseVersion(version, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`${label} must pin a stable Next.js version; received ${JSON.stringify(version)}.`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function readNextVersion(app) {
  const directory = path.join(root, app.directory);
  const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  const lock = readFileSync(path.join(directory, "pnpm-lock.yaml"), "utf8");
  const version = manifest.dependencies?.next;
  const parsed = parseVersion(version, `${app.name} package.json`);
  const importer = /^\s{6}next:\r?\n^\s{8}specifier:\s*(\S+)\r?\n^\s{8}version:\s*([^\r\n]+)/m.exec(lock);

  if (!importer || importer[1] !== version || !importer[2].startsWith(`${version}(`)) {
    throw new Error(`${app.name} package.json and pnpm-lock.yaml do not pin the same Next.js version.`);
  }
  if (compareVersions(parsed, minimumNext) < 0) {
    throw new Error(`${app.name} must use Next.js 16.4.5 or newer for the production security baseline; found ${version}.`);
  }

  return version;
}

const nextVersions = Object.fromEntries(apps.map((app) => [app.name, readNextVersion(app)]));
if (nextVersions.storefront !== nextVersions.admin) {
  throw new Error(`Storefront and Admin Next.js versions differ: ${nextVersions.storefront} / ${nextVersions.admin}.`);
}

const releaseInputDiff = spawnSync("git", [
  "-C", root, "diff", "--quiet", "HEAD", "--",
  ...apps.flatMap(({ directory }) => [`${directory}/package.json`, `${directory}/pnpm-lock.yaml`]),
], { stdio: "ignore" });
if (releaseInputDiff.status !== 0) throw new Error("Commit the Storefront/Admin package manifests and lockfiles before production cutover.");

const commit = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
console.log(JSON.stringify({ result: "READY", commit, nextVersions }, null, 2));
