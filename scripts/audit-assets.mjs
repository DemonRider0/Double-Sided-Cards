import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsRoot = path.join(root, "assets");
const jsonOutput = process.argv.includes("--json");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs"]);

function displayPath(filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = "B";

  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024) break;
  }

  return `${value.toFixed(value >= 100 ? 1 : 2)} ${unit}`;
}

async function collectFiles(directory, filter = () => true) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, filter)));
    } else if (entry.isFile() && filter(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return hash.digest("hex");
}

function getReferenceCategory(filePath) {
  const relativePath = displayPath(filePath);
  if (relativePath.startsWith("dist/") || relativePath.endsWith(".html")) {
    return "distributed";
  }
  if (path.extname(filePath).toLowerCase() === ".json") {
    return "json";
  }
  return "source";
}

function normalizeAssetReference(value) {
  if (typeof value !== "string") return null;

  let normalized = value.replaceAll("\\", "/");
  const assetIndex = normalized.toLowerCase().indexOf("assets/");
  if (assetIndex === -1) return null;

  normalized = normalized.slice(assetIndex).split(/[?#]/, 1)[0];
  if (normalized.includes("${")) return null;
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    return null;
  }

  normalized = normalized.replace(
    /(\.(?:apng|avif|bak|gif|html?|jpe?g|json|mjs|png|svg|webp))\s.*$/i,
    "$1",
  );
  normalized = normalized.replace(/\/+$/, "");
  return normalized.startsWith("assets/") ? normalized : null;
}

function extractAssetReferences(content) {
  const references = new Set();
  const quotedStrings = content.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g);

  for (const match of quotedStrings) {
    const reference = normalizeAssetReference(match[2]);
    if (reference) references.add(reference);
  }

  return references;
}

const assetPaths = await collectFiles(assetsRoot);
const assetFiles = await Promise.all(
  assetPaths.map(async (filePath) => {
    const fileStat = await stat(filePath);
    return {
      absolutePath: filePath,
      path: displayPath(filePath),
      extension: path.extname(filePath).toLowerCase() || "[sem extensao]",
      size: fileStat.size,
    };
  }),
);
const assetByPath = new Map(assetFiles.map((file) => [file.path, file]));
const assetByLowerPath = new Map(assetFiles.map((file) => [file.path.toLowerCase(), file]));
const assetDirectories = new Set(
  assetFiles.flatMap((file) => {
    const directories = [];
    let directory = path.posix.dirname(file.path);
    while (directory === "assets" || directory.startsWith("assets/")) {
      directories.push(directory);
      if (directory === "assets") break;
      directory = path.posix.dirname(directory);
    }
    return directories;
  }),
);

const referenceCandidates = [
  path.join(root, "package.json"),
  path.join(root, "package-lock.json"),
  path.join(root, "manifest.json"),
  path.join(root, "index.html"),
  path.join(root, "background.html"),
  path.join(root, "build.mjs"),
  path.join(root, "dev-server.mjs"),
  ...(await collectFiles(path.join(root, "src"), (filePath) =>
    textExtensions.has(path.extname(filePath).toLowerCase()),
  )),
  ...(await collectFiles(path.join(root, "scripts"), (filePath) =>
    textExtensions.has(path.extname(filePath).toLowerCase()),
  )),
  ...(await collectFiles(path.join(root, "dist"), (filePath) =>
    textExtensions.has(path.extname(filePath).toLowerCase()),
  )),
  ...(await collectFiles(path.join(root, "vendor"), (filePath) =>
    textExtensions.has(path.extname(filePath).toLowerCase()),
  )),
  ...(await collectFiles(assetsRoot, (filePath) => path.extname(filePath).toLowerCase() === ".json")),
];
const uniqueReferenceCandidates = [...new Set(referenceCandidates)];
const referenceSources = new Map();

for (const filePath of uniqueReferenceCandidates) {
  const content = await readFile(filePath, "utf8");
  const sourcePath = displayPath(filePath);
  const category = getReferenceCategory(filePath);

  for (const reference of extractAssetReferences(content)) {
    const current = referenceSources.get(reference) ?? { categories: new Set(), sources: new Set() };
    current.categories.add(category);
    current.sources.add(sourcePath);
    referenceSources.set(reference, current);
  }
}

const referencedFiles = new Set();
const missingReferences = [];
const caseMismatches = [];

for (const [reference, sources] of referenceSources) {
  const exactFile = assetByPath.get(reference);
  if (exactFile) {
    referencedFiles.add(exactFile.path);
    continue;
  }

  const caseInsensitiveFile = assetByLowerPath.get(reference.toLowerCase());
  if (caseInsensitiveFile) {
    referencedFiles.add(caseInsensitiveFile.path);
    caseMismatches.push({ reference, actualPath: caseInsensitiveFile.path, sources: [...sources.sources] });
  } else if (assetDirectories.has(reference)) {
    continue;
  } else {
    missingReferences.push({ reference, sources: [...sources.sources] });
  }
}

const extensionMap = new Map();
const directoryMap = new Map();
const sizeGroups = new Map();

for (const file of assetFiles) {
  const extension = extensionMap.get(file.extension) ?? { extension: file.extension, files: 0, bytes: 0 };
  extension.files += 1;
  extension.bytes += file.size;
  extensionMap.set(file.extension, extension);

  let directory = path.posix.dirname(file.path);
  while (directory === "assets" || directory.startsWith("assets/")) {
    const aggregate = directoryMap.get(directory) ?? { directory, files: 0, bytes: 0 };
    aggregate.files += 1;
    aggregate.bytes += file.size;
    directoryMap.set(directory, aggregate);
    if (directory === "assets") break;
    directory = path.posix.dirname(directory);
  }

  const sameSize = sizeGroups.get(file.size) ?? [];
  sameSize.push(file);
  sizeGroups.set(file.size, sameSize);
}

const duplicateHashGroups = new Map();
for (const sameSizeFiles of sizeGroups.values()) {
  if (sameSizeFiles.length < 2) continue;

  for (const file of sameSizeFiles) {
    const hash = await hashFile(file.absolutePath);
    const key = `${file.size}:${hash}`;
    const group = duplicateHashGroups.get(key) ?? { hash, size: file.size, files: [] };
    group.files.push(file.path);
    duplicateHashGroups.set(key, group);
  }
}

const duplicates = [...duplicateHashGroups.values()]
  .filter((group) => group.files.length > 1)
  .map((group) => ({
    ...group,
    redundantFiles: group.files.length - 1,
    redundantBytes: group.size * (group.files.length - 1),
  }))
  .sort((left, right) => right.redundantBytes - left.redundantBytes || right.files.length - left.files.length);
const unreferencedFiles = assetFiles
  .filter((file) => !referencedFiles.has(file.path))
  .sort((left, right) => right.size - left.size || left.path.localeCompare(right.path));
const totalBytes = assetFiles.reduce((sum, file) => sum + file.size, 0);
const referencedBytes = assetFiles
  .filter((file) => referencedFiles.has(file.path))
  .reduce((sum, file) => sum + file.size, 0);
const duplicateFiles = duplicates.reduce((sum, group) => sum + group.files.length, 0);
const redundantFiles = duplicates.reduce((sum, group) => sum + group.redundantFiles, 0);
const redundantBytes = duplicates.reduce((sum, group) => sum + group.redundantBytes, 0);
const unreferencedBytes = unreferencedFiles.reduce((sum, file) => sum + file.size, 0);
const categories = {};
const sourceAssets = new Map();
const duplicateByPath = new Map();

for (const group of duplicates) {
  for (const assetPath of group.files) duplicateByPath.set(assetPath, group);
}

function summarizeDuplicateSubset(paths) {
  const selectedPaths = new Set(paths);
  const selectedGroups = new Set(
    [...selectedPaths].map((assetPath) => duplicateByPath.get(assetPath)).filter(Boolean),
  );
  let redundantFilesInSubset = 0;
  let redundantBytesInSubset = 0;

  for (const group of selectedGroups) {
    const count = group.files.filter((assetPath) => selectedPaths.has(assetPath)).length;
    if (count < 2) continue;
    redundantFilesInSubset += count - 1;
    redundantBytesInSubset += group.size * (count - 1);
  }

  return { redundantFiles: redundantFilesInSubset, redundantBytes: redundantBytesInSubset };
}

const referencedDuplicateSummary = summarizeDuplicateSubset(referencedFiles);
const unreferencedDuplicateSummary = summarizeDuplicateSubset(
  unreferencedFiles.map((file) => file.path),
);
const unreferencedDuplicatesOfReferenced = unreferencedFiles.filter((file) =>
  duplicateByPath.get(file.path)?.files.some((assetPath) => referencedFiles.has(assetPath)),
);

for (const [reference, details] of referenceSources) {
  const file = assetByPath.get(reference) ?? assetByLowerPath.get(reference.toLowerCase());
  if (!file) continue;

  for (const source of details.sources) {
    const paths = sourceAssets.get(source) ?? new Set();
    paths.add(file.path);
    sourceAssets.set(source, paths);
  }
}

for (const category of ["json", "source", "distributed"]) {
  const paths = new Set();
  for (const [reference, details] of referenceSources) {
    if (!details.categories.has(category)) continue;
    const file = assetByPath.get(reference) ?? assetByLowerPath.get(reference.toLowerCase());
    if (file) paths.add(file.path);
  }
  categories[category] = {
    files: paths.size,
    bytes: [...paths].reduce((sum, assetPath) => sum + assetByPath.get(assetPath).size, 0),
  };
}

const scenePresets = [];
for (const filePath of assetPaths.filter((assetPath) =>
  displayPath(assetPath).startsWith("assets/scene-presets/") &&
  path.extname(assetPath) === ".json" &&
  path.basename(assetPath) !== "index.json",
)) {
  const preset = JSON.parse(await readFile(filePath, "utf8"));
  const visibleReferences = new Set();
  let imageItems = 0;

  for (const item of preset.items ?? []) {
    if (item?.type !== "IMAGE" || typeof item.image?.url !== "string") continue;
    imageItems += 1;
    const reference = normalizeAssetReference(item.image.url);
    if (reference) visibleReferences.add(reference);
  }

  const visibleFiles = [...visibleReferences]
    .map((reference) => assetByPath.get(reference) ?? assetByLowerPath.get(reference.toLowerCase()))
    .filter(Boolean);
  const visiblePaths = new Set(visibleFiles.map((file) => file.path));
  const visibleDuplicateGroups = new Set(
    [...visiblePaths].map((assetPath) => duplicateByPath.get(assetPath)).filter(Boolean),
  );
  let duplicatePaths = 0;
  let duplicateBytes = 0;

  for (const group of visibleDuplicateGroups) {
    const selectedFiles = group.files.filter((assetPath) => visiblePaths.has(assetPath));
    if (selectedFiles.length < 2) continue;
    duplicatePaths += selectedFiles.length - 1;
    duplicateBytes += group.size * (selectedFiles.length - 1);
  }

  scenePresets.push({
    source: displayPath(filePath),
    items: (preset.items ?? []).length,
    imageItems,
    uniqueVisibleAssetPaths: visibleFiles.length,
    visibleBytes: visibleFiles.reduce((sum, file) => sum + file.size, 0),
    duplicateVisiblePaths: duplicatePaths,
    duplicateVisibleBytes: duplicateBytes,
    unresolvedVisibleReferences: visibleReferences.size - visibleFiles.length,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  total: { files: assetFiles.length, bytes: totalBytes },
  extensions: [...extensionMap.values()].sort((left, right) => right.bytes - left.bytes),
  largestFiles: [...assetFiles].sort((left, right) => right.size - left.size).slice(0, 25),
  largestDirectories: [...directoryMap.values()]
    .filter((entry) => entry.directory !== "assets")
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 25),
  scenePresets,
  duplicates: {
    groups: duplicates.length,
    files: duplicateFiles,
    redundantFiles,
    redundantBytes,
    entries: duplicates,
  },
  references: {
    distinctPaths: referenceSources.size,
    files: referencedFiles.size,
    bytes: referencedBytes,
    duplicates: referencedDuplicateSummary,
    categories,
    sources: [...sourceAssets]
      .map(([source, paths]) => ({
        source,
        files: paths.size,
        bytes: [...paths].reduce((sum, assetPath) => sum + assetByPath.get(assetPath).size, 0),
      }))
      .sort((left, right) => right.bytes - left.bytes || left.source.localeCompare(right.source)),
    missing: missingReferences,
    caseMismatches,
  },
  unreferenced: {
    files: unreferencedFiles.length,
    bytes: unreferencedBytes,
    duplicates: unreferencedDuplicateSummary,
    duplicatesOfReferenced: {
      files: unreferencedDuplicatesOfReferenced.length,
      bytes: unreferencedDuplicatesOfReferenced.reduce((sum, file) => sum + file.size, 0),
    },
    entries: unreferencedFiles.map(({ path: assetPath, size }) => ({ path: assetPath, size })),
  },
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`Assets: ${report.total.files} arquivos, ${formatBytes(report.total.bytes)}`);
console.log("\nPor extensao:");
for (const entry of report.extensions) {
  console.log(`- ${entry.extension}: ${entry.files} arquivos, ${formatBytes(entry.bytes)}`);
}
console.log("\nMaiores diretorios:");
for (const entry of report.largestDirectories.slice(0, 15)) {
  console.log(`- ${entry.directory}: ${entry.files} arquivos, ${formatBytes(entry.bytes)}`);
}
console.log("\nMaiores arquivos:");
for (const entry of report.largestFiles.slice(0, 15)) {
  console.log(`- ${entry.path}: ${formatBytes(entry.size)}`);
}
console.log("\nImagens visiveis ao restaurar mapas:");
for (const entry of report.scenePresets) {
  console.log(
    `- ${entry.source}: ${entry.imageItems} itens de imagem, ${entry.uniqueVisibleAssetPaths} URLs unicas, ` +
      `${formatBytes(entry.visibleBytes)}; ${entry.duplicateVisiblePaths} URLs byte-a-byte redundantes ` +
      `(${formatBytes(entry.duplicateVisibleBytes)})`,
  );
}
console.log(
  `\nDuplicatas exatas: ${report.duplicates.groups} grupos, ${report.duplicates.files} arquivos participantes, ` +
    `${report.duplicates.redundantFiles} copias redundantes e ${formatBytes(report.duplicates.redundantBytes)}`,
);
for (const entry of report.duplicates.entries.slice(0, 10)) {
  console.log(`- ${entry.files.length} x ${formatBytes(entry.size)} (${formatBytes(entry.redundantBytes)} redundantes)`);
  for (const file of entry.files.slice(0, 8)) console.log(`  - ${file}`);
  if (entry.files.length > 8) console.log(`  - ... mais ${entry.files.length - 8} arquivos`);
}
console.log(
  `\nReferenciados: ${report.references.files} arquivos, ${formatBytes(report.references.bytes)}; ` +
    `${report.references.missing.length} referencias ausentes; ${report.references.caseMismatches.length} diferencas de caixa.`,
);
console.log(
  `Nao referenciados: ${report.unreferenced.files} arquivos, ${formatBytes(report.unreferenced.bytes)}.`,
);
for (const entry of report.unreferenced.entries.slice(0, 25)) {
  console.log(`- ${entry.path}: ${formatBytes(entry.size)}`);
}
