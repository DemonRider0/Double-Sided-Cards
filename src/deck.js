import {
  createCardMetadata,
  createCardMetadataMap,
  createGridData,
  createImageData,
  deckDescription,
  getCardMetadata,
  getDeckMetadata,
  isCardMetadata,
  isDeckMetadata,
  setCardMetadata,
  setDeckMetadata,
} from "./card-data.js";

const RETURN_LOCK_MS = 30000;
const RETURN_LOCK_SETTLE_MS = 180;
const DRAW_EVENT_DEDUPE_MS = 30000;
const DRAW_POST_LOCK_MS = 1200;

export function getDeckItems(items) {
  return items.filter((item) => isDeckMetadata(getDeckMetadata(item)));
}

export function getCardItems(items) {
  return items.filter((item) => isCardMetadata(getCardMetadata(item)));
}

export function createDeckText(count) {
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

function isDeckDisplayCurrent(item, metadata) {
  const count = metadata.cards.length;

  return (
    item.name === `${metadata.name} (${count})` &&
    item.description === deckDescription(count) &&
    item.text?.plainText === String(count)
  );
}

export async function syncDeckDisplays(OBR, items) {
  const decks = getDeckItems(items).filter(
    (item) => !isDeckDisplayCurrent(item, getDeckMetadata(item)),
  );

  if (!decks.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const item of draftItems) {
      const metadata = getDeckMetadata(item);
      applyDeckDisplay(item, metadata);
      setDeckMetadata(item, metadata);
    }
  });

  return decks.length;
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

function isActiveTimedEntry(entry, now = Date.now()) {
  return Boolean(
    entry &&
      typeof entry === "object" &&
      typeof entry.expiresAt === "number" &&
      entry.expiresAt > now,
  );
}

function getActiveTimedEntries(entries, now = Date.now()) {
  if (!entries || typeof entries !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => isActiveTimedEntry(entry, now)),
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

export async function drawFromDecks(OBR, buildImage, items, options = {}) {
  const decks = getDeckItems(items).filter(
    (item) => getDeckMetadata(item).cards.length > 0,
  );

  if (!decks.length) {
    return 0;
  }

  const offset = await getDrawOffset(OBR);
  const drawnItems = [];

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const [index, item] of draftItems.entries()) {
      const metadata = getDeckMetadata(item);

      if (!metadata?.cards?.length) {
        continue;
      }

      const expectedDraw = options.expectedDrawsByDeckId?.get(item.id);
      const now = Date.now();
      const handledDragDraws = getActiveTimedEntries(metadata.handledDragDraws, now);

      if (expectedDraw) {
        const alreadyHandled = isActiveTimedEntry(
          handledDragDraws[expectedDraw.signature],
          now,
        );
        const matchingLock = metadata.dragDrawLock?.id === expectedDraw.lockId;
        const matchingPending =
          metadata.pendingDragDraw?.signature === expectedDraw.signature;

        if (alreadyHandled || !matchingLock || !matchingPending) {
          continue;
        }
      }

      const [card, ...remainingCards] = metadata.cards;
      const drawOffset = offset * (index + 1);
      const position = options.drawPositionsByDeckId?.get(item.id) || {
        x: item.position.x + drawOffset,
        y: item.position.y + drawOffset,
      };
      const cardMetadata = createCardMetadata({
        name: card.name,
        front: card.front,
        back: metadata.back,
        gridWidth: metadata.gridWidth,
        currentFace: "back",
        sourceDeckId: item.id,
        sourceDeckName: metadata.name,
      });
      const drawnItem = buildImage(
        createImageData(metadata.back),
        createGridData(metadata.back, metadata.gridWidth),
      )
        .name(card.name)
        .description("Carta dupla: verso")
        .layer(item.layer)
        .position(position)
        .metadata(createCardMetadataMap(cardMetadata))
        .build();

      const nextMetadata = {
        ...metadata,
        cards: remainingCards,
      };

      if (expectedDraw) {
        nextMetadata.handledDragDraws = {
          ...handledDragDraws,
          [expectedDraw.signature]: {
            id: expectedDraw.lockId,
            expiresAt: now + DRAW_EVENT_DEDUPE_MS,
          },
        };
        nextMetadata.dragDrawLock = {
          ...(metadata.dragDrawLock || {}),
          expiresAt: now + DRAW_POST_LOCK_MS,
        };
      }

      drawnItems.push(drawnItem);
      applyDeckDisplay(item, nextMetadata);
      setDeckMetadata(item, nextMetadata);

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

export async function drawSelectedDecks(OBR, buildImage, fallbackSelection = []) {
  const decks = await getSelectedDeckItems(OBR, fallbackSelection);
  return drawFromDecks(OBR, buildImage, decks);
}

export async function shuffleDecks(OBR, items) {
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

export async function shuffleSelectedDecks(OBR, fallbackSelection = []) {
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

export async function returnCardsToDeck(OBR, cards, fallbackDeckSelection = []) {
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

export async function returnSelectedCardsToDeck(
  OBR,
  fallbackCardSelection = [],
  fallbackDeckSelection = [],
) {
  const cards = await getSelectedCardItems(OBR, fallbackCardSelection);
  return returnCardsToDeck(OBR, cards, fallbackDeckSelection);
}
