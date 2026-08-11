import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAssetResolver,
  resolveAssetReferences,
} from "../src/asset-resolver.js";
import { hydratePrivateAssetPackManifest } from "../src/private-asset-pack.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function visit(value, callback, label = "pack") {
  callback(value, label);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, callback, `${label}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      visit(entry, callback, `${label}.${key}`);
    }
  }
}

const packArgument = getArgument("--pack");
if (!packArgument) {
  throw new Error("Informe --pack com o diretório do Private Asset Pack.");
}

const packRoot = path.resolve(root, packArgument);
const manifest = await readJson(path.join(packRoot, "private-asset-pack.json"));
const pack = await hydratePrivateAssetPackManifest(manifest, async (relativePath) =>
  readJson(path.join(packRoot, relativePath)),
);

for (const [assetId, asset] of Object.entries(pack.assets)) {
  const filePath = path.resolve(packRoot, asset.file);
  if (!filePath.startsWith(`${packRoot}${path.sep}`)) {
    throw new Error(`Asset fora do pack: ${asset.file}`);
  }
  await access(filePath);
  const hash = await hashFile(filePath);
  if (assetId !== `sha256:${hash}`) {
    throw new Error(`Hash canônico divergente em ${asset.file}.`);
  }
}

const bindings = Object.fromEntries(
  Object.keys(pack.assets).map((assetId) => [
    assetId,
    {
      url: `https://images.owlbear.rodeo/${assetId.slice("sha256:".length)}.png`,
      width: 100,
      height: 100,
      mime: "image/png",
    },
  ]),
);
const resolver = createAssetResolver(pack, bindings);
let logicalReferences = 0;

visit(pack.presets, (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  if (typeof value.assetId === "string") {
    logicalReferences += 1;
    if (!pack.assets[value.assetId] || !resolver.isReady(value)) {
      throw new Error(`Referência canônica inválida em ${label}.`);
    }
  }
  if (
    typeof value.path === "string" ||
    (typeof value.url === "string" && /(?:github\.io|localhost|127\.0\.0\.1|\.local-assets)/i.test(value.url))
  ) {
    throw new Error(`Referência física antiga permaneceu em ${label}.`);
  }
});

for (const [sceneId, entry] of Object.entries(pack.presets.scenes)) {
  if (
    entry.preset.id !== sceneId ||
    entry.preset.itemCount !== entry.preset.items?.length ||
    entry.summary.itemCount !== entry.preset.itemCount ||
    entry.summary.savedAt !== entry.preset.savedAt
  ) {
    throw new Error(`Resumo inconsistente no preset ${sceneId}.`);
  }

  const resolution = resolveAssetReferences(entry.preset, { resolver });
  if (resolution.unresolved || !resolution.resolved) {
    throw new Error(`O preset ${sceneId} não resolveu todos os assets canônicos.`);
  }
}

console.log(
  `${Object.keys(pack.assets).length} assets canônicos, ${Object.keys(pack.aliases).length} aliases, ${logicalReferences} referências lógicas, ${pack.presets.cards.groups?.length || 0} grupos, ${pack.presets.decks.decks?.length || 0} pilhas e ${Object.keys(pack.presets.scenes).length} mapas validados.`,
);
