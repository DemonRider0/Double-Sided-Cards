const PRIVATE_ASSET_STATE_VERSION = 1;

export const PRIVATE_ASSET_PACK_FORMAT = "double-sided-cards-private-asset-pack";
export const PRIVATE_ASSET_PACK_VERSION = 2;
export const PRIVATE_ASSET_PACK_SUPPORTED_VERSIONS = Object.freeze([1, 2]);
export const PRIVATE_ASSET_STORAGE_KEY =
  "br.demonrider.double-sided-cards/private-asset-pack";
export const PRIVATE_ASSET_MAX_FILE_SIZE = 25_000_000;
export const PRIVATE_ASSET_UPLOAD_FORMATS = Object.freeze({
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
});

let cachedStorage = null;
let cachedRawState = undefined;
let cachedState = null;
let cachedResolver = null;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getDefaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeSlashes(value) {
  return String(value || "").replaceAll("\\", "/");
}

export function getPrivateAssetUploadMime(value) {
  const fileName = normalizeSlashes(value).split("/").filter(Boolean).pop() || "";
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : "";
  return PRIVATE_ASSET_UPLOAD_FORMATS[extension] || null;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function addPathCandidates(candidates, rawPath) {
  const decoded = safeDecode(normalizeSlashes(rawPath))
    .replace(/[?#].*$/, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");

  if (!decoded) {
    return;
  }

  candidates.add(decoded);

  const repositoryMarker = "Double-Sided-Cards/";
  const repositoryIndex = decoded.indexOf(repositoryMarker);
  if (repositoryIndex >= 0) {
    candidates.add(decoded.slice(repositoryIndex + repositoryMarker.length));
  }

  const assetsIndex = decoded.indexOf("assets/");
  if (assetsIndex >= 0) {
    candidates.add(decoded.slice(assetsIndex));
  }

  const localMarker = ".local-assets/";
  const localIndex = decoded.indexOf(localMarker);
  if (localIndex >= 0) {
    const filename = decoded.slice(localIndex + localMarker.length);
    candidates.add(`${localMarker}${filename}`);
    candidates.add(`assets/local-assets/${filename}`);
  }

  const publishedLocalMarker = "assets/local-assets/";
  const publishedLocalIndex = decoded.indexOf(publishedLocalMarker);
  if (publishedLocalIndex >= 0) {
    const filename = decoded.slice(publishedLocalIndex + publishedLocalMarker.length);
    candidates.add(`${localMarker}${filename}`);
    candidates.add(`${publishedLocalMarker}${filename}`);
  }
}

export function getAssetAliasCandidates(value) {
  const candidates = new Set();
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) {
    return [];
  }

  candidates.add(raw);

  const nestedMatches = [...raw.matchAll(/https?:\/\//gi)];
  if (nestedMatches.length > 1) {
    const nested = raw.slice(nestedMatches[nestedMatches.length - 1].index);
    if (nested && nested !== raw) {
      for (const candidate of getAssetAliasCandidates(nested)) {
        candidates.add(candidate);
      }
    }
  }

  addPathCandidates(candidates, raw);

  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    candidates.add(url.toString());
    addPathCandidates(candidates, url.pathname);

    if (url.hostname.toLowerCase() === "images.owlbear.rodeo") {
      const filename = safeDecode(url.pathname.split("/").filter(Boolean).pop() || "");
      const assetId = filename.replace(/\.[^.]+$/, "");
      if (assetId) {
        candidates.add(`owlbear:${assetId}`);
      }
    }
  } catch {
    // Caminhos relativos e IDs lógicos são candidatos válidos sem serem URLs.
  }

  return [...candidates].filter(Boolean);
}

function assertSafeRelativePath(value, label) {
  const normalized = normalizeSlashes(value).replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`${label} precisa ser um caminho relativo dentro do pack.`);
  }
  return normalized;
}

function normalizeSha256(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} precisa ser um SHA-256 no formato sha256:<hex>.`);
  }
  return normalized;
}

export function isSupportedPrivateAssetPackVersion(version) {
  return PRIVATE_ASSET_PACK_SUPPORTED_VERSIONS.includes(version);
}

export function validatePrivateAssetPack(value) {
  if (
    !isRecord(value) ||
    value.format !== PRIVATE_ASSET_PACK_FORMAT ||
    !isSupportedPrivateAssetPackVersion(value.version) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    !isRecord(value.assets) ||
    !isRecord(value.aliases) ||
    !isRecord(value.presets)
  ) {
    throw new Error("O Private Asset Pack possui uma estrutura inválida.");
  }

  const sourceFormatVersion = value.version;
  const pack = clone(value);
  pack.version = PRIVATE_ASSET_PACK_VERSION;
  pack.sourceFormatVersion = sourceFormatVersion;
  for (const [assetId, asset] of Object.entries(pack.assets)) {
    if (!assetId || !isRecord(asset)) {
      throw new Error("O Private Asset Pack possui um asset canônico inválido.");
    }
    asset.file = assertSafeRelativePath(asset.file, `O asset ${assetId}`);
    const logicalSha256 = normalizeSha256(assetId, `O asset lógico ${assetId}`);
    asset.blobSha256 = normalizeSha256(
      sourceFormatVersion === 1 ? asset.blobSha256 || logicalSha256 : asset.blobSha256,
      `O hash físico do asset ${assetId}`,
    );
    const expectedMime = getPrivateAssetUploadMime(asset.file);
    if (!expectedMime) {
      throw new Error(
        `O asset ${assetId} usa um formato não suportado para upload no Owlbear: ${asset.file}.`,
      );
    }
    const declaredMime =
      typeof asset.mime === "string" ? asset.mime.trim().toLowerCase() : "";
    if (declaredMime !== expectedMime) {
      throw new Error(
        `O asset ${assetId} possui MIME incompatível: ${declaredMime || "não informado"}; esperado ${expectedMime}.`,
      );
    }
    asset.mime = expectedMime;
    if (
      !Number.isFinite(asset.size) ||
      asset.size <= 0 ||
      asset.size > PRIVATE_ASSET_MAX_FILE_SIZE
    ) {
      throw new Error(
        `O asset ${assetId} possui tamanho incompatível com o plano Fledgling: ${asset.size || 0} bytes; máximo ${PRIVATE_ASSET_MAX_FILE_SIZE} bytes.`,
      );
    }
    if (typeof asset.owlbearName !== "string" || !asset.owlbearName.trim()) {
      throw new Error(`O asset ${assetId} não possui nome para o Owlbear.`);
    }
    if (
      !Number.isInteger(asset.width) ||
      asset.width <= 0 ||
      !Number.isInteger(asset.height) ||
      asset.height <= 0
    ) {
      throw new Error(`O asset ${assetId} não possui dimensões válidas.`);
    }
  }

  pack.runtimeSize = Object.values(pack.assets).reduce((total, asset) => total + asset.size, 0);

  for (const [alias, assetId] of Object.entries(pack.aliases)) {
    if (!alias || typeof assetId !== "string" || !pack.assets[assetId]) {
      throw new Error(`O alias ${alias || "sem nome"} aponta para um asset desconhecido.`);
    }
  }

  if (
    !isRecord(pack.presets.cards) ||
    !isRecord(pack.presets.decks) ||
    !isRecord(pack.presets.scenes)
  ) {
    throw new Error("Os manifests e presets do Private Asset Pack não foram carregados.");
  }

  for (const [sceneId, scene] of Object.entries(pack.presets.scenes)) {
    if (
      !sceneId ||
      !isRecord(scene) ||
      !isRecord(scene.definition) ||
      !isRecord(scene.preset)
    ) {
      throw new Error(`O preset privado ${sceneId || "sem ID"} é inválido.`);
    }
  }

  return pack;
}

function normalizeBinding(value) {
  const image = isRecord(value?.image) ? value.image : value;
  if (!isRecord(image) || typeof image.url !== "string" || !image.url.trim()) {
    return null;
  }

  return {
    url: image.url,
    width: Number.isFinite(image.width) && image.width > 0 ? image.width : undefined,
    height: Number.isFinite(image.height) && image.height > 0 ? image.height : undefined,
    mime: typeof image.mime === "string" && image.mime.trim() ? image.mime : undefined,
    name: typeof value?.name === "string" && value.name.trim() ? value.name : undefined,
  };
}

function normalizeBindings(bindings, pack) {
  const normalized = {};
  for (const [assetId, binding] of Object.entries(bindings || {})) {
    if (!pack.assets[assetId]) {
      continue;
    }
    const value = normalizeBinding(binding);
    if (value) {
      normalized[assetId] = value;
    }
  }
  return normalized;
}

function validateStoredState(value) {
  if (!isRecord(value) || value.version !== PRIVATE_ASSET_STATE_VERSION) {
    return null;
  }

  try {
    const pack = validatePrivateAssetPack(value.pack);
    return {
      version: PRIVATE_ASSET_STATE_VERSION,
      pack,
      bindings: normalizeBindings(value.bindings, pack),
    };
  } catch (error) {
    console.warn("Private Asset Pack persistido ignorado", error);
    return null;
  }
}

function resetCache() {
  cachedStorage = null;
  cachedRawState = undefined;
  cachedState = null;
  cachedResolver = null;
}

export function readPrivateAssetState(storage = getDefaultStorage()) {
  if (!storage) {
    return null;
  }

  let raw;
  try {
    raw = storage.getItem(PRIVATE_ASSET_STORAGE_KEY);
  } catch {
    return null;
  }

  if (storage === cachedStorage && raw === cachedRawState) {
    return cachedState ? clone(cachedState) : null;
  }

  let state = null;
  if (raw) {
    try {
      state = validateStoredState(JSON.parse(raw));
    } catch (error) {
      console.warn("Não foi possível ler o Private Asset Pack persistido", error);
    }
  }

  cachedStorage = storage;
  cachedRawState = raw;
  cachedState = state;
  cachedResolver = null;
  return state ? clone(state) : null;
}

function writePrivateAssetState(state, storage = getDefaultStorage()) {
  if (!storage) {
    throw new Error("O navegador não disponibilizou armazenamento persistente.");
  }

  const normalized = validateStoredState(state);
  if (!normalized) {
    throw new Error("O estado do Private Asset Pack é inválido.");
  }

  storage.setItem(PRIVATE_ASSET_STORAGE_KEY, JSON.stringify(normalized));
  resetCache();
  return clone(normalized);
}

export function installPrivateAssetPack(pack, storage = getDefaultStorage()) {
  const normalizedPack = validatePrivateAssetPack(pack);
  const previous = readPrivateAssetState(storage);
  const bindings =
    previous?.pack?.id === normalizedPack.id
      ? normalizeBindings(previous.bindings, normalizedPack)
      : {};

  return writePrivateAssetState(
    {
      version: PRIVATE_ASSET_STATE_VERSION,
      pack: normalizedPack,
      bindings,
    },
    storage,
  );
}

export function savePrivateAssetBindings(bindings, storage = getDefaultStorage()) {
  const state = readPrivateAssetState(storage);
  if (!state) {
    throw new Error("Configure o Private Asset Pack antes de vincular os assets.");
  }

  return writePrivateAssetState(
    {
      ...state,
      bindings: {
        ...state.bindings,
        ...normalizeBindings(bindings, state.pack),
      },
    },
    storage,
  );
}

export function clearPrivateAssetPack(storage = getDefaultStorage()) {
  if (storage) {
    storage.removeItem(PRIVATE_ASSET_STORAGE_KEY);
  }
  resetCache();
}

function addAlias(aliasMap, ambiguousAliases, alias, assetId) {
  for (const candidate of getAssetAliasCandidates(alias)) {
    for (const key of [candidate, candidate.toLowerCase()]) {
      if (ambiguousAliases.has(key)) {
        continue;
      }
      const current = aliasMap.get(key);
      if (current && current !== assetId) {
        aliasMap.delete(key);
        ambiguousAliases.add(key);
      } else {
        aliasMap.set(key, assetId);
      }
    }
  }
}

export function createAssetResolver(pack = null, bindings = {}) {
  const normalizedPack = pack ? validatePrivateAssetPack(pack) : null;
  const normalizedBindings = normalizedPack ? normalizeBindings(bindings, normalizedPack) : {};
  const aliasMap = new Map();
  const ambiguousAliases = new Set();

  if (normalizedPack) {
    for (const assetId of Object.keys(normalizedPack.assets)) {
      addAlias(aliasMap, ambiguousAliases, assetId, assetId);
      addAlias(aliasMap, ambiguousAliases, `asset:${assetId}`, assetId);
    }
    for (const [alias, assetId] of Object.entries(normalizedPack.aliases)) {
      addAlias(aliasMap, ambiguousAliases, alias, assetId);
    }
  }

  function getCanonicalId(reference) {
    if (!normalizedPack || typeof reference !== "string" || !reference.trim()) {
      return null;
    }

    if (normalizedPack.assets[reference]) {
      return reference;
    }

    for (const candidate of getAssetAliasCandidates(reference)) {
      const exact = aliasMap.get(candidate);
      if (exact) {
        return exact;
      }
      const insensitive = aliasMap.get(candidate.toLowerCase());
      if (insensitive) {
        return insensitive;
      }
    }
    return null;
  }

  function resolve(reference) {
    const isObjectReference = isRecord(reference);
    const rawReference = isObjectReference
      ? reference.assetId || reference.path || reference.url || ""
      : reference;
    const assetId = getCanonicalId(rawReference);

    if (!assetId) {
      return {
        canonicalId: null,
        resolved: false,
        value: reference,
      };
    }

    const asset = normalizedPack.assets[assetId];
    const binding = normalizedBindings[assetId];
    if (!binding) {
      return {
        canonicalId: assetId,
        resolved: false,
        value: isObjectReference
          ? { ...reference, assetId }
          : reference,
      };
    }

    if (!isObjectReference) {
      return {
        canonicalId: assetId,
        resolved: true,
        value: binding.url,
      };
    }

    const value = {
      ...reference,
      assetId,
      url: binding.url,
      width: binding.width || reference.width || asset.width,
      height: binding.height || reference.height || asset.height,
      mime: binding.mime || reference.mime || asset.mime,
    };
    delete value.path;

    return {
      canonicalId: assetId,
      resolved: true,
      value,
    };
  }

  return {
    pack: normalizedPack,
    bindings: normalizedBindings,
    getCanonicalId,
    isReady(reference) {
      const assetId = getCanonicalId(
        isRecord(reference)
          ? reference.assetId || reference.path || reference.url || ""
          : reference,
      );
      return Boolean(assetId && normalizedBindings[assetId]);
    },
    resolve,
  };
}

export function getConfiguredAssetResolver(storage = getDefaultStorage()) {
  const state = readPrivateAssetState(storage);
  if (!state) {
    return createAssetResolver();
  }

  if (storage === cachedStorage && cachedResolver) {
    return cachedResolver;
  }

  const resolver = createAssetResolver(state.pack, state.bindings);
  if (storage === cachedStorage) {
    cachedResolver = resolver;
  }
  return resolver;
}

export function getConfiguredPrivateAssetPack(storage = getDefaultStorage()) {
  return readPrivateAssetState(storage)?.pack || null;
}

export function getPrivateAssetPackStatus(storage = getDefaultStorage()) {
  const state = readPrivateAssetState(storage);
  const total = state ? Object.keys(state.pack.assets).length : 0;
  const linked = state ? Object.keys(state.bindings).length : 0;
  return {
    configured: Boolean(state),
    id: state?.pack.id || "",
    name: state?.pack.name || "",
    runtimeSize: state?.pack.runtimeSize || 0,
    total,
    linked,
    missing: Math.max(0, total - linked),
  };
}

export function resolveConfiguredAsset(reference, storage = getDefaultStorage()) {
  return getConfiguredAssetResolver(storage).resolve(reference);
}

export function resolveAssetReferences(value, options = {}) {
  const resolver = options.resolver || getConfiguredAssetResolver(options.storage);
  const stats = {
    canonical: new Set(),
    resolved: new Set(),
    unresolved: new Set(),
  };

  function visit(entry) {
    if (Array.isArray(entry)) {
      return entry.map(visit);
    }

    if (!isRecord(entry)) {
      if (typeof entry === "string") {
        const result = resolver.resolve(entry);
        if (result.canonicalId) {
          stats.canonical.add(result.canonicalId);
          (result.resolved ? stats.resolved : stats.unresolved).add(result.canonicalId);
          return result.value;
        }
      }
      return entry;
    }

    const result = resolver.resolve(entry);
    if (result.canonicalId) {
      stats.canonical.add(result.canonicalId);
      (result.resolved ? stats.resolved : stats.unresolved).add(result.canonicalId);
      return result.value;
    }

    return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, visit(child)]));
  }

  const resolvedValue = visit(value);
  return {
    value: resolvedValue,
    canonical: stats.canonical.size,
    resolved: stats.resolved.size,
    unresolved: stats.unresolved.size,
    unresolvedIds: [...stats.unresolved],
  };
}
