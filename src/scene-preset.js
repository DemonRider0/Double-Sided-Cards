import {
  DECK_METADATA_KEY,
  EXTENSION_ID,
  METADATA_KEY,
} from "./card-data.js";
import {
  COLOR_TOKEN_KEY,
  PLAYER_COLORS,
  SELECTION_BOARD_KEY,
} from "./selection-board.js";
import {
  createAssetResolver,
  getConfiguredAssetResolver,
  getConfiguredPrivateAssetPack,
  resolveAssetReferences,
} from "./asset-resolver.js";

const PRESET_VERSION = 1;
const ITEM_CHUNK_SIZE = 80;
const RESTORE_MARKER_VERSION = 1;
export const SCENE_RESTORE_MARKER_KEY = `${EXTENSION_ID}/scene-restore`;
export const SCENE_BOOTSTRAP_MARKER_KEY = `${EXTENSION_ID}/scene-bootstrap`;

function describeUnavailablePrivateAssets(count) {
  return `${count} ${count === 1 ? "asset privado não está acessível" : "assets privados não estão acessíveis"}`;
}

export const SCENE_PRESETS = [
  {
    id: "tutorial",
    name: "Tutorial",
    restoreLabel: "Restaurar o Tutorial",
  },
  {
    id: "missao-0-5",
    name: "Missao 0.5 (nao oficial)",
    label: "Missão 0.5 (não oficial)",
    restoreLabel: "Restaurar a Missão 0.5 (não oficial)",
  },
];
const READONLY_UPDATE_KEYS = new Set([
  "id",
  "type",
  "createdUserId",
  "lastModified",
  "lastModifiedUserId",
]);
let activeRestorePromise = null;

class SceneRestoreError extends Error {
  constructor(
    message,
    { code = "RESTORE_FAILED", stage = "unknown", partial = false, cause } = {},
  ) {
    super(message);
    this.name = "SceneRestoreError";
    this.code = code;
    this.stage = stage;
    this.partial = partial;
    this.cause = cause;
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function chunk(values, size = ITEM_CHUNK_SIZE) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }

  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key]),
    )
  );
}

function getRestorableItemState(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => !READONLY_UPDATE_KEYS.has(key)),
  );
}

function itemMatchesTarget(item, target) {
  return Boolean(
    item &&
      target &&
      item.id === target.id &&
      item.type === target.type &&
      valuesEqual(getRestorableItemState(item), getRestorableItemState(target)),
  );
}

function assertSerializable(value, path = "preset", ancestors = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} possui um número não finito.`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new Error(`${path} possui um valor não serializável.`);
  }

  if (ancestors.has(value)) {
    throw new Error(`${path} possui uma referência circular.`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} precisa usar apenas objetos comuns.`);
  }

  if (Object.getOwnPropertySymbols(value).length) {
    throw new Error(`${path} possui chaves não serializáveis.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new Error(`${path}[${index}] está ausente.`);
        }
        assertSerializable(value[index], `${path}[${index}]`, ancestors);
      }
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      if (key === "__proto__") {
        throw new Error(`${path} possui uma chave que pode alterar prototipos.`);
      }

      assertSerializable(entry, `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function isPublicRuntime() {
  const hostname = globalThis.location?.hostname;
  return hostname !== "localhost" && hostname !== "127.0.0.1";
}

function isForbiddenLocalReference(value) {
  const text = String(value || "").trim();
  if (/^[a-z]:[\\/]/i.test(text) || /^file:/i.test(text)) {
    return true;
  }

  try {
    const url = new URL(text);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function validatePublicReferences(value, path = "preset", key = "") {
  if (typeof value === "string") {
    if (isForbiddenLocalReference(value)) {
      throw new Error(`${path} aponta para um endereço local.`);
    }

    if (key.toLowerCase() === "url" && !/^https?:\/\//i.test(value)) {
      throw new Error(`${path} não possui uma URL pública válida.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validatePublicReferences(entry, `${path}[${index}]`));
    return;
  }

  if (isRecord(value)) {
    for (const [entryKey, entryValue] of Object.entries(value)) {
      validatePublicReferences(entryValue, `${path}.${entryKey}`, entryKey);
    }
  }
}

function validatePresetBoardIntegrity(preset, itemIds) {
  const board = preset.metadata[SELECTION_BOARD_KEY];
  if (!board) {
    return;
  }

  if (!isRecord(board)) {
    throw new Error("A metadata de seleção do mapa é inválida.");
  }

  for (const categories of Object.values(board.assigned || {})) {
    if (!isRecord(categories)) {
      continue;
    }

    for (const itemId of Object.values(categories)) {
      if (itemId && !itemIds.has(itemId)) {
        throw new Error(`O slot do mapa aponta para um item ausente: ${itemId}.`);
      }
    }
  }

  const explicitColors = new Set();
  for (const item of preset.items) {
    const colorMetadata = item.metadata?.[COLOR_TOKEN_KEY];
    if (isRecord(colorMetadata) && typeof colorMetadata.color === "string") {
      explicitColors.add(colorMetadata.color);
    }
  }

  for (const color of PLAYER_COLORS) {
    if (!explicitColors.has(color.id)) {
      throw new Error(`O mapa não possui identificador explícito para ${color.label}.`);
    }
  }
}

function validateOptionalSceneEnvironment(value) {
  if (value.grid !== undefined) {
    const grid = value.grid;
    if (
      !isRecord(grid) ||
      !Number.isFinite(grid.dpi) ||
      grid.dpi <= 0 ||
      typeof grid.scale !== "string" ||
      !grid.scale.trim() ||
      typeof grid.color !== "string" ||
      !grid.color.trim() ||
      !Number.isFinite(grid.opacity) ||
      grid.opacity < 0 ||
      grid.opacity > 1 ||
      !new Set(["SOLID", "DASHED", "DOTTED"]).has(grid.lineType) ||
      !new Set(["CHEBYSHEV", "ALTERNATING", "EUCLIDEAN", "MANHATTAN"]).has(
        grid.measurement,
      ) ||
      !new Set(["SQUARE", "HEX_VERTICAL", "HEX_HORIZONTAL", "DIMETRIC", "ISOMETRIC"]).has(
        grid.type,
      )
    ) {
      throw new Error("O grid capturado do mapa é inválido.");
    }
  }
  if (value.fog !== undefined) {
    const fog = value.fog;
    if (
      !isRecord(fog) ||
      typeof fog.filled !== "boolean" ||
      typeof fog.color !== "string" ||
      !fog.color.trim() ||
      !Number.isFinite(fog.strokeWidth) ||
      fog.strokeWidth < 0
    ) {
      throw new Error("A fog capturada do mapa é inválida.");
    }
  }
}

function validateCardAndDeckMetadata(item) {
  for (const [key, value] of Object.entries(item.metadata || {})) {
    const isCardOrDeck =
      key === METADATA_KEY ||
      key === DECK_METADATA_KEY ||
      key.endsWith("/card") ||
      key.endsWith("/deck");
    if (isCardOrDeck && !isRecord(value)) {
      throw new Error(`O item ${item.id} possui metadata de carta ou pilha inválida.`);
    }
  }
}

export function validateScenePreset(
  value,
  { publicMode = isPublicRuntime() } = {},
) {
  try {
    assertSerializable(value);
  } catch (error) {
    throw new SceneRestoreError("O mapa salvo possui dados não serializáveis.", {
      code: "INVALID_PRESET",
      stage: "validation",
      cause: error,
    });
  }

  if (
    !isRecord(value) ||
    value.version !== PRESET_VERSION ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    !isRecord(value.metadata)
  ) {
    throw new SceneRestoreError("O mapa salvo possui uma estrutura inválida.", {
      code: "INVALID_PRESET",
      stage: "validation",
    });
  }

  if (Object.prototype.hasOwnProperty.call(value.metadata, SCENE_RESTORE_MARKER_KEY)) {
    throw new SceneRestoreError("O mapa salvo contém metadata interna de restauração.", {
      code: "INVALID_PRESET",
      stage: "validation",
    });
  }

  if (
    value.itemCount !== undefined &&
    (!Number.isInteger(value.itemCount) || value.itemCount !== value.items.length)
  ) {
    throw new SceneRestoreError("A contagem do mapa salvo não corresponde aos itens.", {
      code: "INVALID_PRESET",
      stage: "validation",
    });
  }

  const ids = new Set();
  for (const [index, item] of value.items.entries()) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) {
      throw new SceneRestoreError(`O item ${index + 1} do mapa não possui ID válido.`, {
        code: "INVALID_PRESET",
        stage: "validation",
      });
    }
    if (ids.has(item.id)) {
      throw new SceneRestoreError(`O mapa salvo possui ID duplicado: ${item.id}.`, {
        code: "DUPLICATE_PRESET_ID",
        stage: "validation",
      });
    }
    if (typeof item.type !== "string" || !item.type.trim() || !isRecord(item.metadata)) {
      throw new SceneRestoreError(`O item ${item.id} possui estrutura inválida.`, {
        code: "INVALID_PRESET",
        stage: "validation",
      });
    }

    ids.add(item.id);
    validateCardAndDeckMetadata(item);
  }

  try {
    validateOptionalSceneEnvironment(value);
    validatePresetBoardIntegrity(value, ids);
    if (publicMode) {
      validatePublicReferences(value);
    }
  } catch (error) {
    throw new SceneRestoreError(error.message || "O mapa salvo não passou pela validação.", {
      code: "INVALID_PRESET",
      stage: "validation",
      cause: error,
    });
  }

  return clone(value);
}

function getScenePresetDefinition(presetId) {
  const definition = SCENE_PRESETS.find((preset) => preset.id === presetId);

  if (!definition) {
    throw new Error("Mapa salvo desconhecido.");
  }

  return definition;
}

function createDefaultBoardPreset(
  items,
  metadata,
  definition = SCENE_PRESETS[0],
  environment = {},
) {
  const presetMetadata = clone(metadata || {});
  delete presetMetadata[SCENE_RESTORE_MARKER_KEY];

  return {
    version: PRESET_VERSION,
    id: definition.id,
    name: definition.name,
    savedAt: new Date().toISOString(),
    itemCount: items.length,
    items: clone(items),
    metadata: presetMetadata,
    ...(environment.grid ? { grid: clone(environment.grid) } : {}),
    ...(environment.fog ? { fog: clone(environment.fog) } : {}),
  };
}

async function captureApiGroup(entries) {
  if (entries.some(([, method]) => typeof method !== "function")) {
    return null;
  }
  try {
    const values = await Promise.all(entries.map(([, method]) => method()));
    return Object.fromEntries(entries.map(([key], index) => [key, values[index]]));
  } catch (error) {
    console.warn("[scene-preset] Não foi possível capturar parte de grid/fog.", error);
    return null;
  }
}

export async function captureSceneEnvironment(OBR) {
  const [gridValues, fog] = await Promise.all([
    captureApiGroup([
      ["dpi", OBR?.scene?.grid?.getDpi?.bind(OBR.scene.grid)],
      ["scale", OBR?.scene?.grid?.getScale?.bind(OBR.scene.grid)],
      ["color", OBR?.scene?.grid?.getColor?.bind(OBR.scene.grid)],
      ["opacity", OBR?.scene?.grid?.getOpacity?.bind(OBR.scene.grid)],
      ["lineType", OBR?.scene?.grid?.getLineType?.bind(OBR.scene.grid)],
      ["measurement", OBR?.scene?.grid?.getMeasurement?.bind(OBR.scene.grid)],
      ["type", OBR?.scene?.grid?.getType?.bind(OBR.scene.grid)],
    ]),
    captureApiGroup([
      ["filled", OBR?.scene?.fog?.getFilled?.bind(OBR.scene.fog)],
      ["color", OBR?.scene?.fog?.getColor?.bind(OBR.scene.fog)],
      ["strokeWidth", OBR?.scene?.fog?.getStrokeWidth?.bind(OBR.scene.fog)],
    ]),
  ]);
  const grid = gridValues
    ? {
        ...gridValues,
        scale:
          typeof gridValues.scale === "string"
            ? gridValues.scale
            : gridValues.scale?.raw,
      }
    : null;
  return {
    ...(grid && typeof grid.scale === "string" ? { grid } : {}),
    ...(fog ? { fog } : {}),
  };
}

function addSceneBootstrapMarker(items, metadata) {
  const selectionBoard = metadata?.[SELECTION_BOARD_KEY];
  if (!selectionBoard || !items.length) {
    return items;
  }
  const markedItems = clone(items);
  markedItems[0].metadata = {
    ...(markedItems[0].metadata || {}),
    [SCENE_BOOTSTRAP_MARKER_KEY]: {
      version: 1,
      completed: false,
      selectionBoard: clone(selectionBoard),
    },
  };
  return markedItems;
}

function applySceneEnvironment(builder, preset) {
  const grid = preset.grid;
  const fog = preset.fog;
  if (grid) {
    if (typeof grid.scale === "string") builder.gridScale(grid.scale);
    if (typeof grid.color === "string") builder.gridColor(grid.color);
    if (Number.isFinite(grid.opacity)) builder.gridOpacity(grid.opacity);
    if (typeof grid.lineType === "string") builder.gridLineType(grid.lineType);
    if (typeof grid.measurement === "string") builder.gridMeasurement(grid.measurement);
    if (typeof grid.type === "string") builder.gridType(grid.type);
  }
  if (fog) {
    if (typeof fog.filled === "boolean") builder.fogFilled(fog.filled);
    if (typeof fog.color === "string") builder.fogColor(fog.color);
    if (Number.isFinite(fog.strokeWidth)) builder.fogStrokeWidth(fog.strokeWidth);
  }
  const upload = builder.build();
  if (grid && Number.isFinite(grid.dpi) && grid.dpi > 0) {
    // O SDK 3.1.0 tipa SceneUpload.grid.dpi, mas o builder não expõe um setter para DPI.
    upload.grid.dpi = grid.dpi;
  }
  return upload;
}

export function buildPrivateSceneUpload(buildSceneUpload, preset, options = {}) {
  if (typeof buildSceneUpload !== "function") {
    throw new Error("O construtor de SceneUpload do Owlbear não está disponível.");
  }
  const resolution = resolveAssetReferences(preset, options);
  if (resolution.unresolved) {
    const error = new Error(
      `A cena não pode ser criada: ${describeUnavailablePrivateAssets(resolution.unresolved)} como vínculo no Owlbear. Vincule manualmente antes de tentar novamente.`,
    );
    error.name = "MissingPrivateAssetBindingsError";
    error.missingBindings = resolution.unresolved;
    error.missingAssetIds = resolution.unresolvedIds;
    throw error;
  }
  const normalized = validateScenePreset(resolution.value, { publicMode: true });
  const items = addSceneBootstrapMarker(normalized.items, normalized.metadata);
  const builder = buildSceneUpload().name(normalized.name).items(items);
  const upload = applySceneEnvironment(builder, normalized);
  return {
    upload,
    itemCount: items.length,
    idsPreserved: items.every((item, index) => item.id === normalized.items[index].id),
    usedCapturedGrid: Boolean(normalized.grid),
    usedCapturedFog: Boolean(normalized.fog),
  };
}

export async function createPrivateScene(OBR, buildSceneUpload, preset, options = {}) {
  if (!OBR?.assets?.uploadScenes) {
    throw new Error("A API de criação de cenas do Owlbear não está disponível.");
  }
  const result = buildPrivateSceneUpload(buildSceneUpload, preset, options);
  await OBR.assets.uploadScenes([result.upload]);
  return result;
}

export async function bootstrapPrivateSceneMetadata(OBR) {
  if (!OBR?.scene?.items?.getItems || !OBR?.scene?.setMetadata) {
    return { found: false, applied: false };
  }
  const items = await OBR.scene.items.getItems();
  const markerItem = items.find((item) => {
    const marker = item.metadata?.[SCENE_BOOTSTRAP_MARKER_KEY];
    return isRecord(marker) && marker.version === 1 && marker.completed !== true;
  });
  const marker = markerItem?.metadata?.[SCENE_BOOTSTRAP_MARKER_KEY];
  if (!markerItem || !isRecord(marker?.selectionBoard)) {
    return { found: false, applied: false };
  }

  const currentMetadata = await OBR.scene.getMetadata();
  const alreadyApplied = valuesEqual(
    currentMetadata?.[SELECTION_BOARD_KEY],
    marker.selectionBoard,
  );
  if (!alreadyApplied) {
    await OBR.scene.setMetadata({
      [SELECTION_BOARD_KEY]: clone(marker.selectionBoard),
    });
  }
  await OBR.scene.items.updateItems([markerItem.id], (draftItems) => {
    const draft = draftItems[0];
    const currentMarker = draft?.metadata?.[SCENE_BOOTSTRAP_MARKER_KEY];
    if (!draft || !isRecord(currentMarker) || currentMarker.completed === true) {
      return;
    }
    draft.metadata[SCENE_BOOTSTRAP_MARKER_KEY] = {
      version: 1,
      completed: true,
    };
  });
  return { found: true, applied: !alreadyApplied };
}

function restoreItemState(item, presetItem) {
  for (const key of Object.keys(item)) {
    if (!READONLY_UPDATE_KEYS.has(key) && !(key in presetItem)) {
      delete item[key];
    }
  }

  for (const [key, value] of Object.entries(presetItem)) {
    if (!READONLY_UPDATE_KEYS.has(key)) {
      item[key] = clone(value);
    }
  }
}

export async function loadScenePreset(
  definition,
  pack,
  options = {},
) {
  const configuredPack = pack === undefined ? getConfiguredPrivateAssetPack() : pack;
  const resolver =
    options.resolver ||
    (pack === undefined ? getConfiguredAssetResolver() : createAssetResolver(configuredPack));
  const entry = configuredPack?.presets?.scenes?.[definition.id];
  if (!entry?.preset) {
    return null;
  }

  try {
    const resolution = resolveAssetReferences(entry.preset, { resolver });
    if (resolution.unresolved) {
      throw new Error(
        `${describeUnavailablePrivateAssets(resolution.unresolved)} como vínculo no Owlbear.`,
      );
    }
    const normalized = {
      ...resolution.value,
      id: resolution.value.id || definition.id,
      name: resolution.value.name || definition.name,
    };
    return validateScenePreset(normalized);
  } catch (error) {
    console.error(`[scene-preset] Preset invalido em ${definition.id}.`, error);
    return null;
  }
}

export async function loadScenePresetEntries(pack, options = {}) {
  const configuredPack = pack === undefined ? getConfiguredPrivateAssetPack() : pack;
  const resolver =
    options.resolver ||
    (pack === undefined ? getConfiguredAssetResolver() : createAssetResolver(configuredPack));

  return SCENE_PRESETS.map((fallbackDefinition) => {
    const entry = configuredPack?.presets?.scenes?.[fallbackDefinition.id];
    const definition = entry?.definition
      ? { ...fallbackDefinition, ...entry.definition, id: fallbackDefinition.id }
      : fallbackDefinition;
    const resolution = entry?.preset
      ? resolveAssetReferences(entry.preset, { resolver })
      : null;
    const summary = entry?.summary;
    const validSummary = Boolean(
      typeof summary?.savedAt === "string" &&
        Number.isInteger(summary?.itemCount) &&
        summary.itemCount > 0,
    );
    return {
      definition,
      loadError: null,
      ready: Boolean(entry?.preset && !resolution?.unresolved),
      unresolvedAssetIds: resolution?.unresolvedIds || [],
      summary: validSummary
        ? {
            savedAt: summary.savedAt,
            itemCount: summary.itemCount,
          }
        : null,
      preset: entry?.preset || null,
    };
  });
}

export async function loadDefaultBoardPreset() {
  return loadScenePreset(SCENE_PRESETS[0]);
}

export async function saveScenePreset(OBR, presetId) {
  const definition = getScenePresetDefinition(presetId);
  const [items, metadata, environment] = await Promise.all([
    OBR.scene.items.getItems(),
    OBR.scene.getMetadata(),
    captureSceneEnvironment(OBR),
  ]);
  const preset = createDefaultBoardPreset(items, metadata, definition, environment);
  const response = await fetch(`./__scene_preset?id=${encodeURIComponent(definition.id)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preset),
  });

  if (!response.ok) {
    throw new Error(
      "Não consegui criar o mapa salvo. Essa ação precisa do servidor localhost.",
    );
  }

  return response.json();
}

export async function saveDefaultBoardPreset(OBR) {
  return saveScenePreset(OBR, SCENE_PRESETS[0].id);
}

function createOperationToken() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRestoreMarker(value) {
  return Boolean(
    isRecord(value) &&
      value.version === RESTORE_MARKER_VERSION &&
      typeof value.token === "string" &&
      value.token &&
      typeof value.playerId === "string" &&
      value.playerId &&
      typeof value.presetId === "string" &&
      value.presetId &&
      typeof value.startedAt === "string" &&
      value.startedAt,
  );
}

async function getRestoreIdentity(OBR) {
  const [playerId, connectionId] = await Promise.all([
    OBR.player.getId(),
    OBR.player.getConnectionId().catch(() => ""),
  ]);

  if (!playerId) {
    throw new SceneRestoreError("Não consegui identificar o jogador atual.", {
      code: "PLAYER_UNAVAILABLE",
      stage: "marker",
    });
  }

  return { playerId, connectionId: connectionId || "" };
}

async function classifyExistingMarker(OBR, marker, { includeLocalLock = true } = {}) {
  if (!marker) {
    return includeLocalLock && activeRestorePromise
      ? { state: "local", marker: null }
      : { state: "free", marker: null };
  }

  if (!isRestoreMarker(marker)) {
    return { state: "orphan", marker };
  }

  const identity = await getRestoreIdentity(OBR);
  if (
    marker.playerId === identity.playerId &&
    marker.connectionId === identity.connectionId
  ) {
    return includeLocalLock && activeRestorePromise
      ? { state: "active", marker, owner: "current" }
      : { state: "orphan", marker, owner: "current" };
  }

  let players;
  try {
    players = await OBR.party.getPlayers();
  } catch (error) {
    console.error("[scene-preset] Falha ao verificar o proprietario do marcador.", error);
    return { state: "active", marker, owner: "unknown" };
  }

  const ownerIsConnected = players.some(
    (player) =>
      player.id === marker.playerId &&
      (!marker.connectionId || player.connectionId === marker.connectionId),
  );
  return ownerIsConnected
    ? { state: "active", marker, owner: "party" }
    : { state: "orphan", marker };
}

export async function getSceneRestoreStatus(OBR) {
  if (activeRestorePromise) {
    return { state: "local", marker: null };
  }

  const metadata = await OBR.scene.getMetadata();
  return classifyExistingMarker(OBR, metadata[SCENE_RESTORE_MARKER_KEY]);
}

async function acquireRestoreMarker(OBR, operation, allowOrphanRecovery) {
  const metadata = await OBR.scene.getMetadata();
  const existing = metadata[SCENE_RESTORE_MARKER_KEY];
  const status = await classifyExistingMarker(OBR, existing, { includeLocalLock: false });

  if (status.state === "active") {
    throw new SceneRestoreError("Já existe uma restauração em andamento nesta cena.", {
      code: "RESTORE_ACTIVE",
      stage: "marker",
    });
  }
  if (status.state === "orphan" && !allowOrphanRecovery) {
    throw new SceneRestoreError(
      "Existe uma restauração interrompida. Confirme a recuperação antes de continuar.",
      {
        code: "ORPHAN_RESTORE",
        stage: "marker",
      },
    );
  }

  const marker = {
    version: RESTORE_MARKER_VERSION,
    token: operation.token,
    playerId: operation.playerId,
    connectionId: operation.connectionId,
    presetId: operation.presetId,
    startedAt: operation.startedAt,
    phase: "preparing",
  };

  await OBR.scene.setMetadata({
    [SCENE_RESTORE_MARKER_KEY]: marker,
  });
  const observed = (await OBR.scene.getMetadata())[SCENE_RESTORE_MARKER_KEY];
  if (!isRestoreMarker(observed) || observed.token !== operation.token) {
    throw new SceneRestoreError("Outra restauração assumiu a cena.", {
      code: "RESTORE_CONFLICT",
      stage: "marker",
    });
  }

  operation.phase = marker.phase;
}

async function requireRestoreOwnership(OBR, operation) {
  const marker = (await OBR.scene.getMetadata())[SCENE_RESTORE_MARKER_KEY];
  if (!isRestoreMarker(marker) || marker.token !== operation.token) {
    throw new SceneRestoreError("A restauração perdeu o controle da cena.", {
      code: "RESTORE_MARKER_LOST",
      stage: operation.phase,
      partial: true,
    });
  }
  return marker;
}

async function setRestorePhase(OBR, operation, phase) {
  const marker = await requireRestoreOwnership(OBR, operation);
  await OBR.scene.setMetadata({
    [SCENE_RESTORE_MARKER_KEY]: {
      ...marker,
      phase,
    },
  });
  operation.phase = phase;
  const observed = await requireRestoreOwnership(OBR, operation);
  if (observed.phase !== phase) {
    throw new SceneRestoreError("Não consegui confirmar a fase da restauração.", {
      code: "RESTORE_MARKER_UPDATE_FAILED",
      stage: phase,
      partial: true,
    });
  }
}

async function releaseRestoreMarker(OBR, operation) {
  const marker = (await OBR.scene.getMetadata())[SCENE_RESTORE_MARKER_KEY];
  if (!isRestoreMarker(marker) || marker.token !== operation.token) {
    return false;
  }

  await OBR.scene.setMetadata({
    [SCENE_RESTORE_MARKER_KEY]: null,
  });
  const observed = (await OBR.scene.getMetadata())[SCENE_RESTORE_MARKER_KEY];
  return !observed;
}

function createRestorationPlan(preset, currentItems, currentMetadata) {
  try {
    assertSerializable(currentItems, "itens atuais");
    assertSerializable(currentMetadata, "metadata atual");
  } catch (error) {
    throw stageError(
      "A cena atual possui dados que não podem ser restaurados com segurança.",
      "INVALID_CURRENT_SCENE",
      "planning",
      error,
      false,
    );
  }

  const targetItems = clone(preset.items);
  const currentItemCopies = clone(currentItems);
  const currentIds = new Set();
  for (const item of currentItemCopies) {
    if (!item?.id || currentIds.has(item.id)) {
      throw stageError(
        "A cena atual possui IDs ausentes ou duplicados.",
        "INVALID_CURRENT_SCENE",
        "planning",
        null,
        false,
      );
    }
    currentIds.add(item.id);
  }

  const targetById = new Map(targetItems.map((item) => [item.id, item]));
  const currentById = new Map(currentItemCopies.map((item) => [item.id, item]));
  const updates = [];
  const additions = [];
  const replacements = [];
  const deletions = [];

  for (const target of targetItems) {
    const current = currentById.get(target.id);
    if (!current) {
      additions.push(target);
    } else if (current.type !== target.type) {
      replacements.push({ before: current, target });
    } else if (!itemMatchesTarget(current, target)) {
      updates.push({ before: current, target });
    }
  }

  for (const current of currentItemCopies) {
    if (!targetById.has(current.id)) {
      deletions.push(current);
    }
  }

  const targetMetadata = clone(preset.metadata);
  const metadataBefore = {};
  for (const key of Object.keys(targetMetadata)) {
    metadataBefore[key] = {
      exists: Object.prototype.hasOwnProperty.call(currentMetadata, key),
      value: Object.prototype.hasOwnProperty.call(currentMetadata, key)
        ? clone(currentMetadata[key])
        : null,
    };
  }

  const plan = {
    presetId: preset.id,
    targetItems,
    targetMetadata,
    updates,
    additions,
    replacements,
    deletions,
    metadataBefore,
  };
  assertSerializable(plan, "plano");
  return plan;
}

function createJournal(plan) {
  return {
    added: [],
    updated: [],
    replacements: plan.replacements.map((entry) => ({
      before: entry.before,
      target: entry.target,
      deleted: false,
      added: false,
    })),
    deleted: [],
    metadataKeys: [],
  };
}

function journalHasMutations(journal) {
  return Boolean(
    journal.added.length ||
      journal.updated.length ||
      journal.replacements.some((entry) => entry.deleted || entry.added) ||
      journal.deleted.length ||
      journal.metadataKeys.length,
  );
}

function recordById(values, value) {
  const valueId = value.id || value.target?.id;
  if (!valueId || !values.some((entry) => (entry.id || entry.target?.id) === valueId)) {
    values.push(value);
  }
}

async function getItemsByIds(OBR, ids) {
  return ids.length ? OBR.scene.items.getItems(ids) : [];
}

function mapItems(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function stageError(message, code, stage, cause, partial = true) {
  return new SceneRestoreError(message, {
    code,
    stage,
    cause,
    partial,
  });
}

async function applyAdditions(OBR, operation, entries, journal) {
  if (!entries.length) {
    return;
  }

  await setRestorePhase(OBR, operation, "adding");
  for (const targets of chunk(entries)) {
    await requireRestoreOwnership(OBR, operation);
    const before = mapItems(await getItemsByIds(OBR, targets.map((item) => item.id)));
    const missing = [];

    for (const target of targets) {
      const current = before.get(target.id);
      if (!current) {
        missing.push(target);
      } else if (!itemMatchesTarget(current, target)) {
        throw stageError(
          `O item ${target.id} apareceu com outro estado durante a restauração.`,
          "ADD_CONFLICT",
          "adding",
          null,
          journalHasMutations(journal),
        );
      }
    }

    if (!missing.length) {
      continue;
    }

    let addError = null;
    try {
      await OBR.scene.items.addItems(clone(missing));
    } catch (error) {
      addError = error;
      console.error("[scene-preset] Falha ao adicionar itens do mapa.", error);
    }

    let after;
    try {
      after = mapItems(await getItemsByIds(OBR, missing.map((item) => item.id)));
    } catch (error) {
      for (const target of missing) {
        recordById(journal.added, target);
      }
      console.error("[scene-preset] Falha ao confirmar itens adicionados.", error);
      throw stageError(
        "Falha ao confirmar os itens adicionados.",
        "ADD_OBSERVE_FAILED",
        "adding",
        error,
      );
    }
    for (const target of missing) {
      if (itemMatchesTarget(after.get(target.id), target)) {
        recordById(journal.added, target);
      }
    }

    if (addError) {
      throw stageError(
        "Falha ao adicionar itens do mapa.",
        "ADD_FAILED",
        "adding",
        addError,
      );
    }
    if (missing.some((target) => !itemMatchesTarget(after.get(target.id), target))) {
      throw stageError(
        "Nem todos os itens adicionados foram confirmados.",
        "ADD_VERIFY_FAILED",
        "adding",
      );
    }
  }
}

async function applyUpdates(OBR, operation, entries, journal) {
  if (!entries.length) {
    return;
  }

  await setRestorePhase(OBR, operation, "updating");
  for (const group of chunk(entries)) {
    await requireRestoreOwnership(OBR, operation);
    const ids = group.map((entry) => entry.target.id);
    const currentItems = await getItemsByIds(OBR, ids);
    const currentById = mapItems(currentItems);

    for (const entry of group) {
      if (!valuesEqual(currentById.get(entry.before.id), entry.before)) {
        throw stageError(
          `O item ${entry.before.id} mudou durante a restauração.`,
          "UPDATE_CONFLICT",
          "updating",
          null,
          journalHasMutations(journal),
        );
      }
    }

    let updateError = null;
    try {
      await OBR.scene.items.updateItems(currentItems, (draftItems) => {
        for (const item of draftItems) {
          const target = group.find((entry) => entry.target.id === item.id)?.target;
          if (target) {
            restoreItemState(item, target);
          }
        }
      });
    } catch (error) {
      updateError = error;
      console.error("[scene-preset] Falha ao atualizar itens do mapa.", error);
    }

    let after;
    try {
      after = mapItems(await getItemsByIds(OBR, ids));
    } catch (error) {
      for (const entry of group) {
        recordById(journal.updated, entry);
      }
      console.error("[scene-preset] Falha ao confirmar itens atualizados.", error);
      throw stageError(
        "Falha ao confirmar os itens atualizados.",
        "UPDATE_OBSERVE_FAILED",
        "updating",
        error,
      );
    }
    for (const entry of group) {
      if (itemMatchesTarget(after.get(entry.target.id), entry.target)) {
        recordById(journal.updated, entry);
      }
    }

    if (updateError) {
      throw stageError(
        "Falha ao atualizar itens do mapa.",
        "UPDATE_FAILED",
        "updating",
        updateError,
      );
    }
    if (group.some((entry) => !itemMatchesTarget(after.get(entry.target.id), entry.target))) {
      throw stageError(
        "Nem todos os itens atualizados foram confirmados.",
        "UPDATE_VERIFY_FAILED",
        "updating",
      );
    }
  }
}

async function applyReplacements(OBR, operation, entries, journal) {
  if (!entries.length) {
    return;
  }

  await setRestorePhase(OBR, operation, "replacing");
  for (const group of chunk(entries)) {
    await requireRestoreOwnership(OBR, operation);
    const ids = group.map((entry) => entry.target.id);
    const currentById = mapItems(await getItemsByIds(OBR, ids));

    for (const entry of group) {
      if (!valuesEqual(currentById.get(entry.before.id), entry.before)) {
        throw stageError(
          `O item ${entry.before.id} mudou antes de ser substituido.`,
          "REPLACE_CONFLICT",
          "replacing",
          null,
          journalHasMutations(journal),
        );
      }
    }

    let deleteError = null;
    try {
      await OBR.scene.items.deleteItems(ids);
    } catch (error) {
      deleteError = error;
      console.error("[scene-preset] Falha ao remover itens incompativeis.", error);
    }

    let afterDelete;
    try {
      afterDelete = mapItems(await getItemsByIds(OBR, ids));
    } catch (error) {
      for (const entry of group) {
        const journalEntry = journal.replacements.find(
          (candidate) => candidate.target.id === entry.target.id,
        );
        journalEntry.deleted = true;
      }
      console.error("[scene-preset] Falha ao confirmar itens removidos.", error);
      throw stageError(
        "Falha ao confirmar os itens removidos.",
        "REPLACE_DELETE_OBSERVE_FAILED",
        "replacing",
        error,
      );
    }
    for (const entry of group) {
      if (!afterDelete.has(entry.before.id)) {
        const journalEntry = journal.replacements.find(
          (candidate) => candidate.target.id === entry.target.id,
        );
        journalEntry.deleted = true;
      }
    }

    if (deleteError) {
      throw stageError(
        "Falha ao remover itens incompativeis.",
        "REPLACE_DELETE_FAILED",
        "replacing",
        deleteError,
      );
    }
    if (afterDelete.size) {
      throw stageError(
        "Nem todos os itens incompativeis foram removidos.",
        "REPLACE_DELETE_VERIFY_FAILED",
        "replacing",
      );
    }

    await requireRestoreOwnership(OBR, operation);
    let addError = null;
    try {
      await OBR.scene.items.addItems(clone(group.map((entry) => entry.target)));
    } catch (error) {
      addError = error;
      console.error("[scene-preset] Falha ao recriar itens incompativeis.", error);
    }

    let afterAdd;
    try {
      afterAdd = mapItems(await getItemsByIds(OBR, ids));
    } catch (error) {
      for (const entry of group) {
        const journalEntry = journal.replacements.find(
          (candidate) => candidate.target.id === entry.target.id,
        );
        journalEntry.added = true;
      }
      console.error("[scene-preset] Falha ao confirmar itens recriados.", error);
      throw stageError(
        "Falha ao confirmar os itens recriados.",
        "REPLACE_ADD_OBSERVE_FAILED",
        "replacing",
        error,
      );
    }
    for (const entry of group) {
      if (itemMatchesTarget(afterAdd.get(entry.target.id), entry.target)) {
        const journalEntry = journal.replacements.find(
          (candidate) => candidate.target.id === entry.target.id,
        );
        journalEntry.added = true;
      }
    }

    if (addError) {
      throw stageError(
        "Falha ao recriar itens incompativeis.",
        "REPLACE_ADD_FAILED",
        "replacing",
        addError,
      );
    }
    if (group.some((entry) => !itemMatchesTarget(afterAdd.get(entry.target.id), entry.target))) {
      throw stageError(
        "Nem todos os itens recriados foram confirmados.",
        "REPLACE_ADD_VERIFY_FAILED",
        "replacing",
      );
    }
  }
}

async function applyTargetMetadata(OBR, operation, plan, journal) {
  const targetEntries = Object.entries(plan.targetMetadata);
  if (!targetEntries.length) {
    return;
  }

  await setRestorePhase(OBR, operation, "metadata");
  await requireRestoreOwnership(OBR, operation);
  let metadataError = null;
  try {
    await OBR.scene.setMetadata(clone(plan.targetMetadata));
  } catch (error) {
    metadataError = error;
    console.error("[scene-preset] Falha ao atualizar metadata da cena.", error);
  }

  let after;
  try {
    after = await OBR.scene.getMetadata();
  } catch (error) {
    journal.metadataKeys.push(
      ...Object.keys(plan.targetMetadata).filter(
        (key) => !journal.metadataKeys.includes(key),
      ),
    );
    console.error("[scene-preset] Falha ao confirmar metadata da cena.", error);
    throw stageError(
      "Falha ao confirmar a metadata da cena.",
      "METADATA_OBSERVE_FAILED",
      "metadata",
      error,
    );
  }
  for (const [key, target] of targetEntries) {
    if (valuesEqual(after[key], target)) {
      journal.metadataKeys.push(key);
    }
  }

  if (metadataError) {
    throw stageError(
      "Falha ao atualizar metadata da cena.",
      "METADATA_FAILED",
      "metadata",
      metadataError,
    );
  }
  if (targetEntries.some(([key, target]) => !valuesEqual(after[key], target))) {
    throw stageError(
      "A metadata da cena não foi confirmada.",
      "METADATA_VERIFY_FAILED",
      "metadata",
    );
  }
}

async function applyDeletions(OBR, operation, entries, journal) {
  if (!entries.length) {
    return;
  }

  await setRestorePhase(OBR, operation, "deleting");
  for (const targets of chunk(entries)) {
    await requireRestoreOwnership(OBR, operation);
    const ids = targets.map((item) => item.id);
    const currentById = mapItems(await getItemsByIds(OBR, ids));
    const existing = [];

    for (const target of targets) {
      const current = currentById.get(target.id);
      if (!current) {
        continue;
      }
      if (!valuesEqual(current, target)) {
        throw stageError(
          `O item extra ${target.id} mudou durante a restauração.`,
          "DELETE_CONFLICT",
          "deleting",
          null,
          journalHasMutations(journal),
        );
      }
      existing.push(target);
    }

    if (!existing.length) {
      continue;
    }

    let deleteError = null;
    try {
      await OBR.scene.items.deleteItems(existing.map((item) => item.id));
    } catch (error) {
      deleteError = error;
      console.error("[scene-preset] Falha ao remover itens extras.", error);
    }

    let after;
    try {
      after = mapItems(
        await getItemsByIds(OBR, existing.map((item) => item.id)),
      );
    } catch (error) {
      for (const target of existing) {
        recordById(journal.deleted, target);
      }
      console.error("[scene-preset] Falha ao confirmar itens extras removidos.", error);
      throw stageError(
        "Falha ao confirmar os itens extras removidos.",
        "DELETE_OBSERVE_FAILED",
        "deleting",
        error,
      );
    }
    for (const target of existing) {
      if (!after.has(target.id)) {
        recordById(journal.deleted, target);
      }
    }

    if (deleteError) {
      throw stageError(
        "Falha ao remover itens extras.",
        "DELETE_FAILED",
        "deleting",
        deleteError,
      );
    }
    if (after.size) {
      throw stageError(
        "Nem todos os itens extras foram removidos.",
        "DELETE_VERIFY_FAILED",
        "deleting",
      );
    }
  }
}

function verifySelectionBoardResult(metadata, items) {
  const board = metadata[SELECTION_BOARD_KEY];
  if (!isRecord(board)) {
    return;
  }

  const ids = new Set(items.map((item) => item.id));
  for (const categories of Object.values(board.assigned || {})) {
    if (!isRecord(categories)) {
      continue;
    }
    for (const itemId of Object.values(categories)) {
      if (itemId && !ids.has(itemId)) {
        throw new Error(`Um slot aponta para o item ausente ${itemId}.`);
      }
    }
  }

  const colors = new Set(
    items
      .map((item) => item.metadata?.[COLOR_TOKEN_KEY]?.color)
      .filter((color) => typeof color === "string"),
  );
  for (const color of PLAYER_COLORS) {
    if (!colors.has(color.id)) {
      throw new Error(`O identificador ${color.label} não foi restaurado.`);
    }
  }
}

async function verifyRestoration(OBR, operation, plan) {
  await setRestorePhase(OBR, operation, "verifying");
  const [items, metadata] = await Promise.all([
    OBR.scene.items.getItems(),
    OBR.scene.getMetadata(),
  ]);
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw stageError(
      "A cena restaurada possui IDs duplicados.",
      "FINAL_VERIFY_FAILED",
      "verifying",
    );
  }
  if (items.length !== plan.targetItems.length) {
    throw stageError(
      "A quantidade final de itens não corresponde ao mapa salvo.",
      "FINAL_VERIFY_FAILED",
      "verifying",
    );
  }

  const currentById = mapItems(items);
  for (const target of plan.targetItems) {
    if (!itemMatchesTarget(currentById.get(target.id), target)) {
      throw stageError(
        `O item ${target.id} não corresponde ao mapa salvo.`,
        "FINAL_VERIFY_FAILED",
        "verifying",
      );
    }
  }

  for (const [key, target] of Object.entries(plan.targetMetadata)) {
    if (!valuesEqual(metadata[key], target)) {
      throw stageError(
        `A metadata ${key} não corresponde ao mapa salvo.`,
        "FINAL_VERIFY_FAILED",
        "verifying",
      );
    }
  }

  try {
    verifySelectionBoardResult(metadata, items);
  } catch (error) {
    throw stageError(
      error.message,
      "FINAL_VERIFY_FAILED",
      "verifying",
      error,
    );
  }

  await requireRestoreOwnership(OBR, operation);
}

async function rollbackRestoration(OBR, operation, plan, journal) {
  const errors = [];
  const fail = (label, error) => {
    errors.push({ label, error });
    console.error(`[scene-preset] Rollback: ${label}.`, error);
  };

  try {
    await setRestorePhase(OBR, operation, "rolling-back");
  } catch (error) {
    fail("marcador indisponível; rollback recusado", error);
    return { complete: false, refused: true, errors };
  }

  const addedTargets = [
    ...journal.added,
    ...journal.replacements.filter((entry) => entry.added).map((entry) => entry.target),
  ];
  for (const targets of chunk(addedTargets)) {
    try {
      await requireRestoreOwnership(OBR, operation);
      const currentById = mapItems(await getItemsByIds(OBR, targets.map((item) => item.id)));
      const safeIds = [];
      for (const target of targets) {
        const current = currentById.get(target.id);
        if (!current) {
          continue;
        }
        if (!itemMatchesTarget(current, target)) {
          throw new Error(`O item ${target.id} foi alterado depois da restauração.`);
        }
        safeIds.push(target.id);
      }
      if (safeIds.length) {
        await OBR.scene.items.deleteItems(safeIds);
        const remaining = await getItemsByIds(OBR, safeIds);
        if (remaining.length) {
          throw new Error("Alguns itens adicionados permaneceram na cena.");
        }
      }
    } catch (error) {
      fail("não foi possível remover itens adicionados", error);
    }
  }

  const deletedOriginals = [
    ...journal.deleted,
    ...journal.replacements.filter((entry) => entry.deleted).map((entry) => entry.before),
  ];
  for (const targets of chunk(deletedOriginals)) {
    try {
      await requireRestoreOwnership(OBR, operation);
      const currentById = mapItems(await getItemsByIds(OBR, targets.map((item) => item.id)));
      const missing = [];
      for (const target of targets) {
        const current = currentById.get(target.id);
        if (!current) {
          missing.push(target);
        } else if (!valuesEqual(current, target)) {
          throw new Error(`O ID ${target.id} agora pertence a outro estado.`);
        }
      }
      if (missing.length) {
        await OBR.scene.items.addItems(clone(missing));
        const restored = mapItems(await getItemsByIds(OBR, missing.map((item) => item.id)));
        if (missing.some((item) => !itemMatchesTarget(restored.get(item.id), item))) {
          throw new Error("Alguns itens apagados não foram restaurados.");
        }
      }
    } catch (error) {
      fail("não foi possível readicionar itens apagados", error);
    }
  }

  for (const entries of chunk(journal.updated)) {
    try {
      await requireRestoreOwnership(OBR, operation);
      const ids = entries.map((entry) => entry.target.id);
      const currentItems = await getItemsByIds(OBR, ids);
      const currentById = mapItems(currentItems);
      const toRestore = [];
      for (const entry of entries) {
        const current = currentById.get(entry.target.id);
        if (valuesEqual(current, entry.before)) {
          continue;
        }
        if (!itemMatchesTarget(current, entry.target)) {
          throw new Error(`O item ${entry.target.id} mudou depois da atualização.`);
        }
        toRestore.push(current);
      }
      if (toRestore.length) {
        await OBR.scene.items.updateItems(toRestore, (draftItems) => {
          for (const item of draftItems) {
            const before = entries.find((entry) => entry.before.id === item.id)?.before;
            if (before) {
              restoreItemState(item, before);
            }
          }
        });
        const restored = mapItems(await getItemsByIds(OBR, ids));
        if (
          entries.some(
            (entry) => !itemMatchesTarget(restored.get(entry.before.id), entry.before),
          )
        ) {
          throw new Error("Alguns itens atualizados não voltaram ao estado anterior.");
        }
      }
    } catch (error) {
      fail("não foi possível restaurar itens atualizados", error);
    }
  }

  if (journal.metadataKeys.length) {
    try {
      await requireRestoreOwnership(OBR, operation);
      const currentMetadata = await OBR.scene.getMetadata();
      const patch = {};
      for (const key of journal.metadataKeys) {
        const target = plan.targetMetadata[key];
        const previous = plan.metadataBefore[key];
        if (valuesEqual(currentMetadata[key], previous.exists ? previous.value : undefined)) {
          continue;
        }
        if (!valuesEqual(currentMetadata[key], target)) {
          throw new Error(`A metadata ${key} mudou depois da restauração.`);
        }
        patch[key] = previous.exists ? clone(previous.value) : null;
      }
      if (Object.keys(patch).length) {
        await OBR.scene.setMetadata(patch);
        const restoredMetadata = await OBR.scene.getMetadata();
        for (const [key, value] of Object.entries(patch)) {
          const previous = plan.metadataBefore[key];
          const restored = previous.exists
            ? valuesEqual(restoredMetadata[key], value)
            : !Object.prototype.hasOwnProperty.call(restoredMetadata, key) ||
              restoredMetadata[key] === null;
          if (!restored) {
            throw new Error(`A metadata ${key} não voltou ao estado anterior.`);
          }
        }
      }
    } catch (error) {
      fail("não foi possível restaurar metadata", error);
    }
  }

  if (errors.length) {
    try {
      await setRestorePhase(OBR, operation, "recovery-required");
    } catch (error) {
      fail("não foi possível manter o marcador de recuperação", error);
    }
    return { complete: false, refused: false, errors };
  }

  try {
    const released = await releaseRestoreMarker(OBR, operation);
    if (!released) {
      throw new Error("O marcador não pertence mais a esta operação.");
    }
  } catch (error) {
    fail("não foi possível limpar o marcador", error);
    return { complete: false, refused: false, errors };
  }

  console.info("[scene-preset] Rollback concluido.");
  return { complete: true, refused: false, errors: [] };
}

async function performRestore(OBR, preset, options, operation) {
  const resolution = resolveAssetReferences(preset);
  if (resolution.unresolved) {
    throw new SceneRestoreError(
      `${describeUnavailablePrivateAssets(resolution.unresolved)} como vínculo no Owlbear. Vincule manualmente antes de restaurar a cena.`,
      {
        code: "PRIVATE_ASSETS_NOT_LINKED",
        stage: "validation",
      },
    );
  }
  const validatedPreset = validateScenePreset(resolution.value, {
    publicMode: options.publicMode ?? isPublicRuntime(),
  });
  let markerAcquired = false;
  let plan = null;
  let journal = null;
  let verified = false;

  try {
    await acquireRestoreMarker(OBR, operation, Boolean(options.allowOrphanRecovery));
    markerAcquired = true;

    const [currentItems, currentMetadata] = await Promise.all([
      OBR.scene.items.getItems(),
      OBR.scene.getMetadata(),
    ]);
    plan = createRestorationPlan(validatedPreset, currentItems, currentMetadata);
    journal = createJournal(plan);

    await applyAdditions(OBR, operation, plan.additions, journal);
    await applyUpdates(OBR, operation, plan.updates, journal);
    await applyReplacements(OBR, operation, plan.replacements, journal);
    await applyTargetMetadata(OBR, operation, plan, journal);
    await applyDeletions(OBR, operation, plan.deletions, journal);
    await verifyRestoration(OBR, operation, plan);
    verified = true;

    const released = await releaseRestoreMarker(OBR, operation);
    if (!released) {
      throw stageError(
        "O mapa foi restaurado, mas o controle da operação mudou antes da limpeza.",
        "MARKER_RELEASE_FAILED",
        "completed",
        null,
        true,
      );
    }

    return {
      added: plan.additions.length + plan.replacements.length,
      deleted: plan.deletions.length + plan.replacements.length,
      updated: plan.updates.length,
    };
  } catch (error) {
    console.error(
      `[scene-preset] Restauracao falhou na fase ${error.stage || operation.phase}.`,
      error,
    );

    if (verified) {
      throw error;
    }

    if (!markerAcquired) {
      throw error;
    }

    if (!journal || !journalHasMutations(journal)) {
      try {
        await releaseRestoreMarker(OBR, operation);
      } catch (releaseError) {
        console.error("[scene-preset] Falha ao limpar marcador sem mutacoes.", releaseError);
      }
      throw error;
    }

    if (error.code === "RESTORE_MARKER_LOST") {
      throw new SceneRestoreError(
        "A restauração foi interrompida por outra operação. Confira a cena antes de tentar novamente.",
        {
          code: error.code,
          stage: error.stage,
          partial: true,
          cause: error,
        },
      );
    }

    console.warn("[scene-preset] Iniciando rollback condicional.");
    const rollback = await rollbackRestoration(OBR, operation, plan, journal);
    if (rollback.complete) {
      throw new SceneRestoreError(
        "Não consegui restaurar o mapa; as mudanças seguras foram desfeitas.",
        {
          code: error.code,
          stage: error.stage,
          partial: false,
          cause: error,
        },
      );
    }

    throw new SceneRestoreError(
      "A restauração falhou parcialmente. Confira a cena antes de tentar novamente.",
      {
        code: error.code,
        stage: error.stage,
        partial: true,
        cause: error,
      },
    );
  }
}

export async function restoreDefaultBoardPreset(OBR, preset, options = {}) {
  if (activeRestorePromise) {
    throw new SceneRestoreError("Uma restauração já está em andamento neste painel.", {
      code: "LOCAL_RESTORE_ACTIVE",
      stage: "local-lock",
    });
  }

  const operationPromise = (async () => {
    const identity = await getRestoreIdentity(OBR);
    const operation = {
      token: createOperationToken(),
      playerId: identity.playerId,
      connectionId: identity.connectionId,
      presetId: preset?.id || "unknown",
      startedAt: new Date().toISOString(),
      phase: "preparing",
    };
    return performRestore(OBR, preset, options, operation);
  })();

  activeRestorePromise = operationPromise;
  try {
    return await operationPromise;
  } finally {
    if (activeRestorePromise === operationPromise) {
      activeRestorePromise = null;
    }
  }
}
