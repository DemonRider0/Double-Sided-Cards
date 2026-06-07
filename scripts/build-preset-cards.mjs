import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const presetRoot = path.join(root, "assets", "preset-cards");
const manifestPath = path.join(presetRoot, "cards.json");

const groupDefaults = [
  { id: "classes", name: "Classes", category: "class", gridWidth: 3, layer: "MOUNT" },
  { id: "racas", name: "Racas", category: "race", gridWidth: 3, layer: "MOUNT" },
  { id: "divindades", name: "Divindades", category: "divinity", gridWidth: 2, layer: "PROP" },
  { id: "reacoes-heroicas", name: "Reacoes Heroicas", gridWidth: 1.25, layer: "MOUNT" },
  { id: "herois", name: "Herois", gridWidth: 6, layer: "MOUNT", origin: { x: 885, y: 531.5 } },
  { id: "herois-montaria", name: "Herois Montaria", gridWidth: 1, layer: "MOUNT" },
];

const imageExtensions = new Set([".apng", ".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"]);
const itemLayers = new Set(["DRAWING", "PROP", "MOUNT", "CHARACTER", "ATTACHMENT", "NOTE", "TEXT"]);
const backNames = [/^verso\b/i, /^back\b/i, /^costa\b/i, /^card[-_ ]?back\b/i];
const pairedBackName = /^(.+?)[-_ ]+(?:verso|back|costa|card[-_ ]?back)$/i;

function publicPath(groupId, filename) {
  return `assets/preset-cards/${groupId}/${filename}`.replaceAll("\\", "/");
}

function isImage(filename) {
  return imageExtensions.has(path.extname(filename).toLowerCase());
}

function isBackImage(filename) {
  const basename = path.basename(filename, path.extname(filename));
  return backNames.some((pattern) => pattern.test(basename));
}

function normalizeCardKey(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\d+[-_ ]*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSpecificBackKey(filename) {
  const basename = path.basename(filename, path.extname(filename));

  if (isBackImage(filename)) {
    return "";
  }

  const match = basename.match(pairedBackName);
  return match ? normalizeCardKey(match[1]) : "";
}

function displayName(filename, fallback) {
  const basename = path.basename(filename, path.extname(filename));
  const cleaned = basename
    .replace(/^\d+[-_ ]*/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

function getDefaultGridWidth(defaultGroup, existingGroup) {
  if (Number.isFinite(defaultGroup.gridWidth) && defaultGroup.gridWidth > 0) {
    return defaultGroup.gridWidth;
  }

  if (Number.isFinite(existingGroup?.gridWidth) && existingGroup.gridWidth > 0) {
    return existingGroup.gridWidth;
  }

  return 2;
}

function getDefaultLayer(defaultGroup, existingGroup) {
  if (itemLayers.has(defaultGroup.layer)) {
    return defaultGroup.layer;
  }

  if (itemLayers.has(existingGroup?.layer)) {
    return existingGroup.layer;
  }

  return "PROP";
}

function getDefaultOrigin(defaultGroup, existingGroup) {
  const origin = Number.isFinite(defaultGroup.origin?.x) && Number.isFinite(defaultGroup.origin?.y)
    ? defaultGroup.origin
    : existingGroup?.origin;

  if (!Number.isFinite(origin?.x) || !Number.isFinite(origin?.y)) {
    return null;
  }

  return {
    x: origin.x,
    y: origin.y,
  };
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return { version: 1, groups: [] };
  }
}

async function readGroupFiles(groupId) {
  const groupDir = path.join(presetRoot, groupId);
  await mkdir(groupDir, { recursive: true });

  const entries = await readdir(groupDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isImage(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function mergeGroup(defaultGroup, existingGroup, files) {
  const specificBacks = new Map();
  const cardFiles = [];
  let backFile = "";

  for (const file of files) {
    if (isBackImage(file)) {
      backFile ||= file;
      continue;
    }

    const specificBackKey = getSpecificBackKey(file);

    if (specificBackKey) {
      specificBacks.set(specificBackKey, file);
      continue;
    }

    cardFiles.push(file);
  }

  return {
    id: defaultGroup.id,
    name: existingGroup?.name || defaultGroup.name,
    category: defaultGroup.category || existingGroup?.category || "",
    gridWidth: getDefaultGridWidth(defaultGroup, existingGroup),
    layer: getDefaultLayer(defaultGroup, existingGroup),
    origin: getDefaultOrigin(defaultGroup, existingGroup),
    back: backFile ? publicPath(defaultGroup.id, backFile) : existingGroup?.back || "",
    cards: cardFiles.length
      ? cardFiles.map((file, index) => {
          const slug =
            path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, "-") ||
            "carta";
          const specificBackFile = specificBacks.get(normalizeCardKey(path.basename(file, path.extname(file))));

          const card = {
            id: `${index + 1}-${slug}`,
            name: displayName(file, `Carta ${index + 1}`),
            front: publicPath(defaultGroup.id, file),
          };

          if (specificBackFile) {
            card.back = publicPath(defaultGroup.id, specificBackFile);
          }

          return card;
        })
      : existingGroup?.cards || [],
  };
}

const manifest = await readManifest();
const existingById = new Map((manifest.groups || []).map((group) => [group.id, group]));
const groups = [];

for (const defaultGroup of groupDefaults) {
  const files = await readGroupFiles(defaultGroup.id);
  groups.push(mergeGroup(defaultGroup, existingById.get(defaultGroup.id), files));
}

await writeFile(manifestPath, `${JSON.stringify({ version: 1, groups }, null, 2)}\n`);

for (const group of groups) {
  const readyCards = group.cards.filter((card) => group.back || card.back).length;
  const status = group.cards.length
    ? readyCards === group.cards.length
      ? `${group.cards.length} cartas`
      : `${readyCards}/${group.cards.length} com verso`
    : "sem imagens";
  console.log(`${group.name}: ${status}`);
}
