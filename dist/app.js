const process = { env: { NODE_ENV: "production" } };

const EXTENSION_ID = "br.demonrider.double-sided-cards";
const METADATA_KEY = `${EXTENSION_ID}/card`;
const DECK_METADATA_KEY = `${EXTENSION_ID}/deck`;
const COMMANDS_CHANNEL = `${EXTENSION_ID}/commands`;

function isCardMetadata(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.version === 1 &&
      value.faces &&
      value.faces.front &&
      value.faces.back &&
      typeof value.faces.front.url === "string" &&
      typeof value.faces.back.url === "string",
  );
}

function isDeckMetadata(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.version === 1 &&
      Array.isArray(value.cards) &&
      value.back &&
      typeof value.back.url === "string" &&
      typeof value.gridWidth === "number",
  );
}

function getCardMetadata(item) {
  const metadata = item.metadata?.[METADATA_KEY];
  return isCardMetadata(metadata) ? metadata : null;
}

function getDeckMetadata(item) {
  const metadata = item.metadata?.[DECK_METADATA_KEY];
  return isDeckMetadata(metadata) ? metadata : null;
}

function setCardMetadata(item, metadata) {
  item.metadata ||= {};
  item.metadata[METADATA_KEY] = metadata;
}

function setDeckMetadata(item, metadata) {
  item.metadata ||= {};
  item.metadata[DECK_METADATA_KEY] = metadata;
}

function createCardMetadataMap(metadata) {
  return {
    [METADATA_KEY]: metadata,
  };
}

function createDeckMetadataMap(metadata) {
  return {
    [DECK_METADATA_KEY]: metadata,
  };
}

function nextFace(currentFace) {
  return currentFace === "front" ? "back" : "front";
}

function faceLabel(face) {
  return face === "front" ? "frente" : "verso";
}

function createCardMetadata({
  name,
  front,
  back,
  gridWidth,
  currentFace = "front",
  sourceDeckId,
  sourceDeckName,
}) {
  const metadata = {
    version: 1,
    name,
    currentFace,
    gridWidth,
    faces: {
      front,
      back,
    },
  };

  if (sourceDeckId) {
    metadata.sourceDeckId = sourceDeckId;
  }

  if (sourceDeckName) {
    metadata.sourceDeckName = sourceDeckName;
  }

  return metadata;
}

function createDeckMetadata({ name, back, cards, gridWidth }) {
  return {
    version: 1,
    name,
    back,
    cards,
    gridWidth,
  };
}

function deckDescription(count) {
  return count === 1 ? "Pilha: 1 carta" : `Pilha: ${count} cartas`;
}

function createImageData(face) {
  return {
    url: face.url,
    width: face.width,
    height: face.height,
    mime: face.mime,
  };
}

function createGridData(face, gridWidth) {
  const dpi = Math.max(1, face.width / gridWidth);

  return {
    dpi,
    offset: {
      x: face.width / 2,
      y: face.height / 2,
    },
  };
}

function getMimeFromUrl(rawUrl) {
  try {
    const extension = new URL(rawUrl).pathname.split(".").pop().toLowerCase();

    if (extension === "jpg" || extension === "jpeg") {
      return "image/jpeg";
    }
    if (extension === "webp") {
      return "image/webp";
    }
    if (extension === "gif") {
      return "image/gif";
    }
    if (extension === "svg") {
      return "image/svg+xml";
    }
  } catch {
    return "image/png";
  }

  return "image/png";
}

const RETURN_LOCK_MS = 1800;
const RETURN_LOCK_SETTLE_MS = 100;

function getDeckItems(items) {
  return items.filter((item) => isDeckMetadata(getDeckMetadata(item)));
}

function getCardItems(items) {
  return items.filter((item) => isCardMetadata(getCardMetadata(item)));
}

function createDeckText(count) {
  const text = String(count);

  return {
    richText: [
      {
        type: "paragraph",
        children: [{ text }],
      },
    ],
    plainText: text,
    style: {
      padding: 8,
      fontFamily: "Roboto",
      fontSize: 36,
      fontWeight: 800,
      textAlign: "CENTER",
      textAlignVertical: "MIDDLE",
      fillColor: "white",
      fillOpacity: 1,
      strokeColor: "black",
      strokeOpacity: 0.85,
      strokeWidth: 3,
      lineHeight: 1,
    },
    type: "PLAIN",
    width: "AUTO",
    height: "AUTO",
  };
}

function applyDeckDisplay(item, metadata) {
  const count = metadata.cards.length;

  item.name = `${metadata.name} (${count})`;
  item.description = deckDescription(count);
  item.text = createDeckText(count);
}

function shuffleCards(cards) {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isActiveReturnLock(lock, now = Date.now()) {
  return Boolean(
    lock &&
      typeof lock === "object" &&
      typeof lock.expiresAt === "number" &&
      lock.expiresAt > now,
  );
}

function getActiveReturnLocks(metadata, now = Date.now()) {
  const locks = metadata.returnLocks;

  if (!locks || typeof locks !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(locks).filter(([, lock]) => isActiveReturnLock(lock, now)),
  );
}

async function acquireDeckReturnLocks(OBR, targetDeck, cards) {
  const cardIds = [...new Set(cards.map((card) => card.id).filter(Boolean))];

  if (!cardIds.length) {
    return null;
  }

  const lockId = `return:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const expiresAt = Date.now() + RETURN_LOCK_MS;
  let requestedCardIds = [];

  await OBR.scene.items.updateItems([targetDeck], (items) => {
    const item = items[0];
    const metadata = item ? getDeckMetadata(item) : null;

    if (!metadata) {
      return;
    }

    const now = Date.now();
    const activeLocks = getActiveReturnLocks(metadata, now);
    const returnedCardIds =
      metadata.returnedCardIds && typeof metadata.returnedCardIds === "object"
        ? metadata.returnedCardIds
        : {};
    const availableCardIds = cardIds.filter(
      (cardId) => !returnedCardIds[cardId] && !isActiveReturnLock(activeLocks[cardId], now),
    );

    if (!availableCardIds.length) {
      return;
    }

    const returnLocks = { ...activeLocks };

    for (const cardId of availableCardIds) {
      returnLocks[cardId] = {
        id: lockId,
        expiresAt,
      };
    }

    requestedCardIds = availableCardIds;
    setDeckMetadata(item, {
      ...metadata,
      returnLocks,
    });
  });

  if (!requestedCardIds.length) {
    return null;
  }

  await wait(RETURN_LOCK_SETTLE_MS);

  const [lockedDeck] = getDeckItems(await OBR.scene.items.getItems([targetDeck.id]));
  const metadata = lockedDeck ? getDeckMetadata(lockedDeck) : null;
  const lockedCardIds = requestedCardIds.filter(
    (cardId) => metadata?.returnLocks?.[cardId]?.id === lockId,
  );

  if (!lockedCardIds.length) {
    return null;
  }

  return {
    deck: lockedDeck,
    cardIds: lockedCardIds,
    lockId,
  };
}

async function getDrawOffset(OBR) {
  try {
    return Math.max(48, (await OBR.scene.grid.getDpi()) * 0.6);
  } catch {
    return 80;
  }
}

async function drawFromDecks(OBR, buildImage, items, options = {}) {
  const decks = getDeckItems(items).filter(
    (item) => getDeckMetadata(item).cards.length > 0,
  );

  if (!decks.length) {
    return 0;
  }

  const offset = await getDrawOffset(OBR);
  const nextMetadataById = new Map();
  const drawnItems = [];

  for (const [index, deck] of decks.entries()) {
    const metadata = getDeckMetadata(deck);
    const [card, ...remainingCards] = metadata.cards;
    const cardMetadata = createCardMetadata({
      name: card.name,
      front: card.front,
      back: metadata.back,
      gridWidth: metadata.gridWidth,
      currentFace: "back",
      sourceDeckId: deck.id,
      sourceDeckName: metadata.name,
    });
    const drawOffset = offset * (index + 1);
    const position = options.drawPositionsByDeckId?.get(deck.id) || {
      x: deck.position.x + drawOffset,
      y: deck.position.y + drawOffset,
    };
    const item = buildImage(
      createImageData(metadata.back),
      createGridData(metadata.back, metadata.gridWidth),
    )
      .name(card.name)
      .description("Carta dupla: verso")
      .layer(deck.layer)
      .position(position)
      .metadata(createCardMetadataMap(cardMetadata))
      .build();

    drawnItems.push(item);
    nextMetadataById.set(deck.id, {
      ...metadata,
      cards: remainingCards,
    });
  }

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const item of draftItems) {
      const metadata = nextMetadataById.get(item.id);
      if (!metadata) {
        continue;
      }

      applyDeckDisplay(item, metadata);
      setDeckMetadata(item, metadata);

      const restoredPosition = options.deckPositionsById?.get(item.id);
      if (restoredPosition) {
        item.position = restoredPosition;
      }
    }
  });

  await OBR.scene.items.addItems(drawnItems);
  return drawnItems.length;
}

async function getSelectedDeckItems(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();
  const itemIds = selection?.length ? selection : fallbackSelection;

  if (!itemIds.length) {
    return [];
  }

  return getDeckItems(await OBR.scene.items.getItems(itemIds));
}

async function drawSelectedDecks(OBR, buildImage, fallbackSelection = []) {
  const decks = await getSelectedDeckItems(OBR, fallbackSelection);
  return drawFromDecks(OBR, buildImage, decks);
}

async function shuffleDecks(OBR, items) {
  const decks = getDeckItems(items).filter(
    (item) => getDeckMetadata(item).cards.length > 1,
  );

  if (!decks.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const item of draftItems) {
      const metadata = getDeckMetadata(item);
      setDeckMetadata(item, {
        ...metadata,
        cards: shuffleCards(metadata.cards),
      });
    }
  });

  return decks.length;
}

async function shuffleSelectedDecks(OBR, fallbackSelection = []) {
  const decks = await getSelectedDeckItems(OBR, fallbackSelection);
  return shuffleDecks(OBR, decks);
}

async function getSelectedCardItems(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();
  const itemIds = selection?.length ? selection : fallbackSelection;

  if (!itemIds.length) {
    return [];
  }

  return getCardItems(await OBR.scene.items.getItems(itemIds));
}

async function getTargetDeck(OBR, cards, fallbackDeckSelection = []) {
  const sourceDeckIds = [
    ...new Set(
      cards
        .map((item) => getCardMetadata(item)?.sourceDeckId)
        .filter((deckId) => typeof deckId === "string" && deckId.length),
    ),
  ];

  if (sourceDeckIds.length) {
    const sourceDecks = getDeckItems(await OBR.scene.items.getItems(sourceDeckIds));
    if (sourceDecks.length) {
      return sourceDecks[0];
    }
  }

  if (fallbackDeckSelection.length) {
    const fallbackDecks = getDeckItems(await OBR.scene.items.getItems(fallbackDeckSelection));
    if (fallbackDecks.length) {
      return fallbackDecks[0];
    }
  }

  return null;
}

async function returnCardsToDeck(OBR, cards, fallbackDeckSelection = []) {
  const cardsToReturn = getCardItems(cards);

  if (!cardsToReturn.length) {
    return 0;
  }

  const targetDeck = await getTargetDeck(OBR, cardsToReturn, fallbackDeckSelection);

  if (!targetDeck) {
    return 0;
  }

  const returnLock = await acquireDeckReturnLocks(OBR, targetDeck, cardsToReturn);

  if (!returnLock) {
    return 0;
  }

  const lockedCardIds = new Set(returnLock.cardIds);
  const lockedCards = cardsToReturn.filter((card) => lockedCardIds.has(card.id));

  if (!lockedCards.length) {
    return 0;
  }

  let returnedCards = lockedCards.map((item) => {
    const metadata = getCardMetadata(item);

    return {
      name: metadata.name || item.name || "Carta",
      front: metadata.faces.front,
    };
  });

  let returnedCardIds = [];

  await OBR.scene.items.updateItems([returnLock.deck], (items) => {
    const item = items[0];
    const metadata = getDeckMetadata(item);
    const activeLocks = getActiveReturnLocks(metadata);
    const cardsStillLocked = lockedCards.filter(
      (card) => activeLocks[card.id]?.id === returnLock.lockId,
    );

    if (!cardsStillLocked.length) {
      returnedCards = [];
      return;
    }

    returnedCardIds = cardsStillLocked.map((card) => card.id);
    returnedCards = cardsStillLocked.map((card) => {
      const cardMetadata = getCardMetadata(card);

      return {
        name: cardMetadata.name || card.name || "Carta",
        front: cardMetadata.faces.front,
      };
    });

    const returnedCardMap =
      metadata.returnedCardIds && typeof metadata.returnedCardIds === "object"
        ? metadata.returnedCardIds
        : {};
    const nextMetadata = {
      ...metadata,
      cards: [...metadata.cards, ...returnedCards],
      returnLocks: activeLocks,
      returnedCardIds: {
        ...returnedCardMap,
        ...Object.fromEntries(returnedCardIds.map((cardId) => [cardId, true])),
      },
    };

    applyDeckDisplay(item, nextMetadata);
    setDeckMetadata(item, nextMetadata);
  });

  if (!returnedCardIds.length) {
    return 0;
  }

  await OBR.scene.items.deleteItems(returnedCardIds);

  return returnedCardIds.length;
}

async function returnSelectedCardsToDeck(
  OBR,
  fallbackCardSelection = [],
  fallbackDeckSelection = [],
) {
  const cards = await getSelectedCardItems(OBR, fallbackCardSelection);
  return returnCardsToDeck(OBR, cards, fallbackDeckSelection);
}

const COLOR_TOKEN_KEY = `${EXTENSION_ID}/color-token`;
const CARD_CATEGORY_KEY = `${EXTENSION_ID}/card-category`;
const ACTIVE_COLOR_KEY = `${EXTENSION_ID}/active-color`;
const SELECTION_BOARD_KEY = `${EXTENSION_ID}/selection-board`;

const PLAYER_COLORS = [
  { id: "red", label: "Vermelho", aliases: ["vermelho", "red"] },
  { id: "white", label: "Branco", aliases: ["branco", "white"] },
  { id: "green", label: "Verde", aliases: ["verde", "green"] },
  { id: "blue", label: "Azul", aliases: ["azul", "blue"] },
];

const CARD_CATEGORIES = [
  { id: "race", label: "Raca" },
  { id: "class", label: "Classe" },
  { id: "divinity", label: "Divindade" },
];

const PLAYER_COLOR_IDS = new Set(PLAYER_COLORS.map((color) => color.id));
const CATEGORY_IDS = new Set(CARD_CATEGORIES.map((category) => category.id));

function getColorLabel(colorId) {
  return PLAYER_COLORS.find((color) => color.id === colorId)?.label || "cor";
}

function getCategoryLabel(categoryId) {
  return CARD_CATEGORIES.find((category) => category.id === categoryId)?.label || "categoria";
}

function normalizePlayerColor(colorId) {
  return PLAYER_COLOR_IDS.has(colorId) ? colorId : null;
}

function normalizeCategory(categoryId) {
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

async function getActivePlayerColor(OBR) {
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

async function setActivePlayerColor(OBR, colorId) {
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

async function markSelectedTokenColor(OBR, colorId, fallbackSelection = []) {
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

async function markSelectedCardsCategory(OBR, categoryId, fallbackSelection = []) {
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

async function saveSlotFromSelectedItem(
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

async function returnSelectedCardToOrigin(OBR, fallbackSelection = []) {
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

const DIVINITY_GRID_WIDTH = 2;
const DIVINITY_GRID_HEIGHT = 3;
const DIVINITY_ORIGIN = {
  x: 390,
  y: 395,
};
const EPSILON = 0.0001;

function isDivinityCategoryItem(item) {
  return item?.metadata?.[CARD_CATEGORY_KEY]?.category === "divinity";
}

function getDivinityGridData(face) {
  const dpi = Math.max(1, face.width / DIVINITY_GRID_WIDTH);

  return {
    dpi,
    offset: { ...DIVINITY_ORIGIN },
  };
}

function getDivinityScale(face) {
  const dpi = Math.max(1, face.width / DIVINITY_GRID_WIDTH);

  return {
    x: 1,
    y: (DIVINITY_GRID_HEIGHT * dpi) / Math.max(1, face.height),
  };
}

function almostEqual(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= EPSILON;
}

function needsDivinitySizing(item, face = item?.image) {
  if (!isDivinityCategoryItem(item) || !face?.width || !face?.height) {
    return false;
  }

  const grid = getDivinityGridData(face);
  const scale = getDivinityScale(face);

  return !(
    almostEqual(item.grid?.dpi, grid.dpi) &&
    almostEqual(item.grid?.offset?.x, grid.offset.x) &&
    almostEqual(item.grid?.offset?.y, grid.offset.y) &&
    almostEqual(item.scale?.x, scale.x) &&
    almostEqual(item.scale?.y, scale.y)
  );
}

function applyDivinitySizing(item, face = item?.image) {
  if (!isDivinityCategoryItem(item) || !face?.width || !face?.height) {
    return false;
  }

  const changed = needsDivinitySizing(item, face);
  item.grid = getDivinityGridData(face);
  item.scale = getDivinityScale(face);
  return changed;
}

function getDoubleSidedCards(items) {
  return items.filter((item) => isCardMetadata(getCardMetadata(item)));
}

async function flipItems(OBR, items) {
  const itemsToFlip = getDoubleSidedCards(items);

  if (!itemsToFlip.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(itemsToFlip, (draftItems) => {
    for (const item of draftItems) {
      const metadata = getCardMetadata(item);
      const targetFace = nextFace(metadata.currentFace);
      const face = metadata.faces[targetFace];

      item.image = createImageData(face);
      item.grid = createGridData(face, metadata.gridWidth);
      applyDivinitySizing(item, face);
      item.description = `Carta dupla: ${faceLabel(targetFace)}`;
      setCardMetadata(item, {
        ...metadata,
        currentFace: targetFace,
      });
    }
  });

  return itemsToFlip.length;
}

async function flipSelectedItems(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();

  const itemIds = selection?.length ? selection : fallbackSelection;

  if (!itemIds.length) {
    return 0;
  }

  const selectedItems = await OBR.scene.items.getItems(itemIds);
  return flipItems(OBR, selectedItems);
}

const PRESET_DECKS_URL = new URL("../assets/preset-decks/decks.json", import.meta.url);
const ITEM_LAYERS = new Set([
  "DRAWING",
  "PROP",
  "MOUNT",
  "CHARACTER",
  "ATTACHMENT",
  "NOTE",
  "TEXT",
]);

function isExternalUrl(value) {
  return /^(https?:|data:|blob:)/i.test(value);
}

function resolveAssetUrl(path) {
  if (!path || typeof path !== "string") {
    return "";
  }

  if (isExternalUrl(path)) {
    return path;
  }

  return new URL(`../${path.replace(/^\/+/, "")}`, import.meta.url).toString();
}

function getNameFromPath(path, fallback) {
  if (!path || typeof path !== "string") {
    return fallback;
  }

  try {
    const pathname = isExternalUrl(path) ? new URL(path).pathname : path;
    const filename = pathname.split("/").filter(Boolean).pop();

    if (!filename) {
      return fallback;
    }

    return decodeURIComponent(filename.replace(/\.[^.]+$/, "")) || fallback;
  } catch {
    return fallback;
  }
}

function normalizeAsset(value, fallbackName) {
  if (typeof value === "string") {
    return {
      name: getNameFromPath(value, fallbackName),
      path: value,
    };
  }

  if (!value || typeof value !== "object") {
    return {
      name: fallbackName,
      path: "",
    };
  }

  return {
    name: value.name || getNameFromPath(value.path || value.url, fallbackName),
    path: value.path || value.url || "",
    width: value.width,
    height: value.height,
    mime: value.mime,
  };
}

function normalizePresetDeck(value, index) {
  const name = value?.name || `Pilha ${index + 1}`;
  const layer = ITEM_LAYERS.has(value?.layer) ? value.layer : "PROP";

  return {
    id: value?.id || `deck-${index + 1}`,
    name,
    gridWidth: Number.isFinite(value?.gridWidth) && value.gridWidth > 0 ? value.gridWidth : 2,
    layer,
    back: normalizeAsset(value?.back, `${name} verso`),
    cards: Array.isArray(value?.cards)
      ? value.cards.map((card, cardIndex) => {
          if (typeof card === "string") {
            return {
              name: getNameFromPath(card, `Carta ${cardIndex + 1}`),
              front: normalizeAsset(card, `Carta ${cardIndex + 1}`),
            };
          }

          return {
            name: card?.name || `Carta ${cardIndex + 1}`,
            front: normalizeAsset(card?.front || card?.path || card?.url, `Carta ${cardIndex + 1}`),
          };
        })
      : [],
  };
}

async function loadPresetDecks() {
  const response = await fetch(`${PRESET_DECKS_URL.toString()}?t=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Nao consegui carregar a biblioteca de pilhas.");
  }

  const data = await response.json();
  const decks = Array.isArray(data?.decks) ? data.decks : [];

  return decks.map(normalizePresetDeck);
}

function isPresetDeckReady(deck) {
  return Boolean(deck?.back?.path && deck.cards?.length);
}

function readImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error(`Imagem sem tamanho valido: ${url}`));
        return;
      }

      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => reject(new Error(`Nao consegui carregar a imagem: ${url}`));
    image.src = url;
  });
}

async function buildFace(asset) {
  const url = resolveAssetUrl(asset.path);

  if (!url) {
    throw new Error("A pilha padrao ainda nao tem verso configurado.");
  }

  const dimensions =
    Number.isFinite(asset.width) && Number.isFinite(asset.height)
      ? { width: asset.width, height: asset.height }
      : await readImage(url);

  return {
    url,
    width: dimensions.width,
    height: dimensions.height,
    mime: asset.mime || getMimeFromUrl(url),
  };
}

async function buildPresetDeckData(deck) {
  if (!isPresetDeckReady(deck)) {
    throw new Error(`A pilha "${deck?.name || "padrao"}" ainda nao tem cartas configuradas.`);
  }

  const [back, cards] = await Promise.all([
    buildFace(deck.back),
    Promise.all(
      deck.cards.map(async (card, index) => ({
        name: card.name || `Carta ${index + 1}`,
        front: await buildFace(card.front),
      })),
    ),
  ]);

  return {
    name: deck.name,
    back,
    cards,
    gridWidth: deck.gridWidth,
    layer: deck.layer,
  };
}

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

async function loadDefaultBoardPreset() {
  const response = await fetch(`${DEFAULT_BOARD_PRESET_URL}?v=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const preset = await response.json();
  return isDefaultBoardPreset(preset) ? preset : null;
}

async function saveDefaultBoardPreset(OBR) {
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

async function restoreDefaultBoardPreset(OBR, preset) {
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

const elements = {
  form: document.querySelector("#cardForm"),
  deckForm: document.querySelector("#deckForm"),
  presetDeckSelect: document.querySelector("#presetDeckSelect"),
  presetDeckGridWidth: document.querySelector("#presetDeckGridWidth"),
  presetDeckLayer: document.querySelector("#presetDeckLayer"),
  presetDeckInfo: document.querySelector("#presetDeckInfo"),
  importPresetDeckButton: document.querySelector("#importPresetDeckButton"),
  name: document.querySelector("#cardName"),
  frontUrl: document.querySelector("#frontUrl"),
  frontFile: document.querySelector("#frontFile"),
  pickFrontAssetButton: document.querySelector("#pickFrontAssetButton"),
  backUrl: document.querySelector("#backUrl"),
  backFile: document.querySelector("#backFile"),
  pickBackAssetButton: document.querySelector("#pickBackAssetButton"),
  gridWidth: document.querySelector("#gridWidth"),
  layer: document.querySelector("#layer"),
  deckName: document.querySelector("#deckName"),
  deckBackUrl: document.querySelector("#deckBackUrl"),
  deckBackFile: document.querySelector("#deckBackFile"),
  pickDeckBackAssetButton: document.querySelector("#pickDeckBackAssetButton"),
  deckFrontUrls: document.querySelector("#deckFrontUrls"),
  deckFrontFiles: document.querySelector("#deckFrontFiles"),
  pickDeckFrontAssetsButton: document.querySelector("#pickDeckFrontAssetsButton"),
  deckAssetsStatus: document.querySelector("#deckAssetsStatus"),
  deckGridWidth: document.querySelector("#deckGridWidth"),
  deckLayer: document.querySelector("#deckLayer"),
  panelFlipButton: document.querySelector("#panelFlipButton"),
  panelDrawButton: document.querySelector("#panelDrawButton"),
  panelShuffleButton: document.querySelector("#panelShuffleButton"),
  panelReturnButton: document.querySelector("#panelReturnButton"),
  panelRepairButton: document.querySelector("#panelRepairButton"),
  activeColorSelect: document.querySelector("#activeColorSelect"),
  colorTokenButtons: [...document.querySelectorAll("[data-token-color]")],
  slotColorSelect: document.querySelector("#slotColorSelect"),
  slotCategorySelect: document.querySelector("#slotCategorySelect"),
  saveSlotButton: document.querySelector("#saveSlotButton"),
  categoryCardButtons: [...document.querySelectorAll("[data-card-category]")],
  returnOriginButton: document.querySelector("#returnOriginButton"),
  publicBaseUrl: document.querySelector("#publicBaseUrl"),
  migratePublicButton: document.querySelector("#migratePublicButton"),
  createDefaultBoardButton: document.querySelector("#createDefaultBoardButton"),
  restoreDefaultBoardButton: document.querySelector("#restoreDefaultBoardButton"),
  defaultBoardInfo: document.querySelector("#defaultBoardInfo"),
  importButton: document.querySelector("#importButton"),
  importDeckButton: document.querySelector("#importDeckButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  message: document.querySelector("#message"),
  frontPreview: document.querySelector("#frontPreview"),
  backPreview: document.querySelector("#backPreview"),
  deckBackPreview: document.querySelector("#deckBackPreview"),
};

let obr = null;
let buildImage = null;
let lastCardSelection = [];
let lastDeckSelection = [];
let presetDecks = [];
let defaultBoardPreset = null;
const selectedAssets = {
  front: null,
  back: null,
  deckBack: null,
  deckFronts: [],
};

window.addEventListener("error", (event) => {
  setConnectionStatus("Erro no painel", false);
  setMessage(`Erro no painel: ${event.message}`, "error");
});

window.addEventListener("unhandledrejection", (event) => {
  setConnectionStatus("Erro no painel", false);
  setMessage(`Erro no painel: ${event.reason?.message || event.reason}`, "error");
});

function setMessage(text, tone = "neutral") {
  elements.message.textContent = text;
  elements.message.dataset.tone = tone;
}

function setConnectionStatus(text, isConnected) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.dataset.connected = String(isConnected);
  if (elements.importButton) {
    elements.importButton.disabled = !isConnected;
  }
  if (elements.importDeckButton) {
    elements.importDeckButton.disabled = !isConnected;
  }
  if (elements.pickFrontAssetButton) {
    elements.pickFrontAssetButton.disabled = !isConnected;
  }
  if (elements.pickBackAssetButton) {
    elements.pickBackAssetButton.disabled = !isConnected;
  }
  if (elements.pickDeckBackAssetButton) {
    elements.pickDeckBackAssetButton.disabled = !isConnected;
  }
  if (elements.pickDeckFrontAssetsButton) {
    elements.pickDeckFrontAssetsButton.disabled = !isConnected;
  }
  elements.migratePublicButton.disabled = !isConnected;
  updateDefaultBoardControls(isConnected);
  elements.panelFlipButton.disabled = !isConnected;
  elements.panelDrawButton.disabled = !isConnected;
  elements.panelShuffleButton.disabled = !isConnected;
  elements.panelReturnButton.disabled = !isConnected;
  elements.panelRepairButton.disabled = !isConnected;
  elements.activeColorSelect.disabled = !isConnected;
  elements.slotColorSelect.disabled = !isConnected;
  elements.slotCategorySelect.disabled = !isConnected;
  elements.saveSlotButton.disabled = !isConnected;
  elements.returnOriginButton.disabled = !isConnected;
  updatePresetDeckControls(isConnected);
  for (const button of elements.colorTokenButtons) {
    button.disabled = !isConnected;
  }
  for (const button of elements.categoryCardButtons) {
    button.disabled = !isConnected;
  }
}

function isLocalhost() {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function formatPresetDate(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value || "";
  }
}

function updateDefaultBoardControls(isConnected = Boolean(obr)) {
  elements.createDefaultBoardButton.disabled = !isConnected || !isLocalhost();
  elements.restoreDefaultBoardButton.disabled = !isConnected || !defaultBoardPreset;

  if (!defaultBoardPreset) {
    elements.defaultBoardInfo.textContent = isLocalhost()
      ? "Nenhum tabuleiro padrao criado no localhost."
      : "Nenhum tabuleiro padrao cadastrado na extensao.";
    return;
  }

  const itemLabel =
    defaultBoardPreset.itemCount === 1
      ? "1 item no tabuleiro padrao"
      : `${defaultBoardPreset.itemCount} itens no tabuleiro padrao`;
  elements.defaultBoardInfo.textContent = `${itemLabel} criado em ${formatPresetDate(
    defaultBoardPreset.savedAt,
  )}.`;
}

async function refreshDefaultBoardInfo() {
  defaultBoardPreset = await loadDefaultBoardPreset();
  updateDefaultBoardControls(Boolean(obr));
}

async function rememberCardSelection(selection) {
  if (!obr || !selection?.length) {
    return;
  }

  const selectedItems = await obr.scene.items.getItems(selection);
  const cardIds = getDoubleSidedCards(selectedItems).map((item) => item.id);

  if (cardIds.length) {
    lastCardSelection = cardIds;
  }
}

async function rememberDeckSelection(selection) {
  if (!obr || !selection?.length) {
    return;
  }

  const selectedItems = await obr.scene.items.getItems(selection);
  const deckIds = getDeckItems(selectedItems).map((item) => item.id);

  if (deckIds.length) {
    lastDeckSelection = deckIds;
  }
}

async function refreshPanelSelectionMemory() {
  if (!obr) {
    return;
  }

  const selection = await obr.player.getSelection();
  await Promise.all([rememberCardSelection(selection), rememberDeckSelection(selection)]);
}

async function showPanelActionResult(count, singular, plural, warning) {
  if (!count) {
    setMessage(warning, "warning");
    await obr.notification.show(warning, "WARNING");
    return;
  }

  const message = count === 1 ? singular : plural(count);
  setMessage(message, "success");
  await obr.notification.show(message, "SUCCESS");
}

async function runPanelAction(button, action) {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para usar os comandos.", "warning");
    return;
  }

  button.disabled = true;
  try {
    await refreshPanelSelectionMemory();
    await action();
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui executar a acao.", "error");
  } finally {
    button.disabled = false;
  }
}

function syncColorControls(color) {
  const activeColor = color || "";
  elements.activeColorSelect.value = activeColor;

  if (color) {
    elements.slotColorSelect.value = color;
  }
}

async function refreshActiveColorControls() {
  if (!obr) {
    syncColorControls(null);
    return;
  }

  syncColorControls(await getActivePlayerColor(obr));
}

function populateSelectionBoardControls() {
  for (const color of PLAYER_COLORS) {
    const activeOption = document.createElement("option");
    activeOption.value = color.id;
    activeOption.textContent = color.label;
    elements.activeColorSelect.append(activeOption);

    const slotOption = document.createElement("option");
    slotOption.value = color.id;
    slotOption.textContent = color.label;
    elements.slotColorSelect.append(slotOption);
  }

  for (const category of CARD_CATEGORIES) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.label;
    elements.slotCategorySelect.append(option);
  }
}

function getRepairMessage(stats) {
  const parts = [];

  if (stats.cards) {
    parts.push(stats.cards === 1 ? "1 carta" : `${stats.cards} cartas`);
  }

  if (stats.decks) {
    parts.push(stats.decks === 1 ? "1 pilha" : `${stats.decks} pilhas`);
  }

  return `Cena sincronizada: ${parts.join(" e ")}.`;
}

async function repairSceneMetadata() {
  const items = await obr.scene.items.getItems();
  const repairableItems = items.filter((item) => getCardMetadata(item) || getDeckMetadata(item));
  const stats = repairableItems.reduce(
    (result, item) => {
      if (getCardMetadata(item)) {
        result.cards += 1;
      } else if (getDeckMetadata(item)) {
        result.decks += 1;
      }

      return result;
    },
    { cards: 0, decks: 0 },
  );

  if (!repairableItems.length) {
    return stats;
  }

  await obr.scene.items.updateItems(repairableItems, (draftItems) => {
    for (const item of draftItems) {
      const cardMetadata = getCardMetadata(item);

      if (cardMetadata) {
        const currentFace = cardMetadata.currentFace === "back" ? "back" : "front";
        const face = cardMetadata.faces[currentFace];

        item.image = createImageData(face);
        item.grid = createGridData(face, cardMetadata.gridWidth);
        applyDivinitySizing(item, face);
        item.description = currentFace === "back" ? "Carta dupla: verso" : "Carta dupla: frente";
        setCardMetadata(item, {
          ...cardMetadata,
          currentFace,
        });
        continue;
      }

      const deckMetadata = getDeckMetadata(item);

      if (deckMetadata) {
        item.image = createImageData(deckMetadata.back);
        item.grid = createGridData(deckMetadata.back, deckMetadata.gridWidth);
        item.name = `${deckMetadata.name} (${deckMetadata.cards.length})`;
        item.description = deckDescription(deckMetadata.cards.length);
        item.text = createDeckText(deckMetadata.cards.length);
        setDeckMetadata(item, deckMetadata);
      }
    }
  });

  return stats;
}

function normalizeUrl(value) {
  const url = value.trim();
  if (!url) {
    throw new Error("Informe uma URL valida.");
  }

  return new URL(url).toString();
}

function getGoogleDriveFileId(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (!url.hostname.endsWith("drive.google.com")) {
      return null;
    }

    const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
    if (fileMatch?.[1]) {
      return fileMatch[1];
    }

    return url.searchParams.get("id");
  } catch {
    return null;
  }
}

function getCurrentExtensionBaseUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";

  if (url.pathname.endsWith("/index.html")) {
    url.pathname = url.pathname.slice(0, -"index.html".length);
  }

  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

function getDefaultPublicBaseUrl() {
  const { hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "";
  }

  return getCurrentExtensionBaseUrl();
}

function getImageUrlCandidates(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const driveId = getGoogleDriveFileId(url);

  if (!driveId) {
    return [url];
  }

  const encodedId = encodeURIComponent(driveId);
  return [
    `https://drive.google.com/thumbnail?id=${encodedId}&sz=w2400`,
    `https://lh3.googleusercontent.com/d/${encodedId}=w2400`,
    `https://drive.google.com/uc?export=view&id=${encodedId}`,
    url,
  ];
}

function normalizePublicBaseUrl(value) {
  const url = new URL(value.trim());

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Informe uma URL publica iniciando com http ou https.");
  }

  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function encodeAssetFilename(filename) {
  return filename
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizeComparableUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function getMigratableAssetFilename(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const markers = ["/.local-assets/", "/assets/local-assets/"];

    for (const marker of markers) {
      const markerIndex = url.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
      }
    }

    return null;
  } catch {
    return null;
  }
}

function migrateFaceUrl(face, publicBaseUrl, stats) {
  const filename = getMigratableAssetFilename(face.url);

  if (!filename) {
    return face;
  }

  const nextUrl = `${publicBaseUrl}/assets/local-assets/${encodeAssetFilename(filename)}`;

  if (normalizeComparableUrl(face.url) === normalizeComparableUrl(nextUrl)) {
    return face;
  }

  stats.urls += 1;
  return {
    ...face,
    url: nextUrl,
  };
}

function migrateCardItem(item, publicBaseUrl, stats) {
  const metadata = getCardMetadata(item);

  if (!metadata) {
    return false;
  }

  const urlCountBefore = stats.urls;
  const nextMetadata = {
    ...metadata,
    faces: {
      front: migrateFaceUrl(metadata.faces.front, publicBaseUrl, stats),
      back: migrateFaceUrl(metadata.faces.back, publicBaseUrl, stats),
    },
  };
  const currentFace = nextMetadata.faces[nextMetadata.currentFace] || nextMetadata.faces.front;
  const urlsChanged = stats.urls !== urlCountBefore;
  const divinitySizingChanged = needsDivinitySizing(item, currentFace);

  if (!urlsChanged && !divinitySizingChanged) {
    return false;
  }

  item.image = createImageData(currentFace);
  item.grid = createGridData(currentFace, nextMetadata.gridWidth);
  applyDivinitySizing(item, currentFace);
  if (divinitySizingChanged) {
    stats.sized += 1;
  }
  setCardMetadata(item, nextMetadata);
  return true;
}

function migrateDeckItem(item, publicBaseUrl, stats) {
  const metadata = getDeckMetadata(item);

  if (!metadata) {
    return false;
  }

  const urlCountBefore = stats.urls;
  const nextCards = metadata.cards.map((card) => ({
    ...card,
    front: migrateFaceUrl(card.front, publicBaseUrl, stats),
  }));
  const nextMetadata = {
    ...metadata,
    back: migrateFaceUrl(metadata.back, publicBaseUrl, stats),
    cards: nextCards,
  };

  if (stats.urls === urlCountBefore) {
    return false;
  }

  const count = nextMetadata.cards.length;
  item.image = createImageData(nextMetadata.back);
  item.grid = createGridData(nextMetadata.back, nextMetadata.gridWidth);
  item.name = `${nextMetadata.name} (${count})`;
  item.description = deckDescription(count);
  item.text = createDeckText(count);
  setDeckMetadata(item, nextMetadata);
  return true;
}

async function migrateSceneLocalAssets() {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para migrar os links.", "warning");
    return;
  }

  const rawBaseUrl = elements.publicBaseUrl.value.trim();
  if (!rawBaseUrl) {
    throw new Error("Informe a URL publica do GitHub Pages antes de migrar.");
  }

  const publicBaseUrl = normalizePublicBaseUrl(rawBaseUrl);
  const items = await obr.scene.items.getItems();
  const stats = {
    items: 0,
    urls: 0,
    sized: 0,
  };

  await obr.scene.items.updateItems(items, (draftItems) => {
    for (const item of draftItems) {
      const changed =
        migrateCardItem(item, publicBaseUrl, stats) ||
        migrateDeckItem(item, publicBaseUrl, stats);

      if (changed) {
        stats.items += 1;
      }
    }
  });

  if (!stats.items) {
    setMessage("Nao encontrei links locais ou divindades fora do padrao nesta cena.", "warning");
    return;
  }

  const itemLabel = stats.items === 1 ? "1 item" : `${stats.items} itens`;
  const urlLabel = stats.urls === 1 ? "1 imagem" : `${stats.urls} imagens`;
  const divinityLabel =
    stats.sized === 1 ? "1 divindade ajustada" : `${stats.sized} divindades ajustadas`;
  const message = stats.urls
    ? `Migrei ${itemLabel} da cena para usar ${urlLabel} publicas${
        stats.sized ? `; ${divinityLabel}.` : "."
      }`
    : `${divinityLabel}.`;

  setMessage(message, "success");
  await obr.notification.show(
    stats.urls ? "Links locais migrados para o GitHub Pages." : "Divindades ajustadas.",
    "SUCCESS",
  );
}

async function createDefaultBoardFromCurrentScene() {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para criar o tabuleiro padrao.", "warning");
    return;
  }

  const result = await saveDefaultBoardPreset(obr);
  await refreshDefaultBoardInfo();

  const itemLabel = result.itemCount === 1 ? "1 item" : `${result.itemCount} itens`;
  const message = `Tabuleiro padrao criado com ${itemLabel}.`;
  setMessage(message, "success");
  await obr.notification.show("Tabuleiro padrao criado.", "SUCCESS");
}

async function restoreDefaultBoard() {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para restaurar o tabuleiro.", "warning");
    return;
  }

  if (!defaultBoardPreset) {
    setMessage("Nenhum tabuleiro padrao cadastrado na extensao.", "warning");
    await obr.notification.show("Nenhum tabuleiro padrao cadastrado.", "WARNING");
    return;
  }

  const confirmed = window.confirm(
    "Restaurar o tabuleiro padrao vai substituir a cena atual. Continuar?",
  );

  if (!confirmed) {
    return;
  }

  const result = await restoreDefaultBoardPreset(obr, defaultBoardPreset);
  updateDefaultBoardControls(true);

  const message = `Cena restaurada: ${result.updated} atualizados, ${result.added} recriados, ${result.deleted} removidos.`;
  setMessage(message, "success");
  await obr.notification.show("Tabuleiro padrao restaurado.", "SUCCESS");
}

async function loadImageInfo(rawUrl) {
  const candidates = getImageUrlCandidates(rawUrl);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const info = await loadImageFromUrl(candidate);
      return await cacheRemoteImage(info, rawUrl);
    } catch (error) {
      lastError = error;
    }
  }

  const driveHint = getGoogleDriveFileId(rawUrl)
    ? " Confira se o arquivo do Drive esta compartilhado com qualquer pessoa com o link."
    : "";

  throw new Error(`Nao consegui carregar esta imagem: ${rawUrl}.${driveHint}`, {
    cause: lastError,
  });
}

function isLocalAssetUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function cacheRemoteImage(info, originalUrl) {
  if (info.url.startsWith("blob:") || info.url.startsWith("data:") || isLocalAssetUrl(info.url)) {
    return info;
  }

  const isDriveUrl = Boolean(getGoogleDriveFileId(originalUrl));

  try {
    const response = await fetch(
      `./__remote_asset?url=${encodeURIComponent(info.url)}&name=${encodeURIComponent(
        getNameFromUrl(originalUrl, "image"),
      )}`,
    );

    if (!response.ok) {
      throw new Error("O servidor local nao conseguiu baixar a imagem remota.");
    }

    const payload = await response.json();
    if (!payload.url) {
      throw new Error("O servidor local nao retornou a imagem cacheada.");
    }

    return {
      ...info,
      url: payload.url,
    };
  } catch (error) {
    if (isDriveUrl) {
      throw new Error(
        "O Drive carregou no navegador, mas o servidor local nao conseguiu baixar a imagem. " +
          "Compartilhe o arquivo como qualquer pessoa com o link ou use os arquivos locais.",
        { cause: error },
      );
    }

    return info;
  }
}

function loadImageFromUrl(url, mimeOverride) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.onload = async () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error("A imagem carregou sem dimensoes validas."));
        return;
      }

      resolve({
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
        mime: mimeOverride || (await detectMime(url)),
      });
    };
    image.onerror = () => {
      reject(new Error(`Nao consegui carregar esta imagem: ${url}`));
    };
    image.src = url;
  });
}

async function detectMime(url) {
  if (url.startsWith("data:")) {
    return url.match(/^data:([^;,]+)/)?.[1] || "image/png";
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      mode: "cors",
    });
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();

    if (contentType?.startsWith("image/")) {
      return contentType;
    }
  } catch {
    return getMimeFromUrl(url);
  }

  return getMimeFromUrl(url);
}

function getSelectedFile(input) {
  return input.files?.[0] || null;
}

function getSelectedFiles(input) {
  return Array.from(input.files || []);
}

function imageInfoFromAsset(asset) {
  return {
    ...asset.image,
    name: asset.name || getNameFromUrl(asset.image.url, "Carta"),
  };
}

function setPreviewImage(image, url) {
  image.src = url;
  image.hidden = false;
}

function clearAsset(key) {
  if (key === "deckFronts") {
    selectedAssets.deckFronts = [];
    elements.deckAssetsStatus.textContent = "";
    return;
  }

  selectedAssets[key] = null;
}

async function pickSingleAsset(key, image, layerInput) {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para escolher assets.", "warning");
    return;
  }

  const [asset] = await obr.assets.downloadImages(false, "", layerInput.value);
  if (!asset) {
    return;
  }

  selectedAssets[key] = asset;
  setPreviewImage(image, asset.image.url);
  setMessage(`Asset "${asset.name}" selecionado.`, "success");
}

async function pickDeckFrontAssets() {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para escolher assets.", "warning");
    return;
  }

  const assets = await obr.assets.downloadImages(true, "", elements.deckLayer.value);
  if (!assets.length) {
    return;
  }

  selectedAssets.deckFronts = assets;
  elements.deckAssetsStatus.textContent =
    assets.length === 1 ? "1 frente selecionada dos assets." : `${assets.length} frentes selecionadas dos assets.`;
  setMessage(elements.deckAssetsStatus.textContent, "success");
}

async function loadFileImageInfo(file) {
  const previewUrl = URL.createObjectURL(file);

  try {
    const [info, uploadedUrl] = await Promise.all([
      loadImageFromUrl(previewUrl, file.type || getMimeFromUrl(file.name)),
      uploadLocalFile(file),
    ]);

    return {
      ...info,
      url: uploadedUrl,
      name: getNameFromFilename(file.name, "Carta"),
    };
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

async function uploadLocalFile(file) {
  const response = await fetch(`./__local_asset?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error("Nao consegui enviar o arquivo local para o servidor de teste.");
  }

  const payload = await response.json();
  if (!payload.url) {
    throw new Error("O servidor de teste nao retornou a URL do arquivo local.");
  }

  return payload.url;
}

async function loadImageInput(urlInput, fileInput, label, asset) {
  if (asset) {
    return imageInfoFromAsset(asset);
  }

  const file = getSelectedFile(fileInput);

  if (file) {
    return loadFileImageInfo(file);
  }

  const rawUrl = urlInput.value.trim();
  if (!rawUrl) {
    throw new Error(`Informe uma URL ou arquivo para ${label}.`);
  }

  const info = await loadImageInfo(rawUrl);
  return {
    ...info,
    name: getNameFromUrl(rawUrl, "Carta"),
  };
}

function updatePreview(urlInput, fileInput, image, asset) {
  if (asset) {
    setPreviewImage(image, asset.image.url);
    return;
  }

  const file = getSelectedFile(fileInput);

  if (file) {
    const previewUrl = URL.createObjectURL(file);
    image.onload = () => URL.revokeObjectURL(previewUrl);
    image.src = previewUrl;
    image.hidden = false;
    return;
  }

  const value = urlInput.value.trim();

  if (!value) {
    image.hidden = true;
    image.removeAttribute("src");
    return;
  }

  try {
    image.src = getImageUrlCandidates(value)[0];
    image.hidden = false;
  } catch {
    image.hidden = true;
    image.removeAttribute("src");
  }
}

async function getViewportCenter() {
  const [width, height] = await Promise.all([
    obr.viewport.getWidth(),
    obr.viewport.getHeight(),
  ]);

  return obr.viewport.inverseTransformPoint({
    x: width / 2,
    y: height / 2,
  });
}

function getNameFromFilename(filename, fallback) {
  return filename ? filename.replace(/\.[^.]+$/, "") : fallback;
}

function getNameFromUrl(rawUrl, fallback) {
  try {
    const path = new URL(rawUrl).pathname;
    const filename = path.split("/").filter(Boolean).pop();
    return filename ? decodeURIComponent(filename.replace(/\.[^.]+$/, "")) : fallback;
  } catch {
    return fallback;
  }
}

function getCardName(front) {
  const typedName = elements.name.value.trim();
  return typedName || front.name || getNameFromUrl(front.url, "Carta");
}

function getDeckName() {
  const typedName = elements.deckName.value.trim();
  return typedName || "Pilha";
}

function getSelectedPresetDeck() {
  const selectedId = elements.presetDeckSelect.value;
  return presetDecks.find((deck) => deck.id === selectedId) || null;
}

function setPresetDeckDefaultControls(deck) {
  if (!deck) {
    elements.presetDeckGridWidth.value = "2";
    elements.presetDeckLayer.value = "PROP";
    return;
  }

  elements.presetDeckGridWidth.value = String(deck.gridWidth || 2);
  if (
    [...elements.presetDeckLayer.options].some((option) => option.value === deck.layer)
  ) {
    elements.presetDeckLayer.value = deck.layer;
  } else {
    elements.presetDeckLayer.value = "PROP";
  }
}

function updatePresetDeckControls(isConnected = Boolean(obr), syncDefaults = false) {
  const hasDecks = presetDecks.length > 0;
  const deck = hasDecks ? getSelectedPresetDeck() : null;
  const isReady = isPresetDeckReady(deck);

  elements.presetDeckSelect.disabled = !hasDecks;
  elements.presetDeckGridWidth.disabled = !hasDecks;
  elements.presetDeckLayer.disabled = !hasDecks;
  elements.importPresetDeckButton.disabled = !isConnected || !isReady;

  if (syncDefaults) {
    setPresetDeckDefaultControls(deck);
  }

  if (!hasDecks) {
    elements.presetDeckInfo.textContent = "Nenhuma pilha cadastrada na biblioteca.";
    return;
  }

  if (!deck) {
    elements.presetDeckInfo.textContent = "Escolha uma pilha da biblioteca.";
    return;
  }

  if (!isReady) {
    elements.presetDeckInfo.textContent =
      "Esta pilha ja existe no catalogo, mas ainda precisa de verso e cartas.";
    return;
  }

  const count = deck.cards.length;
  elements.presetDeckInfo.textContent =
    count === 1
      ? `1 carta cadastrada. Padrao: ${deck.gridWidth} no grid.`
      : `${count} cartas cadastradas. Padrao: ${deck.gridWidth} no grid.`;
}

function populatePresetDeckSelect() {
  elements.presetDeckSelect.replaceChildren();

  if (!presetDecks.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhuma pilha cadastrada";
    elements.presetDeckSelect.append(option);
    updatePresetDeckControls(Boolean(obr), true);
    return;
  }

  for (const deck of presetDecks) {
    const option = document.createElement("option");
    option.value = deck.id;
    option.textContent = isPresetDeckReady(deck)
      ? `${deck.name} (${deck.cards.length})`
      : `${deck.name} (configurar imagens)`;
    elements.presetDeckSelect.append(option);
  }

  updatePresetDeckControls(Boolean(obr), true);
}

async function loadPresetLibrary() {
  presetDecks = await loadPresetDecks();
  populatePresetDeckSelect();
}

function getPresetDeckGridWidth() {
  const gridWidth = Number.parseFloat(elements.presetDeckGridWidth.value);

  if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
    throw new Error("A largura no grid da biblioteca precisa ser maior que zero.");
  }

  return gridWidth;
}

function parseDeckLines() {
  const lines = elements.deckFrontUrls.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("Informe pelo menos uma frente por URL ou arquivo para a pilha.");
  }

  return lines.map((line, index) => {
    const separatorIndex = line.indexOf("|");
    const rawName = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : "";
    const rawUrl = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : line;
    const url = normalizeUrl(rawUrl);
    const name = rawName || getNameFromUrl(url, `Carta ${index + 1}`);

    return { name, url };
  });
}

async function loadDeckFronts() {
  if (selectedAssets.deckFronts.length) {
    return selectedAssets.deckFronts.map((asset) => ({
      name: asset.name || "Carta",
      front: imageInfoFromAsset(asset),
    }));
  }

  const files = getSelectedFiles(elements.deckFrontFiles);

  if (files.length) {
    return Promise.all(
      files.map(async (file) => ({
        name: getNameFromFilename(file.name, "Carta"),
        front: await loadFileImageInfo(file),
      })),
    );
  }

  const cardLines = parseDeckLines();
  const fronts = await Promise.all(cardLines.map((card) => loadImageInfo(card.url)));

  return fronts.map((front, index) => ({
    name: cardLines[index].name,
    front,
  }));
}

async function addDeckToScene({ name, back, cards, gridWidth, layer }) {
  const position = await getViewportCenter();
  const metadata = createDeckMetadata({ name, back, cards, gridWidth });
  const item = buildImage(createImageData(back), createGridData(back, gridWidth))
    .name(`${name} (${cards.length})`)
    .description(deckDescription(cards.length))
    .text(createDeckText(cards.length))
    .layer(layer)
    .position(position)
    .metadata(createDeckMetadataMap(metadata))
    .build();

  await obr.scene.items.addItems([item]);
  return item;
}

async function createCard(event) {
  event.preventDefault();

  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para importar.", "warning");
    return;
  }

  setMessage("Carregando imagens...", "neutral");
  elements.importButton.disabled = true;

  try {
    const [front, back] = await Promise.all([
      loadImageInput(elements.frontUrl, elements.frontFile, "a frente", selectedAssets.front),
      loadImageInput(elements.backUrl, elements.backFile, "o verso", selectedAssets.back),
    ]);

    const gridWidth = Number.parseFloat(elements.gridWidth.value);
    if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
      throw new Error("A largura no grid precisa ser maior que zero.");
    }

    const name = getCardName(front);
    const position = await getViewportCenter();
    const metadata = createCardMetadata({ name, front, back, gridWidth });
    const item = buildImage(createImageData(front), createGridData(front, gridWidth))
      .name(name)
      .description("Carta dupla: frente")
      .layer(elements.layer.value)
      .position(position)
      .metadata(createCardMetadataMap(metadata))
      .build();

    await obr.scene.items.addItems([item]);
    await obr.notification.show(`Carta "${name}" importada.`);

    setMessage("Carta importada.", "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui importar a carta.", "error");
  } finally {
    elements.importButton.disabled = false;
  }
}

async function createDeck(event) {
  event.preventDefault();

  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para importar.", "warning");
    return;
  }

  setMessage("Carregando pilha...", "neutral");
  elements.importDeckButton.disabled = true;

  try {
    const [back, cards] = await Promise.all([
      loadImageInput(
        elements.deckBackUrl,
        elements.deckBackFile,
        "o verso da pilha",
        selectedAssets.deckBack,
      ),
      loadDeckFronts(),
    ]);
    const gridWidth = Number.parseFloat(elements.deckGridWidth.value);

    if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
      throw new Error("A largura no grid precisa ser maior que zero.");
    }

    const name = getDeckName();
    await addDeckToScene({
      name,
      back,
      cards,
      gridWidth,
      layer: elements.deckLayer.value,
    });
    await obr.notification.show(`Pilha "${name}" importada.`);

    setMessage("Pilha importada.", "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui importar a pilha.", "error");
  } finally {
    elements.importDeckButton.disabled = false;
  }
}

async function createPresetDeck() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para criar uma pilha.", "warning");
    return;
  }

  const deck = getSelectedPresetDeck();
  if (!deck) {
    setMessage("Escolha uma pilha da biblioteca.", "warning");
    return;
  }

  if (!isPresetDeckReady(deck)) {
    setMessage("Esta pilha ainda precisa de verso e cartas no catalogo.", "warning");
    return;
  }

  elements.importPresetDeckButton.disabled = true;
  setMessage("Criando pilha da biblioteca...", "neutral");

  try {
    const deckData = await buildPresetDeckData(deck);
    const gridWidth = getPresetDeckGridWidth();
    await addDeckToScene({
      ...deckData,
      gridWidth,
      layer: elements.presetDeckLayer.value || deckData.layer,
    });
    await obr.notification.show(`Pilha "${deckData.name}" criada.`);
    setMessage(`Pilha "${deckData.name}" criada da biblioteca.`, "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui criar a pilha da biblioteca.", "error");
  } finally {
    updatePresetDeckControls(Boolean(obr));
  }
}

async function init() {
  populateSelectionBoardControls();
  if (elements.form) {
    elements.form.addEventListener("submit", createCard);
  }
  if (elements.deckForm) {
    elements.deckForm.addEventListener("submit", createDeck);
  }
  elements.presetDeckSelect.addEventListener("change", () =>
    updatePresetDeckControls(Boolean(obr), true),
  );
  elements.importPresetDeckButton.addEventListener("click", () =>
    createPresetDeck().catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui criar a pilha da biblioteca.", "error");
    }),
  );
  loadPresetLibrary().catch((error) => {
    console.warn(error);
    presetDecks = [];
    populatePresetDeckSelect();
    elements.presetDeckInfo.textContent =
      error.message || "Nao consegui carregar a biblioteca de pilhas.";
  });
  elements.publicBaseUrl.value = getDefaultPublicBaseUrl();
  elements.panelFlipButton.addEventListener("click", () =>
    runPanelAction(elements.panelFlipButton, async () => {
      const count = await flipSelectedItems(obr, lastCardSelection);
      await showPanelActionResult(
        count,
        "Carta virada.",
        (total) => `${total} cartas viradas.`,
        "Selecione uma carta dupla para virar.",
      );
    }),
  );
  elements.panelDrawButton.addEventListener("click", () =>
    runPanelAction(elements.panelDrawButton, async () => {
      const count = await drawSelectedDecks(obr, buildImage, lastDeckSelection);
      await showPanelActionResult(
        count,
        "Carta comprada.",
        (total) => `${total} cartas compradas.`,
        "Selecione uma pilha com cartas para comprar.",
      );
    }),
  );
  elements.panelShuffleButton.addEventListener("click", () =>
    runPanelAction(elements.panelShuffleButton, async () => {
      const count = await shuffleSelectedDecks(obr, lastDeckSelection);
      await showPanelActionResult(
        count,
        "Pilha embaralhada.",
        (total) => `${total} pilhas embaralhadas.`,
        "Selecione uma pilha com pelo menos duas cartas.",
      );
    }),
  );
  elements.panelReturnButton.addEventListener("click", () =>
    runPanelAction(elements.panelReturnButton, async () => {
      const count = await returnSelectedCardsToDeck(
        obr,
        lastCardSelection,
        lastDeckSelection,
      );
      if (!count) {
        await showPanelActionResult(
          count,
          "",
          () => "",
          "Selecione uma carta comprada e uma pilha alvo.",
        );
        return;
      }

      setMessage("", "neutral");
    }),
  );
  elements.panelRepairButton.addEventListener("click", () =>
    runPanelAction(elements.panelRepairButton, async () => {
      const stats = await repairSceneMetadata();
      const total = stats.cards + stats.decks;

      if (!total) {
        const warning = "Nao encontrei cartas ou pilhas para sincronizar.";
        setMessage(warning, "warning");
        await obr.notification.show(warning, "WARNING");
        return;
      }

      const message = getRepairMessage(stats);
      setMessage(message, "success");
      await obr.notification.show(message, "SUCCESS");
    }),
  );
  elements.activeColorSelect.addEventListener("change", () => {
    const color = elements.activeColorSelect.value;

    if (!color || !obr) {
      return;
    }

    setActivePlayerColor(obr, color)
      .then(() => {
        syncColorControls(color);
        setMessage(`Cor ativa: ${getColorLabel(color)}.`, "success");
      })
      .catch((error) => {
        console.error(error);
        setMessage(error.message || "Nao consegui definir a cor.", "error");
      });
  });
  for (const button of elements.colorTokenButtons) {
    button.addEventListener("click", () =>
      runPanelAction(button, async () => {
        const color = await markSelectedTokenColor(obr, button.dataset.tokenColor);
        syncColorControls(color);
        const message = `Token marcado como ${getColorLabel(color)}.`;
        setMessage(message, "success");
        await obr.notification.show(message, "SUCCESS");
      }),
    );
  }
  elements.saveSlotButton.addEventListener("click", () =>
    runPanelAction(elements.saveSlotButton, async () => {
      const result = await saveSlotFromSelectedItem(
        obr,
        elements.slotColorSelect.value,
        elements.slotCategorySelect.value,
      );
      const message = `Slot salvo: ${getCategoryLabel(result.category)} de ${getColorLabel(result.color)}.`;
      setMessage(message, "success");
      await obr.notification.show(message, "SUCCESS");
    }),
  );
  for (const button of elements.categoryCardButtons) {
    button.addEventListener("click", () =>
      runPanelAction(button, async () => {
        const result = await markSelectedCardsCategory(obr, button.dataset.cardCategory);
        const cardLabel = result.count === 1 ? "1 carta" : `${result.count} cartas`;
        const message = `${cardLabel} marcadas como ${getCategoryLabel(result.category)}.`;
        setMessage(message, "success");
        await obr.notification.show(message, "SUCCESS");
      }),
    );
  }
  elements.returnOriginButton.addEventListener("click", () =>
    runPanelAction(elements.returnOriginButton, async () => {
      await returnSelectedCardToOrigin(obr);
      const message = "Carta devolvida para a posicao original.";
      setMessage(message, "success");
      await obr.notification.show(message, "SUCCESS");
    }),
  );
  if (elements.form && elements.deckForm) {
    elements.frontUrl.addEventListener("input", () =>
      clearAsset("front") ||
      updatePreview(elements.frontUrl, elements.frontFile, elements.frontPreview),
    );
    elements.frontFile.addEventListener("change", () =>
      clearAsset("front") ||
      updatePreview(elements.frontUrl, elements.frontFile, elements.frontPreview),
    );
    elements.pickFrontAssetButton.addEventListener("click", () =>
      pickSingleAsset("front", elements.frontPreview, elements.layer).catch((error) => {
        console.error(error);
        setMessage(error.message || "Nao consegui escolher a frente dos assets.", "error");
      }),
    );
    elements.backUrl.addEventListener("input", () =>
      clearAsset("back") ||
      updatePreview(elements.backUrl, elements.backFile, elements.backPreview),
    );
    elements.backFile.addEventListener("change", () =>
      clearAsset("back") ||
      updatePreview(elements.backUrl, elements.backFile, elements.backPreview),
    );
    elements.pickBackAssetButton.addEventListener("click", () =>
      pickSingleAsset("back", elements.backPreview, elements.layer).catch((error) => {
        console.error(error);
        setMessage(error.message || "Nao consegui escolher o verso dos assets.", "error");
      }),
    );
    elements.deckBackUrl.addEventListener("input", () =>
      clearAsset("deckBack") ||
      updatePreview(elements.deckBackUrl, elements.deckBackFile, elements.deckBackPreview),
    );
    elements.deckBackFile.addEventListener("change", () =>
      clearAsset("deckBack") ||
      updatePreview(elements.deckBackUrl, elements.deckBackFile, elements.deckBackPreview),
    );
    elements.pickDeckBackAssetButton.addEventListener("click", () =>
      pickSingleAsset("deckBack", elements.deckBackPreview, elements.deckLayer).catch((error) => {
        console.error(error);
        setMessage(error.message || "Nao consegui escolher o verso dos assets.", "error");
      }),
    );
    elements.deckFrontUrls.addEventListener("input", () => clearAsset("deckFronts"));
    elements.deckFrontFiles.addEventListener("change", () => clearAsset("deckFronts"));
    elements.pickDeckFrontAssetsButton.addEventListener("click", () =>
      pickDeckFrontAssets().catch((error) => {
        console.error(error);
        setMessage(error.message || "Nao consegui escolher as frentes dos assets.", "error");
      }),
    );
  }
  elements.migratePublicButton.addEventListener("click", () => {
    elements.migratePublicButton.disabled = true;
    setMessage("Migrando links locais da cena...", "neutral");
    migrateSceneLocalAssets()
      .catch((error) => {
        console.error(error);
        setMessage(error.message || "Nao consegui migrar os links locais.", "error");
      })
      .finally(() => {
        elements.migratePublicButton.disabled = !obr;
      });
  });
  elements.createDefaultBoardButton.addEventListener("click", () =>
    runPanelAction(elements.createDefaultBoardButton, createDefaultBoardFromCurrentScene),
  );
  elements.restoreDefaultBoardButton.addEventListener("click", () =>
    runPanelAction(elements.restoreDefaultBoardButton, restoreDefaultBoard),
  );

  if (elements.form && elements.deckForm) {
    updatePreview(elements.frontUrl, elements.frontFile, elements.frontPreview, selectedAssets.front);
    updatePreview(elements.backUrl, elements.backFile, elements.backPreview, selectedAssets.back);
    updatePreview(
      elements.deckBackUrl,
      elements.deckBackFile,
      elements.deckBackPreview,
      selectedAssets.deckBack,
    );
  }
  setConnectionStatus("Painel carregado; conectando...", false);
  setMessage("Previa ativa. Conectando ao Owlbear...", "neutral");

  try {
    const loaded =
      (await window.doubleSidedCardsSdkReady) ||
      (await import("./" + "sdk-client.js?v=38").then((sdkModule) =>
        sdkModule.loadOwlbearSdk(20000),
      ));
    obr = loaded.OBR;
    buildImage = loaded.sdk.buildImage;
    obr.broadcast
      .sendMessage(COMMANDS_CHANNEL, { type: "register-commands" }, { destination: "LOCAL" })
      .catch((error) => {
        console.warn("Nao consegui pedir o registro dos comandos", error);
    });
    const selection = await obr.player.getSelection();
    await Promise.all([rememberCardSelection(selection), rememberDeckSelection(selection)]);
    await refreshDefaultBoardInfo();
    obr.player.onChange((player) => {
      rememberCardSelection(player.selection).catch((error) => {
        console.warn("Nao consegui atualizar a selecao de cartas", error);
      });
      rememberDeckSelection(player.selection).catch((error) => {
        console.warn("Nao consegui atualizar a selecao de pilhas", error);
      });
      syncColorControls(player.metadata?.[ACTIVE_COLOR_KEY]?.color);
    });
    await refreshActiveColorControls();
    setConnectionStatus("Conectado ao Owlbear", true);
    setMessage("", "neutral");
  } catch (error) {
    console.warn(error);
    setConnectionStatus("Sem conexao ao SDK", false);
    setMessage(
      `A tela carregou, mas ainda nao conectou ao Owlbear: ${error.message}`,
      "warning",
    );
  }
}

init();
