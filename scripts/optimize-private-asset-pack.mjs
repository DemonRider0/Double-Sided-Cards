import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  PRIVATE_ASSET_MAX_FILE_SIZE,
  PRIVATE_ASSET_PACK_FORMAT,
  PRIVATE_ASSET_PACK_VERSION,
} from "../src/asset-resolver.js";
import { hydratePrivateAssetPackManifest } from "../src/private-asset-pack.js";
import {
  PRIVATE_RUNTIME_MIN_SAVING_BYTES,
  PRIVATE_RUNTIME_MIN_SAVING_RATIO,
  PRIVATE_RUNTIME_WEBP_OPTIONS,
  optimizePngForRuntime,
} from "./image-optimizer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
sharp.cache(false);

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function isInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function logicalHash(assetId) {
  const match = String(assetId).match(/^sha256:([0-9a-f]{64})$/i);
  if (!match) {
    throw new Error(`assetId lógico inválido: ${assetId}.`);
  }
  return match[1].toLowerCase();
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function findMobileMapReplacements(pack) {
  const mobileByLetter = new Map();
  for (const [assetId, asset] of Object.entries(pack.assets)) {
    const match = normalizeSearchText(asset.name).match(/mapa-tutorial-([abc])--mobile\.jpe?g$/);
    if (match) {
      mobileByLetter.set(match[1], { assetId, asset });
    }
  }

  const replacements = new Map();
  for (const [assetId, asset] of Object.entries(pack.assets)) {
    const match = normalizeSearchText(asset.name).match(/mapa-tutorial-([abc])-\.png$/);
    if (!match) {
      continue;
    }
    const replacement = mobileByLetter.get(match[1]);
    if (!replacement) {
      continue;
    }
    if (asset.width !== replacement.asset.width || asset.height !== replacement.asset.height) {
      throw new Error(
        `Substituição mobile incompatível: ${asset.name} e ${replacement.asset.name} possuem dimensões diferentes.`,
      );
    }
    replacements.set(assetId, replacement.assetId);
  }
  return replacements;
}

function replaceLogicalReferences(value, replacements) {
  if (typeof value === "string") {
    return replacements.get(value) || value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replaceLogicalReferences(entry, replacements));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      replaceLogicalReferences(entry, replacements),
    ]),
  );
}

function getAssetSearchText(assetId, asset, aliases) {
  return normalizeSearchText(
    [
      asset.name,
      asset.owlbearName,
      ...Object.entries(aliases)
        .filter(([, targetId]) => targetId === assetId)
        .map(([alias]) => alias),
    ].join(" "),
  );
}

function chooseRepresentativeSamples(records, aliases) {
  const rules = [
    ["carta com bastante texto", /ameacas|poderes|eventos|reacoes|carta-/],
    ["carta com transparência", null],
    ["raça", /preset-cards\/racas|\braca\b/],
    ["classe", /preset-cards\/classes|\bclasse\b/],
    ["divindade", /preset-cards\/divindades|\bdivindade\b/],
    ["carta de deck", /preset-decks/],
    ["mapa", /mapa|tutorial-pag/],
    ["token/personagem", /token|personagem|heroi|heroina/],
    ["verso de carta", /verso/],
  ];
  const used = new Set();
  const samples = [];

  for (const [category, pattern] of rules) {
    const record = records.find((candidate) => {
      if (used.has(candidate.assetId)) {
        return false;
      }
      if (category === "carta com transparência") {
        return candidate.sourceHasTransparency;
      }
      return pattern.test(getAssetSearchText(candidate.assetId, candidate.asset, aliases));
    });
    if (!record) {
      throw new Error(`Não foi possível selecionar a amostra obrigatória: ${category}.`);
    }
    used.add(record.assetId);
    samples.push({ category, record });
  }
  return samples;
}

async function verifyRepresentativeSamples(samples) {
  const verified = [];
  for (const { category, record } of samples) {
    const metadata = await sharp(record.runtimePath, { failOn: "error" }).metadata();
    await sharp(record.runtimePath, { failOn: "error" }).stats();
    if (metadata.width !== record.width || metadata.height !== record.height) {
      throw new Error(`A amostra ${category} mudou de dimensões.`);
    }
    if (record.sourceHasTransparency && !metadata.hasAlpha) {
      throw new Error(`A amostra ${category} perdeu o canal alpha.`);
    }
    verified.push({
      category,
      assetId: record.assetId,
      name: record.asset.name,
      sourceMime: record.sourceMime,
      runtimeMime: record.runtimeMime,
      width: metadata.width,
      height: metadata.height,
      alphaPreserved: !record.sourceHasTransparency || Boolean(metadata.hasAlpha),
      decoded: true,
      rotated: false,
    });
  }
  return verified;
}

const sourceArgument = getArgument("--source-pack");
const outputArgument = getArgument("--output");
if (!sourceArgument || !outputArgument) {
  throw new Error("Informe --source-pack e --output com diretórios privados distintos.");
}

const sourceRoot = path.resolve(root, sourceArgument);
const output = path.resolve(root, outputArgument);
if (isInside(root, output)) {
  throw new Error("O Runtime Private Asset Pack não pode ser criado dentro do Core público.");
}
if (sourceRoot === output || isInside(sourceRoot, output)) {
  throw new Error("A saída otimizada deve ficar fora da fonte original.");
}
if (await exists(output)) {
  throw new Error(`O destino já existe: ${output}. Escolha uma nova pasta de saída.`);
}

const sourceManifestPath = path.join(sourceRoot, "private-asset-pack.json");
const sourceManifest = await readJson(sourceManifestPath);
if (sourceManifest.format !== PRIVATE_ASSET_PACK_FORMAT) {
  throw new Error("A fonte não é um Private Asset Pack do Double-Sided Cards.");
}
const pack = await hydratePrivateAssetPackManifest(sourceManifest, async (relativePath) =>
  readJson(path.join(sourceRoot, relativePath)),
);
const replacements = findMobileMapReplacements(pack);
const aliases = Object.fromEntries(
  Object.entries(pack.aliases).map(([alias, assetId]) => [
    alias,
    replacements.get(assetId) || assetId,
  ]),
);
for (const [historicalAssetId, replacementAssetId] of replacements) {
  aliases[historicalAssetId] = replacementAssetId;
}

const outputParent = path.dirname(output);
await mkdir(outputParent, { recursive: true });
const temporaryOutput = await mkdtemp(path.join(outputParent, ".dsc-runtime-pack-"));

try {
  await mkdir(path.join(temporaryOutput, "assets"), { recursive: true });
  const assets = {};
  const records = [];
  const sourceRuntimeBytes = Object.values(pack.assets).reduce((sum, asset) => sum + asset.size, 0);
  let converted = 0;
  let keptOriginal = 0;
  let optimizedBytes = 0;

  for (const [assetId, asset] of Object.entries(pack.assets)) {
    if (replacements.has(assetId)) {
      continue;
    }
    const sourcePath = path.resolve(sourceRoot, asset.file);
    if (!sourcePath.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error(`Asset fora da fonte: ${asset.file}.`);
    }
    const details = await stat(sourcePath);
    if (details.size !== asset.size) {
      throw new Error(`Tamanho físico divergente na fonte: ${asset.file}.`);
    }
    const sourceHash = await hashFile(sourcePath);
    if (`sha256:${sourceHash}` !== asset.blobSha256) {
      throw new Error(`Hash físico divergente na fonte: ${asset.file}.`);
    }

    const sourceImage = sharp(sourcePath, { failOn: "error" });
    const [sourceMetadata, sourceStats] = await Promise.all([
      sourceImage.clone().metadata(),
      sourceImage.clone().stats(),
    ]);
    const sourceHasTransparency = Boolean(sourceMetadata.hasAlpha && !sourceStats.isOpaque);
    if (sourceMetadata.width !== asset.width || sourceMetadata.height !== asset.height) {
      throw new Error(`Dimensões divergentes na fonte: ${asset.file}.`);
    }
    const baseName = logicalHash(assetId);
    let runtimeBytes = null;
    let runtimeExtension = path.extname(asset.file).toLowerCase();
    let runtimeMime = asset.mime;

    if (asset.mime === "image/png") {
      const optimized = await optimizePngForRuntime(sourcePath);
      if (optimized.converted) {
        runtimeBytes = optimized.bytes;
        runtimeExtension = ".webp";
        runtimeMime = "image/webp";
        converted += 1;
      }
    }

    const runtimeFile = `assets/${baseName}${runtimeExtension}`;
    const runtimePath = path.join(temporaryOutput, runtimeFile);
    if (runtimeBytes) {
      await writeFile(runtimePath, runtimeBytes);
    } else {
      await copyFile(sourcePath, runtimePath);
      keptOriginal += 1;
    }
    const runtimeSize = runtimeBytes?.length ?? details.size;
    const runtimeHash = runtimeBytes ? hashBytes(runtimeBytes) : sourceHash;
    const runtimeMetadata = await sharp(runtimePath, { failOn: "error" }).metadata();
    if (
      runtimeMetadata.width !== sourceMetadata.width ||
      runtimeMetadata.height !== sourceMetadata.height
    ) {
      throw new Error(`A otimização alterou as dimensões de ${asset.name}.`);
    }
    if (sourceHasTransparency && !runtimeMetadata.hasAlpha) {
      throw new Error(`A otimização removeu o alpha de ${asset.name}.`);
    }
    if (runtimeSize > PRIVATE_ASSET_MAX_FILE_SIZE) {
      throw new Error(`Asset runtime acima de 25 MB: ${runtimeFile}.`);
    }

    assets[assetId] = {
      ...asset,
      file: runtimeFile,
      blobSha256: `sha256:${runtimeHash}`,
      size: runtimeSize,
      width: runtimeMetadata.width,
      height: runtimeMetadata.height,
      mime: runtimeMime,
    };
    delete assets[assetId].sourceFormatVersion;
    optimizedBytes += runtimeSize;
    records.push({
      assetId,
      asset: assets[assetId],
      runtimePath,
      width: runtimeMetadata.width,
      height: runtimeMetadata.height,
      sourceMime: asset.mime,
      runtimeMime,
      sourceHasAlpha: Boolean(sourceMetadata.hasAlpha),
      sourceHasTransparency,
    });
  }

  const presets = sourceManifest.presets;
  await mkdir(path.join(temporaryOutput, "presets", "scenes"), { recursive: true });
  const presetFiles = new Set([presets.cards, presets.decks]);
  for (const entry of Object.values(presets.scenes || {})) {
    presetFiles.add(entry.file);
  }
  for (const relativePath of presetFiles) {
    const value = replaceLogicalReferences(
      await readJson(path.join(sourceRoot, relativePath)),
      replacements,
    );
    const targetPath = path.join(temporaryOutput, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  const samples = await verifyRepresentativeSamples(
    chooseRepresentativeSamples(records, aliases),
  );
  const formatCounts = Object.values(assets).reduce((counts, asset) => {
    counts[asset.mime] = (counts[asset.mime] || 0) + 1;
    return counts;
  }, {});
  const largest = Object.entries(assets)
    .map(([assetId, asset]) => ({ assetId, name: asset.name, file: asset.file, size: asset.size }))
    .sort((left, right) => right.size - left.size)[0];
  const savedBytes = sourceRuntimeBytes - optimizedBytes;
  const report = {
    policy: {
      pngToWebp: true,
      webp: PRIVATE_RUNTIME_WEBP_OPTIONS,
      resized: false,
      jpegRecompressed: false,
      webpRecompressed: false,
      minimumUsefulSavingBytes: PRIVATE_RUNTIME_MIN_SAVING_BYTES,
      minimumUsefulSavingRatio: PRIVATE_RUNTIME_MIN_SAVING_RATIO,
    },
    sourceBytes: sourceRuntimeBytes,
    runtimeBytes: optimizedBytes,
    savedBytes,
    savedPercent: Number(((savedBytes / sourceRuntimeBytes) * 100).toFixed(2)),
    sourceAssetCount: Object.keys(pack.assets).length,
    runtimeAssetCount: Object.keys(assets).length,
    convertedPngCount: converted,
    keptOriginalCount: keptOriginal,
    replacementCount: replacements.size,
    replacements: Object.fromEntries(replacements),
    formatCounts,
    largest,
    samples,
  };
  const runtimeManifest = {
    ...sourceManifest,
    version: PRIVATE_ASSET_PACK_VERSION,
    createdAt: new Date().toISOString(),
    runtimeSize: optimizedBytes,
    bindingSearch: sourceManifest.bindingSearch || "DSC",
    source: {
      formatVersion: sourceManifest.version,
      createdAt: sourceManifest.createdAt,
      assetCount: Object.keys(pack.assets).length,
      runtimeSize: sourceRuntimeBytes,
    },
    optimization: report.policy,
    assets,
    aliases,
  };
  await writeFile(
    path.join(temporaryOutput, "private-asset-pack.json"),
    `${JSON.stringify(runtimeManifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(temporaryOutput, "optimization-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(temporaryOutput, "README.md"),
    [
      "# Double-Sided Cards - Runtime Private Asset Pack",
      "",
      "Saída privada otimizada e reproduzível. A fonte original não foi alterada.",
      "",
      "Fluxo: selecionar este pack, enviar uma vez ao Owlbear, vincular incrementalmente e criar as cenas ou usar as bibliotecas.",
      "O SDK 3.1.0 não retorna IDs/URLs de uploadImages; por isso o vínculo com downloadImages continua sendo uma etapa explícita.",
      "",
    ].join("\n"),
    "utf8",
  );

  await rename(temporaryOutput, output);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  try {
    await rm(temporaryOutput, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (cleanupError) {
    console.warn(`Não foi possível limpar o temporário ${temporaryOutput}: ${cleanupError.message}`);
  }
  throw error;
}
