import {
  PRIVATE_ASSET_PACK_FORMAT,
  PRIVATE_ASSET_PACK_VERSION,
  createAssetResolver,
  getConfiguredPrivateAssetPack,
  installPrivateAssetPack,
  savePrivateAssetBindings,
  validatePrivateAssetPack,
} from "./asset-resolver.js";

const ASSET_DESCRIPTION_PREFIX = "double-sided-cards-private-asset:";
const UPLOAD_CHUNK_SIZE = 25;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function getFilePaths(file) {
  const full = normalizePath(file.webkitRelativePath || file.name);
  const paths = new Set([full]);
  const slashIndex = full.indexOf("/");
  if (slashIndex >= 0) {
    paths.add(full.slice(slashIndex + 1));
  }
  return [...paths];
}

function buildFileIndex(files) {
  const index = new Map();
  for (const file of files) {
    for (const filePath of getFilePaths(file)) {
      const current = index.get(filePath);
      if (current && current !== file) {
        index.set(filePath, null);
      } else {
        index.set(filePath, file);
      }
    }
  }
  return index;
}

function findFile(index, requestedPath) {
  const normalized = normalizePath(requestedPath);
  const exact = index.get(normalized);
  if (exact) {
    return exact;
  }

  const matches = [...index.entries()].filter(
    ([filePath, file]) => file && filePath.endsWith(`/${normalized}`),
  );
  if (matches.length === 1) {
    return matches[0][1];
  }
  return null;
}

async function parseJsonFile(file, label) {
  if (!file) {
    throw new Error(`${label} não foi encontrado no Private Asset Pack.`);
  }

  try {
    return JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`${label} possui JSON inválido: ${error.message}`);
  }
}

export async function hydratePrivateAssetPackManifest(manifest, readJson) {
  if (
    !isRecord(manifest) ||
    manifest.format !== PRIVATE_ASSET_PACK_FORMAT ||
    manifest.version !== PRIVATE_ASSET_PACK_VERSION ||
    !isRecord(manifest.presets)
  ) {
    throw new Error("O manifesto do Private Asset Pack é inválido.");
  }

  const cards = await readJson(manifest.presets.cards, "Manifesto de cartas");
  const decks = await readJson(manifest.presets.decks, "Manifesto de pilhas");
  const scenes = {};

  for (const [sceneId, sceneEntry] of Object.entries(manifest.presets.scenes || {})) {
    if (!isRecord(sceneEntry) || typeof sceneEntry.file !== "string") {
      throw new Error(`A definição do preset ${sceneId} é inválida.`);
    }

    const preset = await readJson(sceneEntry.file, `Preset ${sceneId}`);
    scenes[sceneId] = {
      definition: {
        id: sceneId,
        name: sceneEntry.name || preset.name || sceneId,
        label: sceneEntry.label,
        restoreLabel:
          sceneEntry.restoreLabel || `Restaurar ${sceneEntry.label || sceneEntry.name || preset.name || sceneId}`,
      },
      summary: {
        savedAt: preset.savedAt,
        itemCount: preset.itemCount,
      },
      preset,
    };
  }

  return validatePrivateAssetPack({
    ...manifest,
    presets: {
      cards,
      decks,
      scenes,
    },
  });
}

export async function readPrivateAssetPackFiles(fileList) {
  const files = [...(fileList || [])];
  const index = buildFileIndex(files);
  const manifestCandidates = files.filter(
    (file) => normalizePath(file.name).toLowerCase() === "private-asset-pack.json",
  );

  if (manifestCandidates.length !== 1) {
    throw new Error(
      "Selecione uma pasta que contenha exatamente um private-asset-pack.json.",
    );
  }

  const manifest = await parseJsonFile(manifestCandidates[0], "Manifesto do pack");
  const pack = await hydratePrivateAssetPackManifest(manifest, async (filePath, label) =>
    parseJsonFile(findFile(index, filePath), label),
  );
  const assetFiles = new Map();

  for (const [assetId, asset] of Object.entries(pack.assets)) {
    const file = findFile(index, asset.file);
    if (file) {
      assetFiles.set(assetId, file);
    }
  }

  return {
    pack,
    assetFiles,
    fileCount: files.length,
  };
}

function getUploadType(asset) {
  return new Set(["MAP", "PROP", "MOUNT", "CHARACTER", "ATTACHMENT", "NOTE"]).has(
    asset.typeHint,
  )
    ? asset.typeHint
    : "PROP";
}

function createUpload(buildImageUpload, file, assetId, asset) {
  return buildImageUpload(file)
    .name(asset.owlbearName)
    .description(`${ASSET_DESCRIPTION_PREFIX}${encodeURIComponent(assetId)}`)
    .build();
}

export async function uploadPrivateAssetPack(
  OBR,
  buildImageUpload,
  importedPack,
  onProgress = () => {},
) {
  if (!OBR?.assets?.uploadImages || typeof buildImageUpload !== "function") {
    throw new Error("A API de assets do Owlbear não está disponível.");
  }

  const entries = Object.entries(importedPack?.pack?.assets || {}).filter(([assetId]) =>
    importedPack.assetFiles?.has(assetId),
  );
  if (!entries.length) {
    throw new Error("O pack selecionado não contém os arquivos canônicos para envio.");
  }

  let uploaded = 0;
  const groups = new Map();
  for (const entry of entries) {
    const type = getUploadType(entry[1]);
    const values = groups.get(type) || [];
    values.push(entry);
    groups.set(type, values);
  }

  for (const [type, group] of groups) {
    for (let index = 0; index < group.length; index += UPLOAD_CHUNK_SIZE) {
      const chunk = group.slice(index, index + UPLOAD_CHUNK_SIZE);
      const uploads = chunk.map(([assetId, asset]) =>
        createUpload(buildImageUpload, importedPack.assetFiles.get(assetId), assetId, asset),
      );
      await OBR.assets.uploadImages(uploads, type);
      uploaded += chunk.length;
      onProgress({ uploaded, total: entries.length });
    }
  }

  return {
    uploaded,
    missingFiles: Object.keys(importedPack.pack.assets).length - entries.length,
  };
}

function getAssetIdFromDescription(description, pack) {
  if (typeof description !== "string" || !description.startsWith(ASSET_DESCRIPTION_PREFIX)) {
    return null;
  }

  try {
    const assetId = decodeURIComponent(description.slice(ASSET_DESCRIPTION_PREFIX.length));
    return pack.assets[assetId] ? assetId : null;
  } catch {
    return null;
  }
}

function buildUniqueNameIndex(pack) {
  const index = new Map();
  const ambiguous = new Set();

  for (const [assetId, asset] of Object.entries(pack.assets)) {
    const names = [asset.owlbearName, asset.name, asset.file?.split("/").pop()]
      .map(normalizeName)
      .filter(Boolean);
    for (const name of names) {
      if (ambiguous.has(name)) {
        continue;
      }
      const current = index.get(name);
      if (current && current !== assetId) {
        index.delete(name);
        ambiguous.add(name);
      } else {
        index.set(name, assetId);
      }
    }
  }

  return index;
}

export function matchOwlbearAssetBindings(pack, selectedAssets) {
  const normalizedPack = validatePrivateAssetPack(pack);
  const resolver = createAssetResolver(normalizedPack);
  const nameIndex = buildUniqueNameIndex(normalizedPack);
  const bindings = {};
  const unmatched = [];

  for (const selected of selectedAssets || []) {
    const assetId =
      getAssetIdFromDescription(selected?.description, normalizedPack) ||
      nameIndex.get(normalizeName(selected?.name)) ||
      resolver.getCanonicalId(selected?.image?.url || "");

    if (!assetId || !selected?.image?.url) {
      unmatched.push(selected?.name || "asset sem nome");
      continue;
    }

    bindings[assetId] = {
      ...selected.image,
      name: selected.name,
    };
  }

  return { bindings, unmatched };
}

export async function linkPrivateAssetPackFromOwlbear(OBR, storage) {
  if (!OBR?.assets?.downloadImages) {
    throw new Error("A API de assets do Owlbear não está disponível.");
  }

  const pack = getConfiguredPrivateAssetPack(storage);
  if (!pack) {
    throw new Error("Configure o Private Asset Pack antes de vincular os assets.");
  }

  const selected = await OBR.assets.downloadImages(true, "DSC");
  const { bindings, unmatched } = matchOwlbearAssetBindings(pack, selected);
  if (Object.keys(bindings).length) {
    savePrivateAssetBindings(bindings, storage);
  }

  return {
    selected: selected.length,
    linked: Object.keys(bindings).length,
    unmatched,
  };
}

export function configurePrivateAssetPack(importedPack, storage) {
  installPrivateAssetPack(importedPack.pack, storage);
  return importedPack.pack;
}
