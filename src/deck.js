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
const cardReturnQueues = new Map();

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

function uniqueCardIds(items) {
  return [...new Set(getCardItems(items).map((item) => item.id))];
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

async function withCardReturnLock(cardId, operation) {
  const previousOperation = cardReturnQueues.get(cardId) || Promise.resolve();
  const queuedOperation = previousOperation.catch(() => {}).then(operation);
  const storedOperation = queuedOperation.catch(() => {});

  cardReturnQueues.set(cardId, storedOperation);

  return queuedOperation.finally(() => {
    if (cardReturnQueues.get(cardId) === storedOperation) {
      cardReturnQueues.delete(cardId);
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

function getDrawPosition(deck, drawOffset, options) {
  const configuredPosition = options.drawPositionsByDeckId?.get(deck.id);

  return cloneSerializable(configuredPosition) || {
    x: deck.position.x + drawOffset,
    y: deck.position.y + drawOffset,
  };
}

function createDrawnCardItem(buildImage, operation) {
  const face = operation.drawnFace === "front" ? operation.drawnCard.front : operation.back;
  const cardMetadata = createCardMetadata({
    name: operation.drawnCard.name,
    front: operation.drawnCard.front,
    back: operation.back,
    gridWidth: operation.gridWidth,
    currentFace: operation.drawnFace,
    sourceDeckId: operation.deckId,
    sourceDeckName: operation.deckName,
  });
  const item = buildImage(
    createImageData(face),
    createGridData(face, operation.gridWidth),
  )
    .name(operation.drawnCard.name)
    .description(`Carta dupla: ${faceLabel(operation.drawnFace)}`)
    .layer(operation.layer)
    .position(operation.position)
    .metadata(createCardMetadataMap(cardMetadata))
    .build();

  applyCardFaceTransform(item, cardMetadata, operation.drawnFace);
  return item;
}

function summarizeDrawnItemForLog(item) {
  if (!item || typeof item !== "object") {
    return {
      exists: false,
      isPromise: Boolean(item?.then),
    };
  }

  let hasCardMetadata = false;

  try {
    hasCardMetadata = Boolean(getCardMetadata(item));
  } catch {
    hasCardMetadata = false;
  }

  return {
    exists: true,
    isPromise: Boolean(item.then),
    id: item.id,
    type: item.type,
    layer: item.layer,
    hasImageUrl: typeof item.image?.url === "string",
    hasGrid: Boolean(item.grid),
    hasPosition: Boolean(item.position),
    hasCardMetadata,
  };
}

function logDrawFailure(stage, error, operation, item) {
  console.warn(`Falha ao comprar carta durante ${stage}`, {
    errorName: error?.name,
    errorMessage: error?.message,
    deckId: operation?.deckId,
    deckName: operation?.deckName,
    cardName: operation?.drawnCard?.name,
    item: summarizeDrawnItemForLog(item),
  }, error);
}

function applyDrawToDeckDraft(deck, drawOffset, options) {
  const metadata = getDeckMetadata(deck);

  if (!metadata?.cards.length) {
    return null;
  }

  const drawnCard = cloneDeckCard(metadata.cards[0]);
  const remainingCards = metadata.cards.slice(1).map(cloneDeckCard);
  const drawnFace = currentDeckFace(metadata);
  const drawnPosition = getDrawPosition(deck, drawOffset, options);
  const nextMetadata = {
    ...metadata,
    cards: remainingCards,
    currentFace: drawnFace,
  };

  applyDeckDisplay(deck, nextMetadata);
  setDeckMetadata(deck, nextMetadata);

  const restoredPosition = options.deckPositionsById?.get(deck.id);
  if (restoredPosition) {
    deck.position = restoredPosition;
  }

  return {
    deckId: deck.id,
    deckName: metadata.name,
    layer: deck.layer,
    position: drawnPosition,
    back: cloneSerializable(metadata.back),
    gridWidth: metadata.gridWidth,
    drawnCard,
    drawnFace,
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
  let drawnItem = null;

  await OBR.scene.items.updateItems([deckId], (draftItems) => {
    const deck = draftItems[0];

    if (!deck) {
      return;
    }

    operation = applyDrawToDeckDraft(deck, drawOffset, options);
  });

  if (!operation) {
    return { count: 0, deckId, deckDeleted: false };
  }

  try {
    drawnItem = createDrawnCardItem(buildImage, operation);
  } catch (error) {
    logDrawFailure("montagem do item", error, operation, drawnItem);

    try {
      const rollbackSucceeded = await rollbackDrawnCard(OBR, operation);

      if (rollbackSucceeded) {
        throw new Error("Nao consegui montar a carta; a pilha foi restaurada.");
      }
    } catch (rollbackError) {
      if (rollbackError.message === "Nao consegui montar a carta; a pilha foi restaurada.") {
        throw rollbackError;
      }

      console.warn("Nao consegui restaurar a pilha apos falha ao montar carta", rollbackError);
      throw new Error(
        "Nao consegui montar a carta e tambem nao consegui restaurar a pilha automaticamente.",
      );
    }

    throw new Error(
      "Nao consegui montar a carta; a pilha mudou depois da compra e nao foi alterada de novo.",
    );
  }

  try {
    await OBR.scene.items.addItems([drawnItem]);
  } catch (error) {
    logDrawFailure("addItems", error, operation, drawnItem);

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

function createReturnedDeckCard(card, metadata) {
  return {
    name: metadata.name || card.name || "Carta",
    front: cloneSerializable(metadata.faces.front),
  };
}

function summarizeReturnOperationForLog(operation) {
  return {
    cardId: operation?.cardId,
    cardName: operation?.returnedCard?.name,
    deckId: operation?.deckId,
    deckName: operation?.deckName,
    preCount: operation?.preReturnCards?.length,
    postCount: operation?.postReturnCards?.length,
  };
}

function logReturnFailure(stage, error, operation, extra = {}) {
  console.warn(`Falha ao devolver carta durante ${stage}`, {
    errorName: error?.name,
    errorMessage: error?.message,
    ...summarizeReturnOperationForLog(operation),
    ...extra,
  }, error);
}

async function readCardById(OBR, cardId, stage) {
  try {
    const [item] = await OBR.scene.items.getItems([cardId]);
    return item || null;
  } catch (error) {
    logReturnFailure(`releitura da carta (${stage})`, error, { cardId });
    throw new Error("Nao consegui reler a carta para devolver.");
  }
}

async function readDeckById(OBR, deckId, stage) {
  try {
    const [item] = await OBR.scene.items.getItems([deckId]);
    return item || null;
  } catch (error) {
    logReturnFailure(`releitura da pilha (${stage})`, error, { deckId });
    throw new Error("Nao consegui reler a pilha de origem.");
  }
}

function getReturnSourceDeckId(card) {
  const metadata = getCardMetadata(card);
  const deckId = metadata?.sourceDeckId;

  return typeof deckId === "string" && deckId.length ? deckId : "";
}

function buildReturnOperation(card, deck, metadata, returnedCard) {
  const preReturnCards = metadata.cards.map(cloneDeckCard);
  const postReturnCards = [...preReturnCards, cloneDeckCard(returnedCard)];

  return {
    cardId: card.id,
    deckId: deck.id,
    deckName: metadata.name,
    returnedCard: cloneDeckCard(returnedCard),
    preReturnCards,
    postReturnCards,
  };
}

async function rollbackReturnedCard(OBR, operation) {
  let restored = false;

  await OBR.scene.items.updateItems([operation.deckId], (draftItems) => {
    const deck = draftItems[0];
    const metadata = deck ? getDeckMetadata(deck) : null;

    if (!metadata || !cardsMatch(metadata.cards, operation.postReturnCards)) {
      return;
    }

    const nextMetadata = {
      ...metadata,
      cards: operation.preReturnCards.map(cloneDeckCard),
      currentFace: currentDeckFace(metadata),
    };

    applyDeckDisplay(deck, nextMetadata);
    setDeckMetadata(deck, nextMetadata);
    restored = true;
  });

  return restored;
}

async function applyReturnToDeck(OBR, cardSnapshot, deckId) {
  let operation = null;
  const cardId = cardSnapshot.id;
  const cardMetadata = getCardMetadata(cardSnapshot);

  if (!cardMetadata) {
    return null;
  }

  await OBR.scene.items.updateItems([deckId], (draftItems) => {
    const deck = draftItems[0];
    const metadata = deck ? getDeckMetadata(deck) : null;

    if (!metadata) {
      return;
    }

    const returnedCard = createReturnedDeckCard(cardSnapshot, cardMetadata);
    operation = buildReturnOperation(cardSnapshot, deck, metadata, returnedCard);
    const nextMetadata = {
      ...metadata,
      cards: operation.postReturnCards.map(cloneDeckCard),
      currentFace: currentDeckFace(metadata),
    };

    applyDeckDisplay(deck, nextMetadata);
    setDeckMetadata(deck, nextMetadata);
  });

  if (!operation) {
    console.warn("Nao encontrei a pilha de origem durante a devolucao", { cardId, deckId });
    return null;
  }

  return operation;
}

async function deleteReturnedCardOrReconcile(OBR, operation) {
  try {
    await OBR.scene.items.deleteItems([operation.cardId]);
    return true;
  } catch (error) {
    logReturnFailure("deleteItems", error, operation);
  }

  const currentCard = await readCardById(OBR, operation.cardId, "apos falha de exclusao");

  if (!currentCard) {
    console.warn("deleteItems falhou, mas a carta ja nao existe na cena", {
      cardId: operation.cardId,
      deckId: operation.deckId,
    });
    return true;
  }

  let rollbackSucceeded = false;

  try {
    rollbackSucceeded = await rollbackReturnedCard(OBR, operation);
  } catch (rollbackError) {
    logReturnFailure("rollback", rollbackError, operation);
    throw new Error(
      "Nao consegui apagar a carta e tambem nao consegui restaurar a pilha automaticamente.",
    );
  }

  if (rollbackSucceeded) {
    console.warn("Rollback seguro realizado apos falha ao apagar carta devolvida", {
      cardId: operation.cardId,
      deckId: operation.deckId,
    });
    throw new Error("Nao consegui apagar a carta; a pilha foi restaurada.");
  }

  console.warn("Rollback recusado porque a pilha mudou apos a devolucao", {
    cardId: operation.cardId,
    deckId: operation.deckId,
  });
  throw new Error(
    "Nao consegui apagar a carta; a pilha mudou depois da devolucao e nao foi alterada de novo.",
  );
}

async function returnSingleCardToDeck(OBR, cardId) {
  const initialCard = await readCardById(OBR, cardId, "inicial");

  if (!initialCard) {
    console.warn("A carta selecionada ja nao existe na cena", { cardId });
    return { count: 0, deckId: null };
  }

  if (!getCardMetadata(initialCard)) {
    console.warn("A carta selecionada nao tem metadata valida para devolucao", { cardId });
    return { count: 0, deckId: null };
  }

  const sourceDeckId = getReturnSourceDeckId(initialCard);

  if (!sourceDeckId) {
    console.warn("A carta selecionada nao possui pilha de origem", { cardId });
    return { count: 0, deckId: null };
  }

  return withDeckOperationLock(sourceDeckId, async () => {
    const currentCard = await readCardById(OBR, cardId, "dentro da fila da pilha");

    if (!currentCard) {
      console.warn("A carta desapareceu antes da devolucao ser aplicada", {
        cardId,
        deckId: sourceDeckId,
      });
      return { count: 0, deckId: null };
    }

    const cardMetadata = getCardMetadata(currentCard);

    if (!cardMetadata) {
      console.warn("A carta deixou de ser devolvivel antes da devolucao", {
        cardId,
        deckId: sourceDeckId,
      });
      return { count: 0, deckId: null };
    }

    const currentSourceDeckId = getReturnSourceDeckId(currentCard);

    if (currentSourceDeckId !== sourceDeckId) {
      console.warn("A pilha de origem da carta mudou antes da devolucao", {
        cardId,
        originalDeckId: sourceDeckId,
        currentDeckId: currentSourceDeckId,
      });
      return { count: 0, deckId: null };
    }

    const sourceDeck = await readDeckById(OBR, sourceDeckId, "antes da devolucao");

    if (!sourceDeck || !getDeckMetadata(sourceDeck)) {
      console.warn("A pilha de origem nao existe ou nao e mais uma pilha", {
        cardId,
        deckId: sourceDeckId,
      });
      return { count: 0, deckId: null };
    }

    let operation = null;

    try {
      operation = await applyReturnToDeck(OBR, currentCard, sourceDeckId);
    } catch (error) {
      logReturnFailure("updateItems", error, { cardId, deckId: sourceDeckId });
      throw new Error("Nao consegui atualizar a pilha para devolver a carta.");
    }

    if (!operation) {
      return { count: 0, deckId: null };
    }

    await deleteReturnedCardOrReconcile(OBR, operation);
    return { count: 1, deckId: sourceDeckId };
  });
}

export async function returnCardsToDeck(OBR, cards, fallbackDeckSelection = []) {
  const cardIds = uniqueCardIds(cards);

  if (!cardIds.length) {
    return 0;
  }

  void fallbackDeckSelection;

  let count = 0;
  const returnedDeckIds = new Set();

  for (const cardId of cardIds) {
    const result = await withCardReturnLock(cardId, () =>
      returnSingleCardToDeck(OBR, cardId),
    );

    count += result.count;
    if (result.deckId) {
      returnedDeckIds.add(result.deckId);
    }
  }

  if (returnedDeckIds.size) {
    await selectDecks(OBR, [...returnedDeckIds]);
  }

  return count;
}

export async function returnSelectedCardsToDeck(
  OBR,
  fallbackCardSelection = [],
  fallbackDeckSelection = [],
) {
  const cards = await getSelectedCardItems(OBR, fallbackCardSelection);
  return returnCardsToDeck(OBR, cards, fallbackDeckSelection);
}
