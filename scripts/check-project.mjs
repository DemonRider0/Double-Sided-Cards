import { access, readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readImageMetadata } from "./image-metadata.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codeExtensions = new Set([".js", ".mjs"]);

function displayPath(filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
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

async function parseJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`JSON invalido em ${displayPath(filePath)}: ${error.message}`);
  }
}

function checkSyntax(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(
      `Sintaxe invalida em ${displayPath(filePath)}:\n${(result.stderr || result.stdout).trim()}`,
    );
  }
}

function normalizedRecord(value) {
  return JSON.stringify(Object.entries(value ?? {}).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  ));
}

function getAssetPath(value) {
  return typeof value === "string" ? value : value?.path || value?.url || "";
}

function addAssetReference(references, value, label) {
  const assetPath = getAssetPath(value);
  if (assetPath && !/^(?:https?:|data:|blob:)/i.test(assetPath)) {
    references.push({ assetPath, label, metadata: value });
  }
}

async function checkAsset({ assetPath, label, metadata }) {
  const absolutePath = path.resolve(root, assetPath.replace(/^[/\\]+/, ""));
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} aponta para fora do repositorio: ${assetPath}`);
  }

  try {
    await access(absolutePath);
  } catch {
    throw new Error(`${label} aponta para um arquivo ausente: ${assetPath}`);
  }

  if (metadata !== undefined) {
    const actualMetadata = await readImageMetadata(absolutePath);
    if (actualMetadata.width === undefined) return;

    if (
      metadata?.width !== actualMetadata.width ||
      metadata?.height !== actualMetadata.height ||
      metadata?.mime !== actualMetadata.mime
    ) {
      throw new Error(`${label} possui dimensoes ou MIME desatualizados: ${assetPath}`);
    }
  }
}

function visit(value, callback) {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, callback));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      callback(key, item);
      visit(item, callback);
    }
  }
}

const jsonFiles = [
  path.join(root, "package.json"),
  path.join(root, "package-lock.json"),
  path.join(root, "manifest.json"),
  ...(await collectFiles(path.join(root, "assets"), new Set([".json"]))),
];
const jsonByPath = new Map();

for (const filePath of jsonFiles) {
  jsonByPath.set(filePath, await parseJson(filePath));
}

const packageJson = jsonByPath.get(path.join(root, "package.json"));
const packageLock = jsonByPath.get(path.join(root, "package-lock.json"));
const lockRoot = packageLock.packages?.[""];

if (!lockRoot || packageJson.name !== lockRoot.name || packageJson.version !== lockRoot.version) {
  throw new Error("A raiz de package-lock.json nao corresponde a package.json.");
}
for (const field of ["dependencies", "devDependencies"]) {
  if (normalizedRecord(packageJson[field]) !== normalizedRecord(lockRoot[field])) {
    throw new Error(`${field} de package.json e package-lock.json nao correspondem.`);
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
  throw new Error(`Conteudo inesperado em dist/: ${actualDist.join(", ") || "pasta vazia"}.`);
}

const libraryReferences = [];
const decks = jsonByPath.get(path.join(root, "assets", "preset-decks", "decks.json")).decks ?? [];
const groups = jsonByPath.get(path.join(root, "assets", "preset-cards", "cards.json")).groups ?? [];

for (const deck of decks) {
  addAssetReference(libraryReferences, deck.back, `Verso da pilha ${deck.name || deck.id}`);
  for (const card of deck.cards ?? []) {
    addAssetReference(libraryReferences, card.front, `Carta ${card.name || "sem nome"}`);
  }
}
for (const group of groups) {
  addAssetReference(libraryReferences, group.back, `Verso do grupo ${group.name || group.id}`);
  for (const card of group.cards ?? []) {
    addAssetReference(libraryReferences, card.front, `Frente de ${card.name || card.id}`);
    addAssetReference(libraryReferences, card.back, `Verso de ${card.name || card.id}`);
  }
}

const sceneReferences = [];
const sceneIndex = jsonByPath.get(path.join(root, "assets", "scene-presets", "index.json"));
if (sceneIndex?.version !== 1 || !Array.isArray(sceneIndex.presets)) {
  throw new Error("assets/scene-presets/index.json possui estrutura invalida.");
}

for (const filename of ["tutorial.json", "missao-0-5.json"]) {
  const presetPath = path.join(root, "assets", "scene-presets", filename);
  const preset = jsonByPath.get(presetPath);
  const summary = sceneIndex.presets.find((entry) => entry?.id === preset.id);
  const expectedUrl = `assets/scene-presets/${filename}`;

  if (
    !summary ||
    summary.name !== preset.name ||
    summary.savedAt !== preset.savedAt ||
    summary.itemCount !== preset.itemCount ||
    summary.itemCount !== preset.items?.length ||
    summary.url !== expectedUrl
  ) {
    throw new Error(`Resumo desatualizado para ${displayPath(presetPath)}.`);
  }

  visit(preset, (key, item) => {
    if (typeof item !== "string") return;
    if (/^[a-z]:[\\/]/i.test(item) || /^file:/i.test(item)) {
      throw new Error(`${displayPath(presetPath)} contem caminho local: ${item}`);
    }
    if (key !== "url") return;

    const url = new URL(item);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      throw new Error(`${displayPath(presetPath)} contem URL local: ${item}`);
    }

    const prefix = "/Double-Sided-Cards/";
    if (url.hostname === "demonrider0.github.io" && url.pathname.startsWith(prefix)) {
      sceneReferences.push({
        assetPath: decodeURIComponent(url.pathname.slice(prefix.length)),
        label: `URL em ${displayPath(presetPath)}`,
      });
    }
  });
}

await Promise.all([...libraryReferences, ...sceneReferences].map(checkAsset));
console.log(
  `${jsonFiles.length} JSONs, ${codeFiles.length} arquivos JS/MJS, ${libraryReferences.length} assets de biblioteca e ${sceneReferences.length} referencias de mapas validados.`,
);
