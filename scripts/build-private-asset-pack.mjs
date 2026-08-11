import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PRIVATE_ASSET_PACK_FORMAT,
  PRIVATE_ASSET_PACK_VERSION,
  getAssetAliasCandidates,
} from "../src/asset-resolver.js";
import { readImageMetadata } from "./image-metadata.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imageExtensions = new Set([
  ".apng",
  ".avif",
  ".gif",
  ".jpg",
  ".jpeg",
  ".png",
  ".svg",
  ".webp",
]);
const protectedDirectories = [
  "assets/preset-cards",
  "assets/preset-decks",
  "assets/scene-presets",
  "assets/local-assets",
];

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function displayPath(filePath) {
  return normalizePath(path.relative(sourceRoot, filePath));
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

async function collectImageFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectImageFiles(entryPath)));
    } else if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
  return files;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(sourceRoot, relativePath), "utf8"));
}

async function readLegacySceneIndex() {
  const indexPath = "assets/scene-presets/index.json";
  if (await exists(path.join(sourceRoot, indexPath))) {
    return readJson(indexPath);
  }

  const sceneDirectory = path.join(sourceRoot, "assets", "scene-presets");
  const fileNames = (await readdir(sceneDirectory))
    .filter((fileName) => fileName.toLowerCase().endsWith(".json") && fileName !== "index.json")
    .sort((left, right) => left.localeCompare(right, "pt-BR"));
  const presets = [];

  for (const fileName of fileNames) {
    const preset = await readJson(`assets/scene-presets/${fileName}`);
    const id = String(preset.id || path.basename(fileName, path.extname(fileName)));
    presets.push({
      id,
      name: preset.name || id,
      savedAt: preset.savedAt,
      itemCount: preset.itemCount,
      url: `assets/scene-presets/${fileName}`,
    });
  }

  if (!presets.length) {
    throw new Error("Nenhum preset de cena foi encontrado na fonte privada.");
  }

  return { version: 1, presets };
}

async function readPreservedImageMetadata(filePath) {
  try {
    return await readImageMetadata(filePath);
  } catch (error) {
    console.warn(`Metadata não legível; arquivo preservado sem alteração: ${displayPath(filePath)}`);
    const extension = path.extname(filePath).toLowerCase();
    return {
      mime:
        extension === ".jpg" || extension === ".jpeg"
          ? "image/jpeg"
          : extension === ".webp"
            ? "image/webp"
            : extension === ".svg"
              ? "image/svg+xml"
              : "image/png",
    };
  }
}

function getLegacyBackgroundSource() {
  const currentPath = path.join(root, "src", "background.js");
  const sources = [];
  try {
    sources.push(execFileSync("git", ["show", "HEAD:src/background.js"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }));
  } catch {
    // O primeiro pack também pode ser criado fora de um checkout Git.
  }
  return readFile(currentPath, "utf8")
    .then((current) => [...sources, current])
    .catch(() => sources);
}

function collectLegacyOwlbearAliases(sources, aliases, pathToAssetId) {
  for (const source of sources) {
    const start = source.indexOf("const BUNDLED_REMOTE_ASSET_IDS");
    const end = source.indexOf("]);", start);
    if (start < 0 || end < 0) {
      continue;
    }

    const block = source.slice(start, end);
    for (const match of block.matchAll(/\["([0-9a-f-]{36})",\s*"([^"]+)"\]/gi)) {
      const target = `assets/local-assets/${match[2]}`;
      const assetId = pathToAssetId.get(target);
      if (assetId) {
        aliases[`owlbear:${match[1]}`] = assetId;
      }
    }
  }
}

function createAliasLookup(aliases) {
  const lookup = new Map();
  const ambiguous = new Set();
  for (const [alias, assetId] of Object.entries(aliases)) {
    for (const candidate of getAssetAliasCandidates(alias)) {
      for (const key of [candidate, candidate.toLowerCase()]) {
        if (ambiguous.has(key)) {
          continue;
        }
        const current = lookup.get(key);
        if (current && current !== assetId) {
          lookup.delete(key);
          ambiguous.add(key);
        } else {
          lookup.set(key, assetId);
        }
      }
    }
  }
  return lookup;
}

function resolveAlias(value, lookup) {
  for (const candidate of getAssetAliasCandidates(value)) {
    const assetId = lookup.get(candidate) || lookup.get(candidate.toLowerCase());
    if (assetId) {
      return assetId;
    }
  }
  return null;
}

function transformAssetReferences(value, lookup, unresolved, label) {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      transformAssetReferences(entry, lookup, unresolved, `${label}[${index}]`),
    );
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const reference = value.assetId || value.path || value.url;
  if (typeof reference === "string") {
    const assetId = resolveAlias(reference, lookup);
    if (assetId) {
      const transformed = { ...value, assetId };
      delete transformed.path;
      delete transformed.url;
      return transformed;
    }

    if (/^(?:https?:|file:)|^[a-z]:[\\/]/i.test(reference)) {
      unresolved.push({ label, reference });
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      transformAssetReferences(entry, lookup, unresolved, `${label}.${key}`),
    ]),
  );
}

function getSceneDefinition(indexEntry) {
  const labels = {
    tutorial: {
      label: "Tutorial",
      restoreLabel: "Restaurar o Tutorial",
    },
    "missao-0-5": {
      label: "Missão 0.5 (não oficial)",
      restoreLabel: "Restaurar a Missão 0.5 (não oficial)",
    },
  };
  return {
    name: indexEntry.name,
    ...(labels[indexEntry.id] || {}),
  };
}

const outputArgument = getArgument("--output");
if (!outputArgument) {
  throw new Error("Informe --output com um diretório privado fora do repositório público.");
}

const sourceArgument = getArgument("--source");
const sourceRoot = path.resolve(root, sourceArgument || ".");
const previousManifestArgument = getArgument("--previous");
const output = path.resolve(root, outputArgument);
if (isInside(root, output)) {
  throw new Error("O Private Asset Pack não pode ser criado dentro do Core público.");
}
if (await exists(output)) {
  throw new Error(`O destino já existe: ${output}. Escolha um diretório vazio.`);
}

for (const directory of protectedDirectories) {
  if (!(await exists(path.join(sourceRoot, directory)))) {
    throw new Error(`Fonte privada ausente: ${directory}`);
  }
}

const outputParent = path.dirname(output);
await mkdir(outputParent, { recursive: true });
const temporaryOutput = await mkdtemp(path.join(outputParent, ".dsc-private-pack-"));

try {
  const imageFiles = (
    await Promise.all(
      protectedDirectories.map((directory) => collectImageFiles(path.join(sourceRoot, directory))),
    )
  ).flat();
  const fileEntries = [];

  for (let index = 0; index < imageFiles.length; index += 1) {
    const filePath = imageFiles[index];
    const details = await stat(filePath);
    const hash = await hashFile(filePath);
    fileEntries.push({
      filePath,
      path: displayPath(filePath),
      hash,
      size: details.size,
      metadata: await readPreservedImageMetadata(filePath),
    });
    if ((index + 1) % 100 === 0 || index + 1 === imageFiles.length) {
      console.log(`Hash: ${index + 1}/${imageFiles.length}`);
    }
  }

  const groupsByHash = new Map();
  for (const entry of fileEntries) {
    const group = groupsByHash.get(entry.hash) || [];
    group.push(entry);
    groupsByHash.set(entry.hash, group);
  }

  const assets = {};
  const aliases = {};
  const pathToAssetId = new Map();
  await mkdir(path.join(temporaryOutput, "assets"), { recursive: true });

  for (const [hash, entries] of [...groupsByHash.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    entries.sort((left, right) => left.path.localeCompare(right.path, "pt-BR"));
    const representative = entries[0];
    const assetId = `sha256:${hash}`;
    const extension = path.extname(representative.path).toLowerCase();
    const canonicalFile = `assets/${hash}${extension}`;
    const originalName = path.basename(representative.path);
    const shortName = originalName.replace(/[^\p{L}\p{N}_. -]+/gu, "-").slice(0, 55);

    assets[assetId] = {
      file: canonicalFile,
      name: originalName,
      owlbearName: `DSC ${hash.slice(0, 12)} ${shortName}`,
      size: representative.size,
      ...representative.metadata,
      typeHint: "PROP",
    };
    await copyFile(representative.filePath, path.join(temporaryOutput, canonicalFile));

    for (const entry of entries) {
      aliases[entry.path] = assetId;
      pathToAssetId.set(entry.path, assetId);
      const localPrefix = "assets/local-assets/";
      if (entry.path.startsWith(localPrefix)) {
        aliases[`.local-assets/${entry.path.slice(localPrefix.length)}`] = assetId;
      }

      const owlbearMatch = path.basename(entry.path).match(/owlbear-([0-9a-f-]{36})-/i);
      if (owlbearMatch) {
        aliases[`owlbear:${owlbearMatch[1]}`] = assetId;
      }
    }
  }

  collectLegacyOwlbearAliases(await getLegacyBackgroundSource(), aliases, pathToAssetId);
  if (previousManifestArgument) {
    const previousManifest = JSON.parse(
      await readFile(path.resolve(root, previousManifestArgument), "utf8"),
    );
    for (const [alias, assetId] of Object.entries(previousManifest.aliases || {})) {
      if (assets[assetId]) {
        aliases[alias] = assetId;
      }
    }
  }
  const aliasLookup = createAliasLookup(aliases);
  const unresolved = [];
  const cards = transformAssetReferences(
    await readJson("assets/preset-cards/cards.json"),
    aliasLookup,
    unresolved,
    "cards",
  );
  const decks = transformAssetReferences(
    await readJson("assets/preset-decks/decks.json"),
    aliasLookup,
    unresolved,
    "decks",
  );
  const sceneIndex = await readLegacySceneIndex();
  const sceneManifest = {};

  await mkdir(path.join(temporaryOutput, "presets", "scenes"), { recursive: true });
  for (const entry of sceneIndex.presets || []) {
    const sourceFile = normalizePath(entry.url).split("/").pop();
    const preset = transformAssetReferences(
      await readJson(`assets/scene-presets/${sourceFile}`),
      aliasLookup,
      unresolved,
      `scenes.${entry.id}`,
    );
    const presetFile = `presets/scenes/${sourceFile}`;
    sceneManifest[entry.id] = {
      ...getSceneDefinition(entry),
      file: presetFile,
    };
    await writeFile(
      path.join(temporaryOutput, presetFile),
      `${JSON.stringify(preset, null, 2)}\n`,
      "utf8",
    );
  }

  if (unresolved.length) {
    const sample = unresolved
      .slice(0, 20)
      .map((entry) => `${entry.label}: ${entry.reference}`)
      .join("\n");
    throw new Error(`${unresolved.length} referências privadas não foram resolvidas:\n${sample}`);
  }

  await writeFile(
    path.join(temporaryOutput, "presets", "cards.json"),
    `${JSON.stringify(cards, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(temporaryOutput, "presets", "decks.json"),
    `${JSON.stringify(decks, null, 2)}\n`,
    "utf8",
  );

  const packManifest = {
    format: PRIVATE_ASSET_PACK_FORMAT,
    version: PRIVATE_ASSET_PACK_VERSION,
    id: "double-sided-cards-private-assets",
    name: "Double-Sided Cards - Private Asset Pack",
    createdAt: new Date().toISOString(),
    assets,
    aliases,
    presets: {
      cards: "presets/cards.json",
      decks: "presets/decks.json",
      scenes: sceneManifest,
    },
  };
  await writeFile(
    path.join(temporaryOutput, "private-asset-pack.json"),
    `${JSON.stringify(packManifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(temporaryOutput, "README.md"),
    [
      "# Double-Sided Cards - Private Asset Pack",
      "",
      "Esta pasta e privada e nao deve ser publicada no GitHub Pages.",
      "",
      "No painel da extensao: selecione esta pasta, envie os assets canonicos ao Owlbear e depois use o seletor do Owlbear para vincula-los.",
      "O upload e o vinculo sao etapas separadas porque o SDK 3.1.0 nao retorna IDs ou URLs em uploadImages.",
      "",
    ].join("\n"),
    "utf8",
  );

  await rename(temporaryOutput, output);
  const duplicateCount = fileEntries.length - Object.keys(assets).length;
  console.log(`Pack criado em ${output}`);
  console.log(
    `${fileEntries.length} arquivos de origem, ${Object.keys(assets).length} canônicos, ${duplicateCount} duplicatas físicas removidas.`,
  );
} catch (error) {
  await rm(temporaryOutput, { recursive: true, force: true });
  throw error;
}
