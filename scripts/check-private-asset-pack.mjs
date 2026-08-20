import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PRIVATE_ASSET_MAX_FILE_SIZE,
  createAssetResolver,
  getPrivateAssetUploadMime,
  resolveAssetReferences,
} from "../src/asset-resolver.js";
import { hydratePrivateAssetPackManifest } from "../src/private-asset-pack.js";
import { readImageMetadata } from "./image-metadata.mjs";

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
const canonicalDirectory = path.join(packRoot, "assets");
const declaredCanonicalFiles = new Set(Object.values(pack.assets).map((asset) => asset.file));
const canonicalEntries = await readdir(canonicalDirectory, { withFileTypes: true });
for (const entry of canonicalEntries) {
  if (!entry.isFile()) {
    throw new Error(`Entrada inesperada no diretório canônico: assets/${entry.name}`);
  }
  const relativePath = `assets/${entry.name}`;
  if (!getPrivateAssetUploadMime(relativePath)) {
    throw new Error(`Formato não suportado no diretório canônico: ${relativePath}`);
  }
  if (!declaredCanonicalFiles.has(relativePath)) {
    throw new Error(`Arquivo canônico não declarado no manifesto: ${relativePath}`);
  }
}

for (const [assetId, asset] of Object.entries(pack.assets)) {
  const filePath = path.resolve(packRoot, asset.file);
  if (!filePath.startsWith(`${packRoot}${path.sep}`)) {
    throw new Error(`Asset fora do pack: ${asset.file}`);
  }
  await access(filePath);
  const details = await stat(filePath);
  if (!Number.isFinite(asset.size) || asset.size <= 0 || details.size !== asset.size) {
    throw new Error(`Tamanho divergente em ${asset.file}.`);
  }
  if (details.size > PRIVATE_ASSET_MAX_FILE_SIZE) {
    throw new Error(
      `Asset acima do limite Fledgling de ${PRIVATE_ASSET_MAX_FILE_SIZE} bytes: ${asset.file} (${details.size} bytes).`,
    );
  }
  let metadata;
  try {
    metadata = await readImageMetadata(filePath);
  } catch (error) {
    throw new Error(`Asset canônico não é uma imagem real e legível: ${asset.file}. ${error.message}`);
  }
  if (
    metadata.mime !== asset.mime ||
    metadata.width !== asset.width ||
    metadata.height !== asset.height
  ) {
    throw new Error(
      `Metadata real divergente em ${asset.file}: ${metadata.mime} ${metadata.width}x${metadata.height}; manifesto ${asset.mime} ${asset.width || 0}x${asset.height || 0}.`,
    );
  }
  const hash = await hashFile(filePath);
  if (asset.blobSha256 !== `sha256:${hash}`) {
    throw new Error(`Hash físico divergente em ${asset.file}.`);
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

const assets = Object.entries(pack.assets);
const totalBytes = assets.reduce((total, [, asset]) => total + asset.size, 0);
const formatCounts = assets.reduce((counts, [, asset]) => {
  counts[asset.mime] = (counts[asset.mime] || 0) + 1;
  return counts;
}, {});
const largest = assets
  .map(([assetId, asset]) => ({ assetId, name: asset.name, file: asset.file, size: asset.size }))
  .sort((left, right) => right.size - left.size)[0];

console.log(
  JSON.stringify(
    {
      formatVersion: pack.sourceFormatVersion,
      normalizedFormatVersion: pack.version,
      assets: assets.length,
      aliases: Object.keys(pack.aliases).length,
      logicalReferences,
      cardGroups: pack.presets.cards.groups?.length || 0,
      decks: pack.presets.decks.decks?.length || 0,
      scenes: Object.keys(pack.presets.scenes).length,
      totalBytes,
      formatCounts,
      largest,
    },
    null,
    2,
  ),
);
