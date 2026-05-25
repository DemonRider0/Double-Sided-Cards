import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const presetRoot = path.join(root, "assets", "preset-decks");
const manifestPath = path.join(presetRoot, "decks.json");

const deckDefaults = [
  { id: "elite", name: "Ameacas Elite", gridWidth: 4.5, layer: "PROP" },
  { id: "armas", name: "Armas", gridWidth: 2.25, layer: "PROP" },
  { id: "salas", name: "Salas", gridWidth: 1.5, layer: "PROP" },
  { id: "salas-refugiados", name: "Salas-Refugiados", gridWidth: 1.5, layer: "PROP" },
  { id: "salas-objetivos", name: "Salas-Objetivos", gridWidth: 1.5, layer: "PROP" },
  { id: "salas-normais", name: "Salas-Normais", gridWidth: 1.5, layer: "PROP" },
  { id: "tormenta-nivel-1", name: "Poderes da Tormenta Nivel 1", gridWidth: 2, layer: "PROP" },
  { id: "tormenta-nivel-2", name: "Poderes da Tormenta Nivel 2", gridWidth: 2, layer: "PROP" },
  { id: "tormenta-nivel-3", name: "Poderes da Tormenta Nivel 3", gridWidth: 2, layer: "PROP" },
  { id: "eventos", name: "Eventos", gridWidth: 2.25, layer: "PROP" },
];

const imageExtensions = new Set([".apng", ".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"]);
const itemLayers = new Set(["DRAWING", "PROP", "MOUNT", "CHARACTER", "ATTACHMENT", "NOTE", "TEXT"]);
const backNames = [/^verso\b/i, /^back\b/i, /^costa\b/i, /^deck[-_ ]?back\b/i];

function publicPath(deckId, filename) {
  return `assets/preset-decks/${deckId}/${filename}`.replaceAll("\\", "/");
}

function isImage(filename) {
  return imageExtensions.has(path.extname(filename).toLowerCase());
}

function isBackImage(filename) {
  const basename = path.basename(filename, path.extname(filename));
  return backNames.some((pattern) => pattern.test(basename));
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

function getDefaultGridWidth(defaultDeck, existingDeck) {
  if (Number.isFinite(existingDeck?.gridWidth) && existingDeck.gridWidth > 0) {
    return existingDeck.gridWidth;
  }

  return Number.isFinite(defaultDeck.gridWidth) && defaultDeck.gridWidth > 0
    ? defaultDeck.gridWidth
    : 2;
}

function getDefaultLayer(defaultDeck, existingDeck) {
  if (itemLayers.has(existingDeck?.layer)) {
    return existingDeck.layer;
  }

  return itemLayers.has(defaultDeck.layer) ? defaultDeck.layer : "PROP";
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return { version: 1, decks: [] };
  }
}

async function readDeckFiles(deckId) {
  const deckDir = path.join(presetRoot, deckId);
  await mkdir(deckDir, { recursive: true });

  const entries = await readdir(deckDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isImage(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function mergeDeck(defaultDeck, existingDeck, files) {
  const backFile = files.find(isBackImage);
  const cardFiles = files.filter((file) => file !== backFile);

  return {
    id: defaultDeck.id,
    name: existingDeck?.name || defaultDeck.name,
    gridWidth: getDefaultGridWidth(defaultDeck, existingDeck),
    layer: getDefaultLayer(defaultDeck, existingDeck),
    back: backFile ? publicPath(defaultDeck.id, backFile) : existingDeck?.back || "",
    cards: cardFiles.length
      ? cardFiles.map((file, index) => ({
          name: displayName(file, `Carta ${index + 1}`),
          front: publicPath(defaultDeck.id, file),
        }))
      : existingDeck?.cards || [],
  };
}

const manifest = await readManifest();
const existingById = new Map((manifest.decks || []).map((deck) => [deck.id, deck]));
const decks = [];

for (const defaultDeck of deckDefaults) {
  const files = await readDeckFiles(defaultDeck.id);
  decks.push(mergeDeck(defaultDeck, existingById.get(defaultDeck.id), files));
}

await writeFile(manifestPath, `${JSON.stringify({ version: 1, decks }, null, 2)}\n`);

for (const deck of decks) {
  const status = deck.back && deck.cards.length ? `${deck.cards.length} cartas` : "sem imagens";
  console.log(`${deck.name}: ${status}`);
}
