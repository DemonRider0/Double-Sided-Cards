import { EXTENSION_ID } from "./card-data.js";

export const COLOR_TOKEN_KEY = `${EXTENSION_ID}/color-token`;
export const CARD_CATEGORY_KEY = `${EXTENSION_ID}/card-category`;
export const ACTIVE_COLOR_KEY = `${EXTENSION_ID}/active-color`;
export const SELECTION_BOARD_KEY = `${EXTENSION_ID}/selection-board`;

export const PLAYER_COLORS = [
  { id: "red", label: "Vermelho", aliases: ["vermelho", "red"] },
  { id: "white", label: "Branco", aliases: ["branco", "white"] },
  { id: "green", label: "Verde", aliases: ["verde", "green"] },
  { id: "blue", label: "Azul", aliases: ["azul", "blue"] },
];

export const CARD_CATEGORIES = [
  { id: "race", label: "Raca" },
  { id: "class", label: "Classe" },
  { id: "divinity", label: "Divindade" },
];

const PLAYER_COLOR_IDS = new Set(PLAYER_COLORS.map((color) => color.id));
const CATEGORY_IDS = new Set(CARD_CATEGORIES.map((category) => category.id));

export function getColorLabel(colorId) {
  return PLAYER_COLORS.find((color) => color.id === colorId)?.label || "cor";
}

export function getCategoryLabel(categoryId) {
  return CARD_CATEGORIES.find((category) => category.id === categoryId)?.label || "categoria";
}

export function normalizePlayerColor(colorId) {
  return PLAYER_COLOR_IDS.has(colorId) ? colorId : null;
}

export function normalizeCategory(categoryId) {
  return CATEGORY_IDS.has(categoryId) ? categoryId : null;
}

function createEmptyState() {
  const slots = {};
  const assigned = {};
  const tokens = {};

  for (const color of PLAYER_COLORS) {
    slots[color.id] = {};
    assigned[color.id] = {};
    tokens[color.id] = null;
  }

  return {
    version: 1,
    slots,
    assigned,
    origins: {},
    tokens,
  };
}

function normalizeState(value) {
  const state = createEmptyState();

  if (!value || typeof value !== "object") {
    return state;
  }

  for (const color of PLAYER_COLORS) {
    state.slots[color.id] = {
      ...state.slots[color.id],
      ...(value.slots?.[color.id] || {}),
    };
    state.assigned[color.id] = {
      ...state.assigned[color.id],
      ...(value.assigned?.[color.id] || {}),
    };
    state.tokens[color.id] = value.tokens?.[color.id] || null;
  }

  state.origins = value.origins && typeof value.origins === "object" ? value.origins : {};
  return state;
}

async function getSceneState(OBR) {
  const metadata = await OBR.scene.getMetadata();
  return normalizeState(metadata[SELECTION_BOARD_KEY]);
}

async function setSceneState(OBR, state) {
  await OBR.scene.setMetadata({
    [SELECTION_BOARD_KEY]: state,
  });
}

function capturePlacement(item) {
  return {
    position: { ...item.position },
    rotation: item.rotation,
    scale: { ...item.scale },
    layer: item.layer,
    zIndex: item.zIndex,
    locked: item.locked,
  };
}

function getTopZIndex(placement) {
  return Math.max(Date.now(), Number.isFinite(placement?.zIndex) ? placement.zIndex + 1 : 0);
}

function applyPlacement(item, placement, options = {}) {
  item.position = { ...placement.position };
  item.rotation = placement.rotation;
  item.scale = { ...placement.scale };
  item.layer = placement.layer;

  if (Number.isFinite(options.zIndex)) {
    item.zIndex = options.zIndex;
  } else if (Number.isFinite(placement.zIndex)) {
    item.zIndex = placement.zIndex;
  }
}

async function getSelectedItems(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();
  const itemIds = selection?.length ? selection : fallbackSelection;

  if (!itemIds.length) {
    return [];
  }

  return OBR.scene.items.getItems(itemIds);
}

function getPrimaryImage(items) {
  return items.find((item) => item.type === "IMAGE") || null;
}

async function getSelectedImage(OBR, fallbackSelection = []) {
  const item = getPrimaryImage(await getSelectedItems(OBR, fallbackSelection));

  if (!item) {
    throw new Error("Selecione uma imagem na cena.");
  }

  return item;
}

async function safeGetItems(OBR, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];

  if (!uniqueIds.length) {
    return [];
  }

  const itemResults = await Promise.all(
    uniqueIds.map((id) =>
      OBR.scene.items
        .getItems([id])
        .then((items) => items[0] || null)
        .catch(() => null),
    ),
  );

  return itemResults.filter(Boolean);
}

function colorFromText(text) {
  const normalized = (text || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  for (const color of PLAYER_COLORS) {
    if (color.aliases.some((alias) => normalized.includes(alias))) {
      return color.id;
    }
  }

  return null;
}

export function detectPlayerColorFromItem(item) {
  const metadataColor = normalizePlayerColor(item.metadata?.[COLOR_TOKEN_KEY]?.color);

  if (metadataColor) {
    return metadataColor;
  }

  return colorFromText(
    [
      item.name,
      item.description,
      item.text?.plainText,
      item.image?.url,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function detectCardCategoryFromItem(item) {
  return normalizeCategory(item.metadata?.[CARD_CATEGORY_KEY]?.category);
}

export async function getActivePlayerColor(OBR) {
  const metadata = await OBR.player.getMetadata();
  return normalizePlayerColor(metadata[ACTIVE_COLOR_KEY]?.color);
}

async function getCurrentPlayerId(OBR) {
  try {
    return await OBR.player.getId();
  } catch {
    return OBR.player.id;
  }
}

async function getPlayerUsingColor(OBR, color) {
  if (!OBR.party?.getPlayers) {
    return null;
  }

  const [currentPlayerId, players] = await Promise.all([
    getCurrentPlayerId(OBR),
    OBR.party.getPlayers(),
  ]);

  return (
    players.find(
      (player) =>
        player.id !== currentPlayerId &&
        normalizePlayerColor(player.metadata?.[ACTIVE_COLOR_KEY]?.color) === color,
    ) || null
  );
}

export async function setActivePlayerColor(OBR, colorId) {
  const color = normalizePlayerColor(colorId);

  if (!color) {
    throw new Error("Escolha uma cor valida.");
  }

  const claimedBy = await getPlayerUsingColor(OBR, color);

  if (claimedBy) {
    throw new Error(
      `${getColorLabel(color)} ja esta em uso por ${claimedBy.name || "outro jogador"}.`,
    );
  }

  await OBR.player.setMetadata({
    [ACTIVE_COLOR_KEY]: {
      version: 1,
      color,
    },
  });

  return color;
}

export async function markSelectedTokenColor(OBR, colorId, fallbackSelection = []) {
  const color = normalizePlayerColor(colorId);

  if (!color) {
    throw new Error("Escolha uma cor valida.");
  }

  const item = await getSelectedImage(OBR, fallbackSelection);
  const state = await getSceneState(OBR);

  await OBR.scene.items.updateItems([item], (items) => {
    items[0].metadata ||= {};
    items[0].metadata[COLOR_TOKEN_KEY] = {
      version: 1,
      color,
    };
  });

  state.tokens[color] = item.id;
  await setSceneState(OBR, state);
  await setActivePlayerColor(OBR, color);

  return color;
}

export async function markSelectedCardsCategory(OBR, categoryId, fallbackSelection = []) {
  const category = normalizeCategory(categoryId);

  if (!category) {
    throw new Error("Escolha uma categoria valida.");
  }

  const items = (await getSelectedItems(OBR, fallbackSelection)).filter(
    (item) => item.type === "IMAGE",
  );

  if (!items.length) {
    throw new Error("Selecione uma ou mais cartas na cena.");
  }

  const state = await getSceneState(OBR);

  for (const item of items) {
    if (!isAssignedItem(state, item.id)) {
      state.origins[item.id] = capturePlacement(item);
    }
  }

  await OBR.scene.items.updateItems(items, (draftItems) => {
    for (const item of draftItems) {
      item.metadata ||= {};
      item.metadata[CARD_CATEGORY_KEY] = {
        version: 1,
        category,
      };
    }
  });
  await setSceneState(OBR, state);

  return { category, count: items.length };
}

export async function saveSlotFromSelectedItem(
  OBR,
  colorId,
  categoryId,
  fallbackSelection = [],
) {
  const color = normalizePlayerColor(colorId);
  const category = normalizeCategory(categoryId);

  if (!color || !category) {
    throw new Error("Escolha uma cor e uma categoria para salvar o slot.");
  }

  const item = await getSelectedImage(OBR, fallbackSelection);
  const state = await getSceneState(OBR);

  state.slots[color][category] = capturePlacement(item);
  await setSceneState(OBR, state);

  return { color, category };
}

function clearAssignmentsForItem(state, itemId) {
  for (const color of PLAYER_COLORS) {
    for (const category of CARD_CATEGORIES) {
      if (state.assigned[color.id][category.id] === itemId) {
        state.assigned[color.id][category.id] = null;
      }
    }
  }
}

function isAssignedItem(state, itemId) {
  return PLAYER_COLORS.some((color) =>
    CARD_CATEGORIES.some((category) => state.assigned[color.id][category.id] === itemId),
  );
}

export async function placeSelectedCardInCategory(OBR, categoryId, fallbackSelection = []) {
  const category = normalizeCategory(categoryId);

  if (!category) {
    throw new Error("Escolha uma categoria valida.");
  }

  const selectedItem = await getSelectedImage(OBR, fallbackSelection);
  const state = await getSceneState(OBR);
  const selectedWasAssigned = isAssignedItem(state, selectedItem.id);

  if (selectedWasAssigned) {
    return {
      ignored: true,
      category,
    };
  }

  const color = await getActivePlayerColor(OBR);

  if (!color) {
    throw new Error("Escolha uma cor antes de posicionar a carta.");
  }

  const slot = state.slots[color]?.[category];

  if (!slot) {
    throw new Error(
      `Salve primeiro o slot de ${getCategoryLabel(category)} para ${getColorLabel(color)}.`,
    );
  }

  const previousItemId = state.assigned[color]?.[category];
  const items = await safeGetItems(OBR, [selectedItem.id, previousItemId]);
  const previousItem = previousItemId
    ? items.find((item) => item.id === previousItemId)
    : null;

  if (!state.origins[selectedItem.id]) {
    state.origins[selectedItem.id] = capturePlacement(selectedItem);
  }

  clearAssignmentsForItem(state, selectedItem.id);
  state.assigned[color][category] = selectedItem.id;

  if (previousItem && previousItem.id !== selectedItem.id) {
    const origin = state.origins[previousItem.id];

    if (origin) {
      clearAssignmentsForItem(state, previousItem.id);
    }
  }

  await OBR.scene.items.updateItems(items, (draftItems) => {
    for (const item of draftItems) {
      if (item.id === selectedItem.id) {
        applyPlacement(item, slot, { zIndex: getTopZIndex(slot) });
        item.locked = category !== "divinity";
        continue;
      }

      if (previousItem && item.id === previousItem.id) {
        const origin = state.origins[item.id];

        if (origin) {
          applyPlacement(item, origin);
          item.locked = origin.locked;
        } else {
          item.locked = false;
        }
      }
    }
  });

  await setSceneState(OBR, state);

  return {
    color,
    category,
    replaced: Boolean(previousItem && previousItem.id !== selectedItem.id),
  };
}

export async function returnSelectedCardToOrigin(OBR, fallbackSelection = []) {
  const selectedItem = await getSelectedImage(OBR, fallbackSelection);
  const state = await getSceneState(OBR);
  const origin = state.origins[selectedItem.id];

  if (!origin) {
    throw new Error("Nao encontrei a posicao original dessa carta.");
  }

  clearAssignmentsForItem(state, selectedItem.id);

  await OBR.scene.items.updateItems([selectedItem], (items) => {
    applyPlacement(items[0], origin);
    items[0].locked = origin.locked;
  });
  await setSceneState(OBR, state);

  return true;
}
