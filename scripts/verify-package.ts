import { spawnSync } from "node:child_process";
import { glob, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tarballArgument = process.argv[2];

if (!tarballArgument) {
  throw new Error("Usage: bun scripts/verify-package.ts <package.tgz>");
}

const tarball = resolve(tarballArgument);
const listResult = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });

if (listResult.status !== 0) {
  throw new Error(`Could not inspect package:\n${listResult.stderr.trim()}`);
}

const entries = listResult.stdout
  .split("\n")
  .map((entry) => entry.replace(/\/$/, ""))
  .filter(Boolean);
const packagedPaths = entries.map((entry) => {
  if (!entry.startsWith("package/")) {
    throw new Error(`Unexpected tar entry outside package/: ${entry}`);
  }

  const packagedPath = entry.slice("package/".length);
  const hasUnsafeSegment = packagedPath
    .split("/")
    .some((segment) => segment === "." || segment === "..");
  const isPackagedPathUnsafe = !packagedPath || packagedPath.startsWith("/") || hasUnsafeSegment;
  if (isPackagedPathUnsafe) {
    throw new Error(`Unsafe package path: ${entry}`);
  }

  return packagedPath;
});

if (!packagedPaths.includes("package.json")) {
  throw new Error("Package must include package.json");
}

const extractionDirectory = await mkdtemp(join(tmpdir(), "lgtm-package-"));

try {
  const extractResult = spawnSync("tar", ["-xzf", tarball, "-C", extractionDirectory], {
    encoding: "utf8",
  });
  if (extractResult.status !== 0) {
    throw new Error(`Could not extract package:\n${extractResult.stderr.trim()}`);
  }

  const packageRoot = join(extractionDirectory, "package");
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
    bin?: string | Record<string, string>;
    files?: string[];
    name?: string;
    pi?: { extensions?: string[]; skills?: string[] };
    version?: string;
  };

  const isPackageIdentityMissing = !packageJson.name || !packageJson.version;
  if (isPackageIdentityMissing) {
    throw new Error("Package must declare a name and version");
  }
  if (!packageJson.files?.length) {
    throw new Error("Package must declare the files it publishes");
  }

  const binPaths =
    typeof packageJson.bin === "string" ? [packageJson.bin] : Object.values(packageJson.bin ?? {});
  const declaredPaths = [
    ...packageJson.files.map((path) => ({ path, acceptsChildren: true, source: "files" })),
    ...binPaths.map((path) => ({ path, acceptsChildren: false, source: "bin" })),
    ...(packageJson.pi?.extensions ?? []).map((path) => ({
      path,
      acceptsChildren: false,
      source: "pi.extensions",
    })),
    ...(packageJson.pi?.skills ?? []).map((path) => ({
      path,
      acceptsChildren: true,
      source: "pi.skills",
    })),
  ];

  for (const declaration of declaredPaths) {
    const normalizedPath = declaration.path.replace(/^\.\//, "").replace(/\/$/, "");
    const hasUnsafeSegment = normalizedPath
      .split("/")
      .some((segment) => segment === "." || segment === "..");
    const isDeclaredPathUnsafe =
      !normalizedPath || normalizedPath.startsWith("/") || hasUnsafeSegment;
    if (isDeclaredPathUnsafe) {
      throw new Error(`Unsafe ${declaration.source} path: ${declaration.path}`);
    }

    const isGlobPattern = /[*?[\]{}]/.test(normalizedPath);
    const globMatches = new Array<string>();
    if (isGlobPattern) {
      for await (const match of glob(normalizedPath, { cwd: packageRoot })) {
        globMatches.push(match);
      }
    }
    const isPresent = isGlobPattern
      ? globMatches.length > 0
      : packagedPaths.some(
          (packagedPath) =>
            packagedPath === normalizedPath ||
            (declaration.acceptsChildren && packagedPath.startsWith(`${normalizedPath}/`)),
        );
    if (!isPresent) {
      throw new Error(`Declared ${declaration.source} path is missing: ${declaration.path}`);
    }
  }
} finally {
  await rm(extractionDirectory, { force: true, recursive: true });
}

console.log(`Verified ${entries.length} entries in ${tarballArgument}`);
