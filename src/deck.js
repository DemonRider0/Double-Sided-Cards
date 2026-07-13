import {
  applyCardFaceTransform,
  createCardMetadata,
  createCardMetadataMap,
  createGridData,
  createImageData,
  deckDescription,
  faceLabel,
  getCardMetadata,
  getDeckMetadata,
  isCardMetadata,
  isDeckMetadata,
  setCardMetadata,
  setDeckMetadata,
} from "./card-data.js";

export function getDeckItems(items) {
  return items.filter((item) => isDeckMetadata(getDeckMetadata(item)));
}

export function getCardItems(items) {
  return items.filter((item) => isCardMetadata(getCardMetadata(item)));
}

const deckOperationQueues = new Map();
const activeDeckOperationIds = new Set();

function cloneSerializable(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cloneDeckCard(card) {
  return cloneSerializable(card);
}

function cardsMatch(leftCards, rightCards) {
  return JSON.stringify(leftCards) === JSON.stringify(rightCards);
}

function currentDeckFace(metadata) {
  return metadata.currentFace === "front" ? "front" : "back";
}

function uniqueDeckIds(items) {
  return [...new Set(getDeckItems(items).map((item) => item.id))];
}

async function withDeckOperationLock(deckId, operation) {
  const previousOperation = deckOperationQueues.get(deckId) || Promise.resolve();
  const queuedOperation = previousOperation.catch(() => {}).then(async () => {
    activeDeckOperationIds.add(deckId);

    try {
      return await operation();
    } finally {
      activeDeckOperationIds.delete(deckId);
    }
  });
  const storedOperation = queuedOperation.catch(() => {});

  deckOperationQueues.set(deckId, storedOperation);

  return queuedOperation.finally(() => {
    if (deckOperationQueues.get(deckId) === storedOperation) {
      deckOperationQueues.delete(deckId);
    }
  });
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

function getDeckFace(metadata) {
  if (metadata.currentFace === "front" && metadata.cards[0]?.front) {
    return metadata.cards[0].front;
  }

  return metadata.back;
}

export function applyDeckDisplay(item, metadata) {
  const count = metadata.cards.length;
  const face = getDeckFace(metadata);

  item.name = `${metadata.name} (${count})`;
  item.description = deckDescription(count);
  item.text = createDeckText(count);
  item.image = createImageData(face);
  item.grid = createGridData(face, metadata.gridWidth);
}

function isDeckDisplayCurrent(item, metadata) {
  const count = metadata.cards.length;
  const face = getDeckFace(metadata);

  return (
    item.name === `${metadata.name} (${count})` &&
    item.description === deckDescription(count) &&
    item.text?.plainText === String(count) &&
    item.image?.url === face.url
  );
}

export async function syncDeckDisplays(OBR, items) {
  const deckItems = getDeckItems(items);
  const emptyTransientDeckIds = new Set(
    deckItems
      .filter((item) => {
        const metadata = getDeckMetadata(item);
        return Boolean(
          metadata?.deleteWhenEmpty &&
            metadata.cards.length === 0 &&
            !activeDeckOperationIds.has(item.id),
        );
      })
      .map((item) => item.id),
  );

  if (emptyTransientDeckIds.size) {
    await OBR.scene.items.deleteItems([...emptyTransientDeckIds]).catch(() => {});
  }

  const decks = deckItems.filter(
    (item) => !emptyTransientDeckIds.has(item.id) && !isDeckDisplayCurrent(item, getDeckMetadata(item)),
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

async function getDrawOffset(OBR) {
  try {
    return Math.max(48, (await OBR.scene.grid.getDpi()) * 0.6);
  } catch {
    return 80;
  }
}

async function selectDecks(OBR, deckIds) {
  if (!deckIds.length) {
    return;
  }

  await OBR.player.select(deckIds, true).catch(() => {});
}

function createDrawnCardItem(buildImage, deck, metadata, card, drawnFace, drawOffset, options) {
  const face = drawnFace === "front" ? card.front : metadata.back;
  const cardMetadata = createCardMetadata({
    name: card.name,
    front: card.front,
    back: metadata.back,
    gridWidth: metadata.gridWidth,
    currentFace: drawnFace,
    sourceDeckId: deck.id,
    sourceDeckName: metadata.name,
  });
  const position = options.drawPositionsByDeckId?.get(deck.id) || {
    x: deck.position.x + drawOffset,
    y: deck.position.y + drawOffset,
  };
  const item = buildImage(
    createImageData(face),
    createGridData(face, metadata.gridWidth),
  )
    .name(card.name)
    .description(`Carta dupla: ${faceLabel(drawnFace)}`)
    .layer(deck.layer)
    .position(position)
    .metadata(createCardMetadataMap(cardMetadata))
    .build();

  applyCardFaceTransform(item, cardMetadata, drawnFace);
  return item;
}

function applyDrawToDeckDraft(buildImage, deck, drawOffset, options) {
  const metadata = getDeckMetadata(deck);

  if (!metadata?.cards.length) {
    return null;
  }

  const drawnCard = cloneDeckCard(metadata.cards[0]);
  const remainingCards = metadata.cards.slice(1).map(cloneDeckCard);
  const drawnFace = currentDeckFace(metadata);
  const drawnItem = createDrawnCardItem(
    buildImage,
    deck,
    metadata,
    drawnCard,
    drawnFace,
    drawOffset,
    options,
  );
  const nextMetadata = {
    ...metadata,
    cards: remainingCards,
    currentFace: currentDeckFace(metadata),
  };

  applyDeckDisplay(deck, nextMetadata);
  setDeckMetadata(deck, nextMetadata);

  const restoredPosition = options.deckPositionsById?.get(deck.id);
  if (restoredPosition) {
    deck.position = restoredPosition;
  }

  return {
    deckId: deck.id,
    drawnCard,
    drawnItem,
    remainingCards,
    deleteWhenEmpty: Boolean(metadata.deleteWhenEmpty && remainingCards.length === 0),
  };
}

async function rollbackDrawnCard(OBR, operation) {
  let restored = false;

  await OBR.scene.items.updateItems([operation.deckId], (draftItems) => {
    const deck = draftItems[0];
    const metadata = deck ? getDeckMetadata(deck) : null;

    if (!metadata || !cardsMatch(metadata.cards, operation.remainingCards)) {
      return;
    }

    const nextMetadata = {
      ...metadata,
      cards: [cloneDeckCard(operation.drawnCard), ...metadata.cards.map(cloneDeckCard)],
      currentFace: currentDeckFace(metadata),
    };

    applyDeckDisplay(deck, nextMetadata);
    setDeckMetadata(deck, nextMetadata);
    restored = true;
  });

  return restored;
}

async function drawSingleDeck(OBR, buildImage, deckId, drawOffset, options) {
  let operation = null;

  await OBR.scene.items.updateItems([deckId], (draftItems) => {
    const deck = draftItems[0];

    if (!deck) {
      return;
    }

    operation = applyDrawToDeckDraft(buildImage, deck, drawOffset, options);
  });

  if (!operation) {
    return { count: 0, deckId, deckDeleted: false };
  }

  try {
    await OBR.scene.items.addItems([operation.drawnItem]);
  } catch (error) {
    let rollbackSucceeded = false;

    try {
      rollbackSucceeded = await rollbackDrawnCard(OBR, operation);
    } catch (rollbackError) {
      console.warn("Nao consegui restaurar a pilha apos falha ao comprar carta", rollbackError);
      throw new Error(
        "Nao consegui criar a carta e tambem nao consegui restaurar a pilha automaticamente.",
      );
    }

    if (rollbackSucceeded) {
      throw new Error("Nao consegui criar a carta; a pilha foi restaurada.");
    }

    console.warn("Compra parcial sem rollback seguro", error);
    throw new Error(
      "Nao consegui criar a carta; a pilha mudou depois da compra e nao foi alterada de novo.",
    );
  }

  if (operation.deleteWhenEmpty) {
    try {
      await OBR.scene.items.deleteItems([operation.deckId]);
      return { count: 1, deckId, deckDeleted: true };
    } catch (error) {
      console.warn("Carta comprada, mas nao consegui apagar a pilha temporaria vazia", error);
      await OBR.notification
        .show("Carta comprada, mas nao consegui apagar a pilha vazia.", "WARNING")
        .catch(() => {});
    }
  }

  return { count: 1, deckId, deckDeleted: false };
}

export async function drawFromDecks(OBR, buildImage, items, options = {}) {
  const deckIds = uniqueDeckIds(items);

  if (!deckIds.length) {
    return 0;
  }

  const offset = await getDrawOffset(OBR);
  const results = await Promise.all(
    deckIds.map((deckId, index) =>
      withDeckOperationLock(deckId, () =>
        drawSingleDeck(OBR, buildImage, deckId, offset * (index + 1), options),
      ),
    ),
  );
  const count = results.reduce((total, result) => total + result.count, 0);
  const remainingDeckIds = results
    .filter((result) => result.count && !result.deckDeleted)
    .map((result) => result.deckId);

  if (count) {
    await selectDecks(OBR, remainingDeckIds);
  }

  return count;
}

async function getSelectedDeckItems(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();
  const itemIds = selection?.length ? selection : fallbackSelection;

  if (!itemIds.length) {
    return [];
  }

  try {
    return getDeckItems(await OBR.scene.items.getItems(itemIds));
  } catch {
    return [];
  }
}

export async function drawSelectedDecks(OBR, buildImage, fallbackSelection = []) {
  const decks = await getSelectedDeckItems(OBR, fallbackSelection);
  return drawFromDecks(OBR, buildImage, decks);
}

export async function shuffleDecks(OBR, items) {
  const deckIds = uniqueDeckIds(items);

  if (!deckIds.length) {
    return 0;
  }

  const results = await Promise.all(
    deckIds.map((deckId) =>
      withDeckOperationLock(deckId, async () => {
        let shuffled = false;

        await OBR.scene.items.updateItems([deckId], (draftItems) => {
          const item = draftItems[0];
          const metadata = item ? getDeckMetadata(item) : null;

          if (!metadata || metadata.cards.length <= 1) {
            return;
          }

          const nextMetadata = {
            ...metadata,
            cards: shuffleCards(metadata.cards),
          };

          applyDeckDisplay(item, nextMetadata);
          setDeckMetadata(item, nextMetadata);
          shuffled = true;
        });

        return shuffled ? 1 : 0;
      }),
    ),
  );

  return results.reduce((total, count) => total + count, 0);
}

export async function flipDeckItems(OBR, items) {
  const decks = getDeckItems(items).filter(
    (item) => getDeckMetadata(item).cards.length > 0,
  );

  if (!decks.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const item of draftItems) {
      const metadata = getDeckMetadata(item);
      const nextMetadata = {
        ...metadata,
        currentFace: metadata.currentFace === "front" ? "back" : "front",
      };

      applyDeckDisplay(item, nextMetadata);
      setDeckMetadata(item, nextMetadata);
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

  try {
    return getCardItems(await OBR.scene.items.getItems(itemIds));
  } catch {
    return [];
  }
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
    const sourceDecks = await OBR.scene.items
      .getItems(sourceDeckIds)
      .then(getDeckItems)
      .catch(() => []);
    if (sourceDecks.length) {
      return sourceDecks[0];
    }
  }

  if (fallbackDeckSelection.length) {
    const fallbackDecks = await OBR.scene.items
      .getItems(fallbackDeckSelection)
      .then(getDeckItems)
      .catch(() => []);
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

  const returnedCards = cardsToReturn.map((item) => {
    const metadata = getCardMetadata(item);

    return {
      name: metadata.name || item.name || "Carta",
      front: metadata.faces.front,
    };
  });
  const returnedCardIds = cardsToReturn.map((item) => item.id);

  await OBR.scene.items.updateItems([targetDeck], (items) => {
    const item = items[0];
    const metadata = getDeckMetadata(item);
    const nextMetadata = {
      ...metadata,
      cards: [...metadata.cards, ...returnedCards],
      currentFace: metadata.currentFace === "front" ? "front" : "back",
    };

    applyDeckDisplay(item, nextMetadata);
    setDeckMetadata(item, nextMetadata);
  });

  await OBR.scene.items.deleteItems(returnedCardIds);
  await selectDecks(OBR, [targetDeck.id]);

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
