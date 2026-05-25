const PRESET_VERSION = 1;
const ITEM_CHUNK_SIZE = 80;
export const SCENE_PRESETS = [
  {
    id: "tutorial",
    name: "Tutorial",
    restoreLabel: "Restaurar o Tutorial",
    url: "./assets/scene-presets/tutorial.json",
  },
  {
    id: "missao-0-5",
    name: "Missao 0.5 (nao oficial)",
    restoreLabel: "Restaurar a Missao 0.5 (nao oficial)",
    url: "./assets/scene-presets/missao-0-5.json",
  },
];
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

function getScenePresetDefinition(presetId) {
  const definition = SCENE_PRESETS.find((preset) => preset.id === presetId);

  if (!definition) {
    throw new Error("Mapa salvo desconhecido.");
  }

  return definition;
}

function createDefaultBoardPreset(items, metadata, definition = SCENE_PRESETS[0]) {
  return {
    version: PRESET_VERSION,
    id: definition.id,
    name: definition.name,
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

export async function loadScenePreset(definition) {
  const response = await fetch(`${definition.url}?v=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const preset = await response.json();
  return isDefaultBoardPreset(preset)
    ? {
        ...preset,
        id: preset.id || definition.id,
        name: preset.name || definition.name,
      }
    : null;
}

export async function loadScenePresetEntries() {
  return Promise.all(
    SCENE_PRESETS.map(async (definition) => ({
      definition,
      preset: await loadScenePreset(definition),
    })),
  );
}

export async function loadDefaultBoardPreset() {
  return loadScenePreset(SCENE_PRESETS[0]);
}

export async function saveScenePreset(OBR, presetId) {
  const definition = getScenePresetDefinition(presetId);
  const [items, metadata] = await Promise.all([
    OBR.scene.items.getItems(),
    OBR.scene.getMetadata(),
  ]);
  const preset = createDefaultBoardPreset(items, metadata, definition);
  const response = await fetch(`./__scene_preset?id=${encodeURIComponent(definition.id)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preset),
  });

  if (!response.ok) {
    throw new Error(
      "Nao consegui criar o mapa salvo. Essa acao precisa do servidor localhost.",
    );
  }

  return response.json();
}

export async function saveDefaultBoardPreset(OBR) {
  return saveScenePreset(OBR, SCENE_PRESETS[0].id);
}

export async function restoreDefaultBoardPreset(OBR, preset) {
  if (!isDefaultBoardPreset(preset)) {
    throw new Error("Nenhum mapa salvo foi cadastrado na extensao.");
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
