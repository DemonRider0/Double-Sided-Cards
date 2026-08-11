import { access, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codeExtensions = new Set([".js", ".mjs"]);
const forbiddenPublicDirectories = [
  "assets/preset-cards",
  "assets/preset-decks",
  "assets/scene-presets",
  "assets/local-assets",
];
const obsoleteScripts = [
  "scripts/prepare-github-assets.mjs",
  "scripts/build-preset-cards.mjs",
  "scripts/build-preset-decks.mjs",
  "scripts/build-scene-preset-index.mjs",
];

function displayPath(filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory, extensions) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, extensions)));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

async function parseJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
  } catch (error) {
    throw new Error(`JSON inválido em ${relativePath}: ${error.message}`);
  }
}

function checkSyntax(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `Sintaxe inválida em ${displayPath(filePath)}:\n${(result.stderr || result.stdout).trim()}`,
    );
  }
}

function normalizedRecord(value) {
  return JSON.stringify(
    Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
}

const packageJson = await parseJson("package.json");
const packageLock = await parseJson("package-lock.json");
await parseJson("manifest.json");
const lockRoot = packageLock.packages?.[""];

if (!lockRoot || packageJson.name !== lockRoot.name || packageJson.version !== lockRoot.version) {
  throw new Error("A raiz de package-lock.json não corresponde a package.json.");
}
for (const field of ["dependencies", "devDependencies"]) {
  if (normalizedRecord(packageJson[field]) !== normalizedRecord(lockRoot[field])) {
    throw new Error(`${field} de package.json e package-lock.json não correspondem.`);
  }
}

for (const relativePath of [...forbiddenPublicDirectories, ...obsoleteScripts]) {
  if (await exists(path.join(root, relativePath))) {
    throw new Error(`Conteúdo privado/obsoleto permaneceu no Core: ${relativePath}`);
  }
}

const codeFiles = [
  path.join(root, "build.mjs"),
  path.join(root, "dev-server.mjs"),
  ...(await collectFiles(path.join(root, "scripts"), codeExtensions)),
  ...(await collectFiles(path.join(root, "src"), codeExtensions)),
  ...(await collectFiles(path.join(root, "dist"), codeExtensions)),
  ...(await collectFiles(path.join(root, "vendor"), codeExtensions)),
];
codeFiles.forEach(checkSyntax);

const expectedDist = ["app.js", "background.js", "sdk-boot.js", "sdk-client.js"].sort();
const actualDist = (await readdir(path.join(root, "dist"))).sort();
if (JSON.stringify(actualDist) !== JSON.stringify(expectedDist)) {
  throw new Error(`Conteúdo inesperado em dist/: ${actualDist.join(", ") || "pasta vazia"}.`);
}

const runtimeFiles = [
  "src/app.js",
  "src/background.js",
  "src/preset-assets.js",
  "src/preset-cards.js",
  "src/preset-decks.js",
  "src/scene-preset.js",
  "index.html",
];
const forbiddenRuntimePatterns = [
  /assets\/preset-cards/i,
  /assets\/preset-decks/i,
  /assets\/scene-presets/i,
  /assets\/local-assets/i,
  /prepare:github-assets/i,
  /migratePublicButton/i,
];
for (const relativePath of runtimeFiles) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  for (const pattern of forbiddenRuntimePatterns) {
    if (pattern.test(source)) {
      throw new Error(`${relativePath} ainda depende de um caminho privado público: ${pattern}`);
    }
  }
}

const html = await readFile(path.join(root, "index.html"), "utf8");
for (const id of [
  "privatePackInput",
  "privatePackChooseButton",
  "privatePackUploadButton",
  "privatePackLinkButton",
  "privatePackClearButton",
]) {
  if (!html.includes(`id="${id}"`)) {
    throw new Error(`Controle do Private Asset Pack ausente: ${id}`);
  }
}

console.log(
  `Core validado: ${codeFiles.length} arquivos JS/MJS, sem diretórios privados públicos e com fluxo de Private Asset Pack.`,
);
