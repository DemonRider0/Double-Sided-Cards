const PRESET_VERSION = 1;
const ITEM_CHUNK_SIZE = 80;
const DEFAULT_BOARD_PRESET_URL = "./assets/scene-preset.json";
const READONLY_UPDATE_KEYS = new Set([
  "id",
  "type",
  "createdUserId",
  "lastModified",
  "lastModifiedUserId",
]);

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

function isDefaultBoardPreset(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.version === PRESET_VERSION &&
      Array.isArray(value.items) &&
      value.metadata &&
      typeof value.metadata === "object",
  );
}

function createDefaultBoardPreset(items, metadata) {
  return {
    version: PRESET_VERSION,
    savedAt: new Date().toISOString(),
    itemCount: items.length,
    items: clone(items),
    metadata: clone(metadata || {}),
  };
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

export async function loadDefaultBoardPreset() {
  const response = await fetch(`${DEFAULT_BOARD_PRESET_URL}?v=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const preset = await response.json();
  return isDefaultBoardPreset(preset) ? preset : null;
}

export async function saveDefaultBoardPreset(OBR) {
  const [items, metadata] = await Promise.all([
    OBR.scene.items.getItems(),
    OBR.scene.getMetadata(),
  ]);
  const preset = createDefaultBoardPreset(items, metadata);
  const response = await fetch("./__scene_preset", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preset),
  });

  if (!response.ok) {
    throw new Error(
      "Nao consegui criar o tabuleiro padrao. Essa acao precisa do servidor localhost.",
    );
  }

  return response.json();
}

export async function restoreDefaultBoardPreset(OBR, preset) {
  if (!isDefaultBoardPreset(preset)) {
    throw new Error("Nenhum tabuleiro padrao foi cadastrado na extensao.");
  }

  const presetItems = clone(preset.items);
  const currentItems = await OBR.scene.items.getItems();
  const presetById = new Map(presetItems.map((item) => [item.id, item]));
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const itemsToUpdate = currentItems.filter(
    (item) => presetById.has(item.id) && presetById.get(item.id).type === item.type,
  );
  const idsToDelete = currentItems
    .filter((item) => !presetById.has(item.id) || presetById.get(item.id).type !== item.type)
    .map((item) => item.id);
  const itemsToAdd = presetItems.filter(
    (item) => !currentById.has(item.id) || currentById.get(item.id).type !== item.type,
  );

  for (const items of chunk(itemsToUpdate)) {
    await OBR.scene.items.updateItems(items, (draftItems) => {
      for (const item of draftItems) {
        restoreItemState(item, presetById.get(item.id));
      }
    });
  }

  for (const ids of chunk(idsToDelete)) {
    await OBR.scene.items.deleteItems(ids);
  }

  for (const items of chunk(itemsToAdd)) {
    await OBR.scene.items.addItems(items);
  }

  await OBR.scene.setMetadata(clone(preset.metadata || {}));

  return {
    added: itemsToAdd.length,
    deleted: idsToDelete.length,
    updated: itemsToUpdate.length,
  };
}
