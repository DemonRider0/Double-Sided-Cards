import {
  PRIVATE_ASSET_PACK_FORMAT,
  createAssetResolver,
  getConfiguredPrivateAssetPack,
  getPrivateAssetUploadMime,
  isSupportedPrivateAssetPackVersion,
  installPrivateAssetPack,
  savePrivateAssetBindings,
  validatePrivateAssetPack,
} from "./asset-resolver.js";

const ASSET_DESCRIPTION_PREFIX = "double-sided-cards-private-asset:";

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
    !isSupportedPrivateAssetPackVersion(manifest.version) ||
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
        createLabel:
          sceneEntry.createLabel || `Criar cena ${sceneEntry.label || sceneEntry.name || preset.name || sceneId}`,
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

function getErrorText(error) {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (error == null) {
    return "A API rejeitou a operação sem fornecer detalhes.";
  }

  for (const candidate of [
    error.message,
    error.error?.message,
    error.error,
    error.reason?.message,
    error.reason,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") {
      return serialized;
    }
  } catch {
    // A referência ao erro original continua disponível em `cause`.
  }

  const fallback = String(error);
  return fallback && fallback !== "[object Object]"
    ? fallback
    : "A API rejeitou a operação com um objeto de erro sem mensagem.";
}

function getErrorCategory(error, fallback = "api") {
  const values = [
    error?.name,
    error?.code,
    error?.message,
    error?.error?.message,
    error?.error,
    error?.reason?.message,
    error?.reason,
  ]
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" ")
    .toLowerCase();

  if (
    error?.name === "AbortError" ||
    /\b(?:abort(?:ed)?|cancel(?:ed|led|ado|ada)?|user denied)\b/i.test(values)
  ) {
    return "cancelled";
  }

  if (
    error?.name === "QuotaExceededError" ||
    error?.code === 22 ||
    error?.code === 1014 ||
    /quota|storage|armazenamento|cota|insufficient (?:space|storage)|not enough (?:space|storage)|storage limit/i.test(
      values,
    )
  ) {
    return "storage";
  }

  if (
    /invalid (?:file|image)|unsupported (?:file|image|mime|format)|mime|empty file|arquivo (?:inválido|vazio)/i.test(
      values,
    )
  ) {
    return "invalid-file";
  }

  return fallback;
}

function createPreparationError(stage, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "PrivateAssetPreparationError";
  error.uploadStage = stage;
  error.uploadCategory = "invalid-file";
  if (cause !== undefined && error.cause === undefined) {
    error.cause = cause;
  }
  return error;
}

function getAssetFileName(asset) {
  return normalizePath(asset?.file).split("/").filter(Boolean).pop() || "";
}

function assertPreparedFile(file, expectedName, expectedMime, expectedSize) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw createPreparationError(
      "validação do File reconstruído",
      "O ImageUpload não contém um File/Blob legível.",
    );
  }
  if (file.name !== expectedName) {
    throw createPreparationError(
      "validação do File reconstruído",
      `O File reconstruído recebeu o nome incorreto: ${file.name || "sem nome"}.`,
    );
  }
  if (file.type !== expectedMime) {
    throw createPreparationError(
      "validação do File reconstruído",
      `O File reconstruído recebeu o MIME incorreto: ${file.type || "sem MIME"}.`,
    );
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size !== expectedSize) {
    throw createPreparationError(
      "validação do File reconstruído",
      `O File reconstruído possui tamanho inválido: ${file.size || 0} bytes.`,
    );
  }
}

export async function preparePrivateAssetUpload(buildImageUpload, file, assetId, asset) {
  if (typeof buildImageUpload !== "function") {
    throw createPreparationError(
      "construção do ImageUpload",
      "O construtor de ImageUpload do Owlbear não está disponível.",
    );
  }
  if (!file || typeof file.arrayBuffer !== "function") {
    throw createPreparationError(
      "leitura do arquivo",
      "O arquivo selecionado não expõe bytes legíveis com arrayBuffer().",
    );
  }

  const expectedName = getAssetFileName(asset);
  if (!expectedName || typeof file.name !== "string" || file.name !== expectedName) {
    throw createPreparationError(
      "validação do arquivo",
      `Nome de arquivo inválido para ${assetId}: esperado ${expectedName || "um nome canônico"}, recebido ${file?.name || "sem nome"}.`,
    );
  }

  const mime = getPrivateAssetUploadMime(expectedName);
  const manifestMime =
    typeof asset?.mime === "string" ? asset.mime.trim().toLowerCase() : "";
  const browserMime = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  if (!mime) {
    throw createPreparationError(
      "validação do arquivo",
      `Formato não suportado para upload privado no Owlbear: ${expectedName}.`,
    );
  }
  if (manifestMime !== mime || (browserMime && browserMime !== mime)) {
    throw createPreparationError(
      "validação do arquivo",
      `MIME inválido para ${expectedName}: manifesto ${manifestMime || "não informado"}, navegador ${browserMime || "não informado"}; esperado ${mime}.`,
    );
  }

  let bytes;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    throw createPreparationError(
      "leitura dos bytes do arquivo",
      `Não foi possível ler ${expectedName}: ${getErrorText(error)}`,
      error,
    );
  }

  if (!Number.isFinite(bytes?.byteLength) || bytes.byteLength <= 0) {
    throw createPreparationError(
      "validação dos bytes do arquivo",
      `O arquivo ${expectedName} está vazio ou não retornou um ArrayBuffer válido.`,
    );
  }
  if (Number.isFinite(asset?.size) && asset.size > 0 && bytes.byteLength !== asset.size) {
    throw createPreparationError(
      "validação dos bytes do arquivo",
      `O arquivo ${expectedName} possui ${bytes.byteLength} bytes; o manifesto exige ${asset.size}.`,
    );
  }
  if (typeof globalThis.File !== "function") {
    throw createPreparationError(
      "reconstrução do File",
      "O navegador não disponibilizou o construtor File exigido pelo upload do Owlbear.",
    );
  }

  let rebuiltFile;
  try {
    rebuiltFile = new File([bytes], expectedName, { type: mime });
  } catch (error) {
    throw createPreparationError(
      "reconstrução do File",
      `Não foi possível reconstruir ${expectedName}: ${getErrorText(error)}`,
      error,
    );
  }
  assertPreparedFile(rebuiltFile, expectedName, mime, bytes.byteLength);

  let upload;
  try {
    upload = buildImageUpload(rebuiltFile)
      .name(asset.owlbearName)
      .description(`${ASSET_DESCRIPTION_PREFIX}${encodeURIComponent(assetId)}`)
      .build();
  } catch (error) {
    throw createPreparationError(
      "construção do ImageUpload",
      `Não foi possível criar o ImageUpload de ${expectedName}: ${getErrorText(error)}`,
      error,
    );
  }
  assertPreparedFile(upload?.file, expectedName, mime, bytes.byteLength);
  return upload;
}

function createUploadError(error, context) {
  const originalError = error?.cause ?? error;
  const category = getErrorCategory(
    originalError,
    error?.uploadCategory || context.category || "api",
  );
  const assetLabel = context.assetId
    ? ` Asset: ${context.assetName || "sem nome"} (${context.assetId}).`
    : "";
  const categoryMessage =
    category === "cancelled"
      ? " O envio foi cancelado pelo usuário; tente novamente quando estiver pronto."
      : category === "storage"
        ? " A rejeição indica um possível problema de armazenamento/cota do Owlbear; confira o espaço disponível na conta."
        : category === "invalid-file"
          ? " O arquivo não atende aos requisitos de upload; selecione novamente o pack e confira o arquivo indicado."
          : "";
  const message =
    `Falha na etapa \"${context.stage}\". ` +
    `${context.prepared} de ${context.total} arquivos preparados; ` +
    `${context.uploaded} de ${context.total} uploads confirmados.` +
    assetLabel +
    ` Erro original: ${getErrorText(originalError)}.` +
    categoryMessage;
  const wrapped = new Error(message, { cause: originalError });
  wrapped.name = "PrivateAssetUploadError";
  wrapped.stage = context.stage;
  wrapped.category = category;
  wrapped.cancelled = category === "cancelled";
  wrapped.possibleStorageIssue = category === "storage";
  wrapped.prepared = context.prepared;
  wrapped.uploaded = context.uploaded;
  wrapped.total = context.total;
  wrapped.assetId = context.assetId || null;
  wrapped.assetName = context.assetName || null;
  if (wrapped.cause === undefined) {
    wrapped.cause = originalError;
  }
  return wrapped;
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
  let prepared = 0;
  const groups = new Map();
  for (const entry of entries) {
    const type = getUploadType(entry[1]);
    const values = groups.get(type) || [];
    values.push(entry);
    groups.set(type, values);
  }

  for (const [type, group] of groups) {
    const uploads = [];
    for (const [assetId, asset] of group) {
      try {
        uploads.push(
          await preparePrivateAssetUpload(
            buildImageUpload,
            importedPack.assetFiles.get(assetId),
            assetId,
            asset,
          ),
        );
      } catch (error) {
        throw createUploadError(error, {
          stage: error?.uploadStage || "preparação do ImageUpload",
          category: "invalid-file",
          prepared,
          uploaded,
          total: entries.length,
          assetId,
          assetName: asset.owlbearName,
        });
      }
      prepared += 1;
      onProgress({
        stage: "preparing",
        processed: prepared,
        prepared,
        uploaded,
        total: entries.length,
        assetId,
        assetName: asset.owlbearName,
      });
    }

    onProgress({
      stage: "uploading",
      processed: uploaded,
      prepared,
      uploaded,
      total: entries.length,
      groupSize: group.length,
      type,
    });
    try {
      await OBR.assets.uploadImages(uploads, type);
    } catch (error) {
      throw createUploadError(error, {
        stage: "envio à API do Owlbear",
        prepared,
        uploaded,
        total: entries.length,
      });
    }
    uploaded += group.length;
    onProgress({
      stage: "uploaded",
      processed: uploaded,
      prepared,
      uploaded,
      total: entries.length,
      groupSize: group.length,
      type,
    });
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

export function matchOwlbearAssetBindings(pack, selectedAssets, options = {}) {
  const normalizedPack = validatePrivateAssetPack(pack);
  const resolver = createAssetResolver(normalizedPack);
  const nameIndex = buildUniqueNameIndex(normalizedPack);
  const allowedAssetIds = options.assetIds
    ? new Set(
        [...options.assetIds]
          .map((assetId) => resolver.getCanonicalId(assetId) || assetId)
          .filter((assetId) => normalizedPack.assets[assetId]),
      )
    : null;
  const bindings = {};
  const unmatched = [];
  const ignored = [];

  for (const selected of selectedAssets || []) {
    const assetId =
      getAssetIdFromDescription(selected?.description, normalizedPack) ||
      nameIndex.get(normalizeName(selected?.name)) ||
      resolver.getCanonicalId(selected?.image?.url || "");

    if (!assetId || !selected?.image?.url) {
      unmatched.push(selected?.name || "asset sem nome");
      continue;
    }

    if (allowedAssetIds && !allowedAssetIds.has(assetId)) {
      ignored.push(selected?.name || normalizedPack.assets[assetId].name || assetId);
      continue;
    }

    bindings[assetId] = {
      ...selected.image,
      name: selected.name,
    };
  }

  return { bindings, unmatched, ignored };
}

export async function linkPrivateAssetPackFromOwlbear(OBR, storage) {
  if (!OBR?.assets?.downloadImages) {
    throw new Error("A API de assets do Owlbear não está disponível.");
  }

  const pack = getConfiguredPrivateAssetPack(storage);
  if (!pack) {
    throw new Error("Configure o Private Asset Pack antes de vincular os assets.");
  }

  const search =
    typeof pack.bindingSearch === "string" && pack.bindingSearch.trim()
      ? pack.bindingSearch.trim()
      : "DSC";
  const selected = await OBR.assets.downloadImages(true, search);
  const { bindings, unmatched } = matchOwlbearAssetBindings(pack, selected);
  if (Object.keys(bindings).length) {
    savePrivateAssetBindings(bindings, storage);
  }

  return {
    selected: selected.length,
    linked: Object.keys(bindings).length,
    unmatched,
    search,
  };
}

export function configurePrivateAssetPack(importedPack, storage) {
  installPrivateAssetPack(importedPack.pack, storage);
  return importedPack.pack;
}
