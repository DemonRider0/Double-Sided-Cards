import {
  DECK_METADATA_KEY,
  EXTENSION_ID,
  METADATA_KEY,
  getCardMetadata,
  getDeckMetadata,
} from "./card-data.js";

export const COLOR_TOKEN_KEY = `${EXTENSION_ID}/color-token`;
export const CARD_CATEGORY_KEY = `${EXTENSION_ID}/card-category`;
export const ACTIVE_COLOR_KEY = `${EXTENSION_ID}/active-color`;
export const SELECTION_BOARD_KEY = `${EXTENSION_ID}/selection-board`;

export const PLAYER_COLORS = [
  { id: "red", label: "Vermelho", aliases: ["vermelho", "red"], pointerColor: "#ef4444" },
  { id: "white", label: "Branco", aliases: ["branco", "white"], pointerColor: "#f8fafc" },
  { id: "green", label: "Verde", aliases: ["verde", "green"], pointerColor: "#22c55e" },
  { id: "blue", label: "Azul", aliases: ["azul", "blue"], pointerColor: "#3b82f6" },
];

export const CARD_CATEGORIES = [
  { id: "race", label: "Raca" },
  { id: "class", label: "Classe" },
  { id: "divinity", label: "Divindade" },
];

const PLAYER_COLOR_IDS = new Set(PLAYER_COLORS.map((color) => color.id));
const CATEGORY_IDS = new Set(CARD_CATEGORIES.map((category) => category.id));
const selectionOperationTails = new Map();
let playerColorOperationTail = Promise.resolve();

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function copyDefinedRecord(value) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function createVersionedMetadata(existing, field, value) {
  return {
    ...copyDefinedRecord(existing),
    version: 1,
    [field]: value,
  };
}

function sameSerializedValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function slotOperationKey(color, category) {
  return `slot:${color}:${category}`;
}

async function withSelectionOperationLocks(keys, operation) {
  const lockKeys = [...new Set(keys.filter(Boolean))].sort();
  const previousOperations = lockKeys
    .map((key) => selectionOperationTails.get(key))
    .filter(Boolean);
  let releaseOperation;
  const currentOperation = new Promise((resolve) => {
    releaseOperation = resolve;
  });

  for (const key of lockKeys) {
    selectionOperationTails.set(key, currentOperation);
  }

  await Promise.all(previousOperations);

  try {
    return await operation();
  } finally {
    releaseOperation();

    for (const key of lockKeys) {
      if (selectionOperationTails.get(key) === currentOperation) {
        selectionOperationTails.delete(key);
      }
    }
  }
}

function withPlayerColorOperation(operation) {
  const currentOperation = playerColorOperationTail
    .catch(() => {})
    .then(operation);
  playerColorOperationTail = currentOperation.catch(() => {});
  return currentOperation;
}

export function getColorLabel(colorId) {
  return PLAYER_COLORS.find((color) => color.id === colorId)?.label || "cor";
}

function getPointerColor(colorId) {
  return PLAYER_COLORS.find((color) => color.id === colorId)?.pointerColor || null;
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
  const emptyState = createEmptyState();

  if (!isRecord(value)) {
    return emptyState;
  }

  const sourceSlots = copyDefinedRecord(value.slots);
  const sourceAssigned = copyDefinedRecord(value.assigned);
  const sourceOrigins = copyDefinedRecord(value.origins);
  const sourceTokens = copyDefinedRecord(value.tokens);
  const state = {
    ...copyDefinedRecord(value),
    version: Number.isFinite(value.version) ? value.version : 1,
    slots: { ...sourceSlots },
    assigned: { ...sourceAssigned },
    origins: { ...sourceOrigins },
    tokens: { ...sourceTokens },
  };

  for (const color of PLAYER_COLORS) {
    state.slots[color.id] = {
      ...emptyState.slots[color.id],
      ...copyDefinedRecord(sourceSlots[color.id]),
    };
    state.assigned[color.id] = {
      ...emptyState.assigned[color.id],
      ...copyDefinedRecord(sourceAssigned[color.id]),
    };
    state.tokens[color.id] = sourceTokens[color.id] || null;
  }

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

function placementMatches(left, right) {
  return Boolean(
    left &&
      right &&
      left.position?.x === right.position?.x &&
      left.position?.y === right.position?.y &&
      left.rotation === right.rotation &&
      left.scale?.x === right.scale?.x &&
      left.scale?.y === right.scale?.y &&
      left.layer === right.layer &&
      left.zIndex === right.zIndex &&
      left.locked === right.locked,
  );
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

async function getSelectedItemIds(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();
  return Array.isArray(selection) ? selection : fallbackSelection;
}

async function getSelectedItems(OBR, fallbackSelection = []) {
  const itemIds = await getSelectedItemIds(OBR, fallbackSelection);

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

async function getSingleSelectedImage(OBR, fallbackSelection = []) {
  const items = await getSelectedItems(OBR, fallbackSelection);
  const imageItems = items.filter((item) => item.type === "IMAGE");

  if (items.length !== 1 || imageItems.length !== 1) {
    throw new Error("Selecione exatamente uma imagem na cena.");
  }

  return imageItems[0];
}

async function getCurrentSingleSelectedImage(OBR, expectedItemId = null) {
  const itemIds = await getSelectedItemIds(OBR);

  if (
    itemIds.length !== 1 ||
    (expectedItemId && itemIds[0] !== expectedItemId)
  ) {
    throw new Error("Selecione exatamente uma imagem na cena.");
  }

  const items = await OBR.scene.items.getItems([itemIds[0]]);
  const item = items[0];

  if (!item || item.type !== "IMAGE") {
    throw new Error("A imagem selecionada não está mais disponível.");
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

function getAssignmentReferences(state, itemId) {
  const references = [];

  for (const color of PLAYER_COLORS) {
    for (const category of CARD_CATEGORIES) {
      if (state.assigned[color.id]?.[category.id] === itemId) {
        references.push({
          color: color.id,
          category: category.id,
        });
      }
    }
  }

  return references;
}

function clearExactAssignmentReferences(state, itemId, references = null) {
  const exactReferences = references || getAssignmentReferences(state, itemId);
  let cleared = 0;

  for (const reference of exactReferences) {
    if (state.assigned[reference.color]?.[reference.category] === itemId) {
      state.assigned[reference.color][reference.category] = null;
      cleared += 1;
    }
  }

  return cleared;
}

function isAssignedItem(state, itemId) {
  return getAssignmentReferences(state, itemId).length > 0;
}

function getForeignAssignment(references, color) {
  return references.find((reference) => reference.color !== color) || null;
}

function colorFromText(text) {
  const normalized = (text || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  for (const color of PLAYER_COLORS) {
    if (
      color.aliases.some((alias) =>
        new RegExp(`(^|[^a-z0-9])${alias}([^a-z0-9]|$)`, "u").test(normalized),
      )
    ) {
      return color.id;
    }
  }

  return null;
}

function hasCardOrDeckMetadata(item) {
  return Boolean(
    getCardMetadata(item) ||
      getDeckMetadata(item) ||
      item.metadata?.[METADATA_KEY] ||
      item.metadata?.[DECK_METADATA_KEY] ||
      item.metadata?.[CARD_CATEGORY_KEY],
  );
}

export function detectPlayerColorFromItem(item) {
  const metadataColor = normalizePlayerColor(item.metadata?.[COLOR_TOKEN_KEY]?.color);

  if (metadataColor) {
    return metadataColor;
  }

  if (hasCardOrDeckMetadata(item)) {
    return null;
  }

  return colorFromText(
    [
      item.name,
      item.description,
      item.text?.plainText,
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

async function validateSelectedColorToken(OBR, color, selectedTokenId) {
  if (!selectedTokenId) {
    return;
  }

  const selectedItem = await getCurrentSingleSelectedImage(OBR, selectedTokenId);
  const tokenMetadata = selectedItem.metadata?.[COLOR_TOKEN_KEY];
  const explicitColor = normalizePlayerColor(
    tokenMetadata?.color,
  );
  const detectedColor =
    tokenMetadata === undefined
      ? detectPlayerColorFromItem(selectedItem)
      : explicitColor;

  if (detectedColor !== color) {
    console.warn("Identificador de cor invalido ou com metadata parcial", {
      itemId: selectedItem.id,
      requestedColor: color,
      explicitColor,
    });
    throw new Error("O identificador selecionado não possui uma cor válida.");
  }
}

async function restorePreviousPlayerColor(OBR, previousValue) {
  const restoredValue =
    previousValue === undefined ? null : previousValue;
  await OBR.player.setMetadata({
    [ACTIVE_COLOR_KEY]: restoredValue,
  });
}

export async function setActivePlayerColor(OBR, colorId, options = {}) {
  const color = normalizePlayerColor(colorId);

  if (!color) {
    console.warn("Tentativa de selecionar uma cor invalida", { colorId });
    throw new Error("Escolha uma cor válida.");
  }

  return withPlayerColorOperation(async () => {
    await validateSelectedColorToken(OBR, color, options.selectedTokenId);

    const playerMetadata = await OBR.player.getMetadata();
    const previousValue = playerMetadata[ACTIVE_COLOR_KEY];
    const previousColor = normalizePlayerColor(previousValue?.color);
    const claimedBy = await getPlayerUsingColor(OBR, color);

    if (claimedBy) {
      console.warn("Cor ocupada por outro jogador", {
        color,
        claimedBy: claimedBy.id,
      });
      throw new Error(
        `${getColorLabel(color)} já está em uso por ${claimedBy.name || "outro jogador"}.`,
      );
    }

    if (previousColor !== color) {
      await OBR.player.setMetadata({
        [ACTIVE_COLOR_KEY]: createVersionedMetadata(previousValue, "color", color),
      });
    }

    const conflictingPlayer = await getPlayerUsingColor(OBR, color);

    if (conflictingPlayer) {
      console.warn("Conflito de cor detectado apos a gravacao", {
        color,
        conflictingPlayer: conflictingPlayer.id,
      });

      if (previousColor !== color) {
        try {
          await restorePreviousPlayerColor(OBR, previousValue);
        } catch (rollbackError) {
          console.error("Nao consegui restaurar a cor anterior do jogador", rollbackError);
          throw new Error(
            "A cor entrou em conflito e não consegui restaurar o estado anterior.",
          );
        }
      }

      throw new Error(
        `${getColorLabel(color)} foi escolhida ao mesmo tempo por outro jogador. Tente outra cor.`,
      );
    }

    const pointerColor = getPointerColor(color);

    if (pointerColor && typeof OBR.player.setColor === "function") {
      await OBR.player.setColor(pointerColor).catch((error) => {
        console.warn("Nao consegui atualizar a cor do pointer", error);
      });
    }

    return color;
  });
}

export async function markSelectedTokenColor(OBR, colorId, fallbackSelection = []) {
  const color = normalizePlayerColor(colorId);

  if (!color) {
    throw new Error("Escolha uma cor válida.");
  }

  const item = await getSingleSelectedImage(OBR, fallbackSelection);

  await OBR.scene.items.updateItems([item], (items) => {
    items[0].metadata ||= {};
    items[0].metadata[COLOR_TOKEN_KEY] = createVersionedMetadata(
      items[0].metadata[COLOR_TOKEN_KEY],
      "color",
      color,
    );
  });

  const state = await getSceneState(OBR);
  state.tokens[color] = item.id;
  await setSceneState(OBR, state);
  await setActivePlayerColor(OBR, color);

  return color;
}

export async function markSelectedCardsCategory(OBR, categoryId, fallbackSelection = []) {
  const category = normalizeCategory(categoryId);

  if (!category) {
    console.warn("Tentativa de marcar uma categoria invalida", { categoryId });
    throw new Error("Escolha uma categoria válida.");
  }

  const items = (await getSelectedItems(OBR, fallbackSelection)).filter(
    (item) => item.type === "IMAGE",
  );

  if (!items.length) {
    throw new Error("Selecione uma ou mais cartas na cena.");
  }

  const placements = new Map(
    items.map((item) => [item.id, capturePlacement(item)]),
  );

  await OBR.scene.items.updateItems(items, (draftItems) => {
    for (const item of draftItems) {
      item.metadata ||= {};
      item.metadata[CARD_CATEGORY_KEY] = createVersionedMetadata(
        item.metadata[CARD_CATEGORY_KEY],
        "category",
        category,
      );
    }
  });

  const state = await getSceneState(OBR);

  for (const item of items) {
    if (!isAssignedItem(state, item.id) && !state.origins[item.id]) {
      state.origins[item.id] = placements.get(item.id);
    }
  }

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

  const item = await getSingleSelectedImage(OBR, fallbackSelection);
  const state = await getSceneState(OBR);

  state.slots[color][category] = capturePlacement(item);
  await setSceneState(OBR, state);

  return { color, category };
}

async function rollbackSlotReservation(
  OBR,
  color,
  category,
  selectedItemId,
  previousItemId,
) {
  const state = await getSceneState(OBR);

  if (state.assigned[color]?.[category] !== selectedItemId) {
    console.warn("Rollback de slot recusado porque o ocupante mudou", {
      color,
      category,
      selectedItemId,
    });
    return false;
  }

  state.assigned[color][category] = previousItemId || null;
  await setSceneState(OBR, state);
  const verifiedState = await getSceneState(OBR);
  return (verifiedState.assigned[color]?.[category] || null) === (previousItemId || null);
}

async function reconcileSlotItemsAfterFailure(
  OBR,
  {
    color,
    category,
    selectedItemId,
    selectedOrigin,
    selectedDestination,
    previousItemId,
    previousOrigin,
    slot,
  },
) {
  const state = await getSceneState(OBR);
  const selectedReferences = getAssignmentReferences(state, selectedItemId);
  const currentAssignment = state.assigned[color]?.[category] || null;
  const items = await safeGetItems(OBR, [selectedItemId, previousItemId]);
  const selectedItem = items.find((item) => item.id === selectedItemId);

  if (
    selectedItem &&
    selectedReferences.length === 0 &&
    [selectedOrigin, selectedDestination].some((placement) =>
      placementMatches(capturePlacement(selectedItem), placement),
    )
  ) {
    await OBR.scene.items.updateItems([selectedItem], (draftItems) => {
      applyPlacement(draftItems[0], selectedOrigin);
      draftItems[0].locked = selectedOrigin.locked;
    });
  }

  const previousItem = previousItemId
    ? items.find((item) => item.id === previousItemId)
    : null;

  if (
    previousItem &&
    previousOrigin &&
    currentAssignment === previousItemId &&
    placementMatches(capturePlacement(previousItem), previousOrigin)
  ) {
    await OBR.scene.items.updateItems([previousItem], (draftItems) => {
      applyPlacement(draftItems[0], slot, { zIndex: getTopZIndex(slot) });
      draftItems[0].locked = category !== "divinity";
    });
  }
}

async function clearItemAssignmentReferences(OBR, itemId, maxAttempts = 2) {
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const state = await getSceneState(OBR);
    const references = getAssignmentReferences(state, itemId);

    if (!references.length) {
      return 0;
    }

    clearExactAssignmentReferences(state, itemId, references);

    try {
      await setSceneState(OBR, state);
    } catch (error) {
      lastError = error;
      console.warn("Falha ao limpar metadata de slot", {
        itemId,
        attempt: attempt + 1,
        error,
      });
      continue;
    }

    const verifiedState = await getSceneState(OBR);
    const remainingReferences = getAssignmentReferences(verifiedState, itemId);

    if (!remainingReferences.length) {
      return references.length;
    }

    lastError = new Error("A referência de slot reapareceu durante a limpeza.");
  }

  throw lastError || new Error("Não consegui limpar a referência do slot.");
}

export async function placeSelectedCardInCategory(OBR, categoryId, fallbackSelection = []) {
  const category = normalizeCategory(categoryId);

  if (!category) {
    console.warn("Categoria invalida durante o posicionamento", { categoryId });
    throw new Error("Escolha uma categoria válida.");
  }

  const selectedItem = await getSingleSelectedImage(OBR, fallbackSelection);

  if (detectCardCategoryFromItem(selectedItem) !== category) {
    console.warn("A carta selecionada nao corresponde a categoria solicitada", {
      itemId: selectedItem.id,
      category,
    });
    throw new Error("A carta selecionada não possui uma categoria válida.");
  }

  const [initialState, color] = await Promise.all([
    getSceneState(OBR),
    getActivePlayerColor(OBR),
  ]);

  if (!color) {
    console.warn("Jogador sem cor ativa ao posicionar carta", {
      itemId: selectedItem.id,
      category,
    });
    throw new Error("Escolha uma cor antes de posicionar a carta.");
  }

  const initialReferences = getAssignmentReferences(initialState, selectedItem.id);
  const foreignAssignment = getForeignAssignment(initialReferences, color);

  if (foreignAssignment) {
    console.warn("Carta ja pertence ao slot de outra cor", {
      itemId: selectedItem.id,
      ownerColor: foreignAssignment.color,
      requestedColor: color,
    });
    throw new Error("Essa carta já pertence ao espaço de outro jogador.");
  }

  if (initialReferences.length) {
    return {
      ignored: true,
      category,
      color,
    };
  }

  const initialSlot = initialState.slots[color]?.[category];

  if (!initialSlot) {
    throw new Error(
      `Salve primeiro o slot de ${getCategoryLabel(category)} para ${getColorLabel(color)}.`,
    );
  }

  const expectedPreviousItemId = initialState.assigned[color]?.[category] || null;
  const initialPlacement = capturePlacement(selectedItem);
  const lockKeys = [
    `card:${selectedItem.id}`,
    slotOperationKey(color, category),
  ];

  return withSelectionOperationLocks(lockKeys, async () => {
    const [currentItem, currentState, currentColor] = await Promise.all([
      getSingleSelectedImage(OBR, [selectedItem.id]),
      getSceneState(OBR),
      getActivePlayerColor(OBR),
    ]);

    if (currentItem.id !== selectedItem.id) {
      throw new Error("A seleção mudou antes de posicionar a carta.");
    }

    if (currentColor !== color) {
      console.warn("A cor ativa mudou durante o posicionamento", {
        itemId: selectedItem.id,
        expectedColor: color,
        currentColor,
      });
      throw new Error("Sua cor ativa mudou. Selecione a carta novamente.");
    }

    if (detectCardCategoryFromItem(currentItem) !== category) {
      throw new Error("A categoria da carta mudou. Selecione-a novamente.");
    }

    if (!placementMatches(capturePlacement(currentItem), initialPlacement)) {
      console.warn("A carta foi movida antes de ocupar o slot", {
        itemId: selectedItem.id,
      });
      throw new Error("A carta foi alterada por outra ação. Tente novamente.");
    }

    const currentSlot = currentState.slots[color]?.[category];
    const currentPreviousItemId = currentState.assigned[color]?.[category] || null;

    if (
      !sameSerializedValue(currentSlot, initialSlot) ||
      currentPreviousItemId !== expectedPreviousItemId
    ) {
      console.warn("Slot alterado antes do posicionamento", {
        color,
        category,
        expectedPreviousItemId,
        currentPreviousItemId,
      });
      throw new Error("Esse slot foi alterado por outra ação. Tente novamente.");
    }

    const currentReferences = getAssignmentReferences(currentState, currentItem.id);
    const currentForeignAssignment = getForeignAssignment(currentReferences, color);

    if (currentForeignAssignment) {
      throw new Error("Essa carta já pertence ao espaço de outro jogador.");
    }

    if (currentReferences.length) {
      return {
        ignored: true,
        category,
        color,
      };
    }

    const selectedOrigin =
      currentState.origins[currentItem.id] || capturePlacement(currentItem);
    currentState.origins[currentItem.id] ||= selectedOrigin;
    currentState.assigned[color][category] = currentItem.id;

    try {
      await setSceneState(OBR, currentState);
    } catch (error) {
      console.error("Falha ao reservar o slot na metadata da cena", error);
      throw new Error("Não consegui reservar esse slot. Tente novamente.");
    }

    let reservedState = await getSceneState(OBR);
    let reservedReferences = getAssignmentReferences(reservedState, currentItem.id);
    let reservedForeignAssignment = getForeignAssignment(reservedReferences, color);

    if (
      reservedState.assigned[color]?.[category] !== currentItem.id ||
      reservedForeignAssignment
    ) {
      await rollbackSlotReservation(
        OBR,
        color,
        category,
        currentItem.id,
        expectedPreviousItemId,
      ).catch((error) => {
        console.error("Falha no rollback da reserva de slot", error);
      });
      throw new Error("O slot entrou em conflito com outra ação. Tente novamente.");
    }

    let latestItem;
    let latestColor;

    try {
      [latestItem, reservedState, latestColor] = await Promise.all([
        getSingleSelectedImage(OBR, [currentItem.id]),
        getSceneState(OBR),
        getActivePlayerColor(OBR),
      ]);
    } catch (error) {
      await rollbackSlotReservation(
        OBR,
        color,
        category,
        currentItem.id,
        expectedPreviousItemId,
      ).catch((rollbackError) => {
        console.error("Falha no rollback apos mudanca de selecao", rollbackError);
      });
      throw error;
    }

    reservedReferences = getAssignmentReferences(reservedState, currentItem.id);
    reservedForeignAssignment = getForeignAssignment(reservedReferences, color);

    if (
      latestItem.id !== currentItem.id ||
      latestColor !== color ||
      reservedState.assigned[color]?.[category] !== currentItem.id ||
      reservedForeignAssignment ||
      !sameSerializedValue(reservedState.slots[color]?.[category], initialSlot) ||
      detectCardCategoryFromItem(latestItem) !== category ||
      !placementMatches(capturePlacement(latestItem), initialPlacement)
    ) {
      await rollbackSlotReservation(
        OBR,
        color,
        category,
        currentItem.id,
        expectedPreviousItemId,
      ).catch((error) => {
        console.error("Falha no rollback da reserva invalidada", error);
      });
      throw new Error("A carta ou o slot mudou durante a operação. Tente novamente.");
    }

    const refreshedItems = await safeGetItems(OBR, [
      latestItem.id,
      expectedPreviousItemId,
    ]);
    const refreshedSelectedItem = refreshedItems.find(
      (item) => item.id === latestItem.id,
    );

    if (!refreshedSelectedItem) {
      await rollbackSlotReservation(
        OBR,
        color,
        category,
        currentItem.id,
        expectedPreviousItemId,
      ).catch((error) => {
        console.error("Falha no rollback apos a carta desaparecer", error);
      });
      throw new Error("A carta selecionada não está mais disponível.");
    }

    const previousItem = expectedPreviousItemId
      ? refreshedItems.find((item) => item.id === expectedPreviousItemId)
      : null;
    const previousOrigin = expectedPreviousItemId
      ? reservedState.origins[expectedPreviousItemId]
      : null;
    const previousReferences = expectedPreviousItemId
      ? getAssignmentReferences(reservedState, expectedPreviousItemId)
      : [];
    const itemsToMove = [refreshedSelectedItem];

    if (previousItem && previousReferences.length === 0) {
      itemsToMove.push(previousItem);
    } else if (previousItem && previousReferences.length) {
      console.warn("O ocupante anterior foi atribuido em outro slot e nao sera movido", {
        previousItemId: previousItem.id,
      });
    }

    const destinationZIndex = getTopZIndex(initialSlot);
    const selectedDestination = {
      ...initialSlot,
      zIndex: destinationZIndex,
      locked: category !== "divinity",
    };

    try {
      await OBR.scene.items.updateItems(itemsToMove, (draftItems) => {
        for (const item of draftItems) {
          if (item.id === refreshedSelectedItem.id) {
            applyPlacement(item, initialSlot, { zIndex: destinationZIndex });
            item.locked = category !== "divinity";
            continue;
          }

          if (previousItem && item.id === previousItem.id) {
            if (previousOrigin) {
              applyPlacement(item, previousOrigin);
              item.locked = previousOrigin.locked;
            } else {
              item.locked = false;
            }
          }
        }
      });
    } catch (error) {
      console.error("Falha ao mover ou bloquear os itens do slot", error);
      const rolledBack = await rollbackSlotReservation(
        OBR,
        color,
        category,
        currentItem.id,
        expectedPreviousItemId,
      ).catch((rollbackError) => {
        console.error("Falha no rollback da metadata do slot", rollbackError);
        return false;
      });

      if (rolledBack) {
        await reconcileSlotItemsAfterFailure(OBR, {
          color,
          category,
          selectedItemId: currentItem.id,
          selectedOrigin,
          selectedDestination,
          previousItemId: expectedPreviousItemId,
          previousOrigin,
          slot: initialSlot,
        }).catch((reconciliationError) => {
          console.error("Falha ao reconciliar os itens do slot", reconciliationError);
        });
      }

      throw new Error("Não consegui posicionar a carta; o slot foi restaurado.");
    }

    const finalState = await getSceneState(OBR);
    const finalReferences = getAssignmentReferences(finalState, currentItem.id);
    const finalForeignAssignment = getForeignAssignment(finalReferences, color);

    if (
      finalState.assigned[color]?.[category] !== currentItem.id ||
      finalForeignAssignment
    ) {
      console.warn("A reserva do slot foi perdida depois do movimento", {
        itemId: currentItem.id,
        color,
        category,
      });
      await reconcileSlotItemsAfterFailure(OBR, {
        color,
        category,
        selectedItemId: currentItem.id,
        selectedOrigin,
        selectedDestination,
        previousItemId: expectedPreviousItemId,
        previousOrigin,
        slot: initialSlot,
      }).catch((error) => {
        console.error("Falha ao reconciliar um conflito posterior de slot", error);
      });
      throw new Error("O slot mudou durante a operação. A carta foi reconciliada.");
    }

    return {
      color,
      category,
      replaced: Boolean(previousItem && previousItem.id !== currentItem.id),
    };
  });
}

export async function returnSelectedCardToOrigin(OBR, fallbackSelection = []) {
  const selectedIds = await getSelectedItemIds(OBR, fallbackSelection);

  if (selectedIds.length !== 1) {
    throw new Error("Selecione exatamente uma imagem na cena.");
  }

  const itemId = selectedIds[0];
  const initialState = await getSceneState(OBR);
  const initialReferences = getAssignmentReferences(initialState, itemId);
  const lockKeys = [
    `card:${itemId}`,
    ...initialReferences.map((reference) =>
      slotOperationKey(reference.color, reference.category),
    ),
  ];

  return withSelectionOperationLocks(lockKeys, async () => {
    const currentSelection = await getSelectedItemIds(OBR, [itemId]);

    if (
      currentSelection.length !== 1 ||
      currentSelection[0] !== itemId
    ) {
      throw new Error("A seleção mudou antes de devolver a carta.");
    }

    const [currentItems, currentState] = await Promise.all([
      OBR.scene.items.getItems([itemId]),
      getSceneState(OBR),
    ]);
    const currentItem = currentItems[0] || null;
    const currentReferences = getAssignmentReferences(currentState, itemId);

    if (!currentItem) {
      if (!currentReferences.length) {
        throw new Error("A imagem selecionada não está mais disponível.");
      }

      console.warn("Item ausente; limpando somente referencias exatas de slot", {
        itemId,
        references: currentReferences,
      });
      await clearItemAssignmentReferences(OBR, itemId);
      return true;
    }

    if (currentItem.type !== "IMAGE") {
      throw new Error("Selecione exatamente uma imagem na cena.");
    }

    const origin = currentState.origins[itemId];

    if (!origin) {
      console.warn("Carta sem origem registrada", { itemId });
      throw new Error("Não encontrei a posição original dessa carta.");
    }

    const alreadyAtOrigin =
      placementMatches(capturePlacement(currentItem), origin) &&
      currentReferences.length === 0;

    if (alreadyAtOrigin) {
      return true;
    }

    try {
      await OBR.scene.items.updateItems([currentItem], (items) => {
        applyPlacement(items[0], origin);
        items[0].locked = origin.locked;
      });
    } catch (error) {
      console.error("Falha ao mover ou desbloquear a carta para a origem", error);
      throw new Error("Não consegui devolver a carta para a origem.");
    }

    try {
      await clearItemAssignmentReferences(OBR, itemId);
    } catch (error) {
      console.error("Retorno a origem parcial: metadata de slot nao foi limpa", {
        itemId,
        error,
      });
      throw new Error(
        "A carta voltou para a origem, mas não consegui limpar o slot. Tente novamente.",
      );
    }

    console.info("Carta devolvida para a origem e slot reconciliado", { itemId });
    return true;
  });
}
