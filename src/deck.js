import {
  applyCardFaceTransform,
  cloneMetadataValue,
  createCardMetadata,
  createCardMetadataMap,
  createDeckMetadata,
  createDeckMetadataMap,
  createGridData,
  createImageData,
  deckDescription,
  faceLabel,
  getCardMetadata,
  getDeckMetadata,
  isCardMetadata,
  isDeckMetadata,
  metadataValuesEqual,
  normalizeCardMetadata,
  normalizeDeckMetadata,
  setDeckMetadata,
  shouldMirrorCardBack,
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
const activeMissionDeckCreations = new Set();
const CARD_METADATA_FIELDS = new Set([
  "version",
  "name",
  "currentFace",
  "gridWidth",
  "mirrorBack",
  "faces",
  "origin",
  "sourceDeckId",
  "sourceDeckName",
]);
const DECK_CARD_FIELDS = new Set([
  "name",
  "front",
  "back",
  "gridWidth",
  "origin",
  "mirrorBack",
  "description",
]);

function cloneSerializable(value) {
  return cloneMetadataValue(value);
}

function cloneDeckCard(card) {
  return cloneSerializable(card);
}

function cloneUnknownFields(value, knownFields) {
  const unknownFields = {};

  for (const [key, entry] of Object.entries(value || {})) {
    if (!knownFields.has(key)) {
      unknownFields[key] = cloneSerializable(entry);
    }
  }

  return unknownFields;
}

function cardsMatch(leftCards, rightCards) {
  return metadataValuesEqual(leftCards, rightCards);
}

function currentDeckFace(metadata) {
  return metadata.currentFace === "front" ? "front" : "back";
}

function summarizeMetadataFailure(item, result) {
  return {
    itemId: item?.id,
    itemName: item?.name,
    code: result?.code,
    cardIndex: result?.cardIndex,
    cause: result?.cause,
  };
}

function getNormalizedCard(item, operation = "", logFailure = false) {
  const result = normalizeCardMetadata(getCardMetadata(item), { item });

  if (!result.ok && logFailure) {
    console.warn(`Carta incompativel durante ${operation}`, summarizeMetadataFailure(item, result));
  }

  return result.ok ? result.value : null;
}

function getNormalizedDeck(item, operation = "", logFailure = false) {
  const result = normalizeDeckMetadata(getDeckMetadata(item), { item });

  if (!result.ok && logFailure) {
    console.warn(`Pilha incompativel durante ${operation}`, summarizeMetadataFailure(item, result));
  }

  return result.ok ? result.value : null;
}

function requireNormalizedDeck(item, operation) {
  const metadata = getNormalizedDeck(item, operation, true);

  if (!metadata) {
    throw new Error(`Esta pilha possui dados incompletos e nao pode ser ${operation}.`);
  }

  return metadata;
}

function positiveGridWidth(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
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
  const grid = createGridData(face, metadata.gridWidth);

  return (
    item.name === `${metadata.name} (${count})` &&
    item.description === deckDescription(count) &&
    item.text?.plainText === String(count) &&
    item.image?.url === face.url &&
    item.grid?.dpi === grid.dpi &&
    item.grid?.offset?.x === grid.offset.x &&
    item.grid?.offset?.y === grid.offset.y
  );
}

export async function syncDeckDisplays(OBR, items) {
  const deckItems = getDeckItems(items);
  const normalizedDeckItems = deckItems
    .map((item) => ({
      item,
      metadata: getNormalizedDeck(item),
    }))
    .filter((entry) => entry.metadata);
  const emptyTransientDeckIds = new Set(
    normalizedDeckItems
      .filter(({ item, metadata }) => {
        return Boolean(
          metadata?.deleteWhenEmpty &&
            metadata.cards.length === 0 &&
            !activeDeckOperationIds.has(item.id),
        );
      })
      .map(({ item }) => item.id),
  );

  if (emptyTransientDeckIds.size) {
    await OBR.scene.items.deleteItems([...emptyTransientDeckIds]).catch(() => {});
  }

  const decks = normalizedDeckItems.filter(
    ({ item, metadata }) =>
      !emptyTransientDeckIds.has(item.id) && !isDeckDisplayCurrent(item, metadata),
  );

  if (!decks.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(decks.map(({ item }) => item), (draftItems) => {
    for (const item of draftItems) {
      const metadata = getNormalizedDeck(item);

      if (!metadata) {
        continue;
      }

      applyDeckDisplay(item, metadata);
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

function sameItemIds(leftIds, rightIds) {
  if (leftIds.length !== rightIds.length) {
    return false;
  }

  const rightSet = new Set(rightIds);
  return rightSet.size === rightIds.length && leftIds.every((id) => rightSet.has(id));
}

function missionCreationKey(itemIds) {
  return [...itemIds].sort().join("|");
}

function getAverageItemPosition(items) {
  const positionedItems = items.filter(
    (item) => Number.isFinite(item.position?.x) && Number.isFinite(item.position?.y),
  );

  if (!positionedItems.length) {
    return null;
  }

  return {
    x:
      positionedItems.reduce((sum, item) => sum + item.position.x, 0) /
      positionedItems.length,
    y:
      positionedItems.reduce((sum, item) => sum + item.position.y, 0) /
      positionedItems.length,
  };
}

function createMissionDeckEntry(item) {
  const metadata = getNormalizedCard(item, "criacao da pilha de missao", true);

  if (!metadata) {
    return null;
  }

  const entry = {
    ...cloneUnknownFields(metadata, CARD_METADATA_FIELDS),
    name: metadata.name || item.name || "Carta",
    front: cloneSerializable(metadata.faces.front),
    back: cloneSerializable(metadata.faces.back),
    gridWidth: metadata.gridWidth,
    mirrorBack: shouldMirrorCardBack(metadata),
  };

  if (metadata.origin) {
    entry.origin = cloneSerializable(metadata.origin);
  }

  if (
    typeof item.description === "string" &&
    !/^Carta dupla:\s*(frente|verso)$/i.test(item.description.trim())
  ) {
    entry.description = item.description;
  }

  return entry;
}

function createMissionDeckItem(buildImage, selectedCards, shuffledRecords) {
  const firstMetadata = getNormalizedCard(
    selectedCards[0],
    "criacao da pilha de missao",
    true,
  );

  if (!firstMetadata) {
    throw new Error("A primeira carta da pilha de missao possui dados incompletos.");
  }

  const cards = shuffledRecords.map((record) => cloneDeckCard(record.entry));
  const back = cloneSerializable(firstMetadata.faces.back);
  const gridWidth = positiveGridWidth(firstMetadata.gridWidth, 1.5);
  const metadata = createDeckMetadata({
    name: "Salas da Missao",
    back,
    cards,
    gridWidth,
    deleteWhenEmpty: true,
  });
  const position = getAverageItemPosition(selectedCards) || { x: 0, y: 0 };
  const item = buildImage(createImageData(back), createGridData(back, gridWidth))
    .name(`Salas da Missao (${cards.length})`)
    .description(deckDescription(cards.length))
    .text(createDeckText(cards.length))
    .layer(selectedCards[0].layer || "PROP")
    .position(position)
    .metadata(createDeckMetadataMap(metadata))
    .build();

  return {
    item,
    initialMetadata: cloneSerializable(metadata),
    position: cloneSerializable(position),
    layer: item.layer,
    records: shuffledRecords.map((record) => ({
      sourceId: record.sourceId,
      entry: cloneDeckCard(record.entry),
    })),
  };
}

function missionDeckMatchesInitial(item, operation) {
  const metadata = item ? getNormalizedDeck(item) : null;

  return Boolean(
    metadata &&
      metadataValuesEqual(metadata, operation.initialMetadata) &&
      item.name === operation.deckName &&
      item.layer === operation.layer &&
      item.position?.x === operation.position.x &&
      item.position?.y === operation.position.y,
  );
}

function summarizeMissionOperation(operation, extra = {}) {
  return {
    deckId: operation?.deckId,
    sourceIds: operation?.sourceIds,
    remainingSourceIds: extra.remainingSourceIds,
    remainingCount: extra.remainingSourceIds?.length,
  };
}

function logMissionDeckFailure(stage, error, operation, extra = {}) {
  console.warn(
    `Falha ao criar pilha de missao durante ${stage}`,
    {
      errorName: error?.name,
      errorMessage: error?.message,
      ...summarizeMissionOperation(operation, extra),
    },
    error,
  );
}

async function getItemsByIdsForMission(OBR, itemIds, stage, operation = null) {
  try {
    return await OBR.scene.items.getItems(itemIds);
  } catch (error) {
    logMissionDeckFailure(stage, error, operation);
    throw new Error("Nao consegui reler as cartas da pilha de missao.");
  }
}

function orderMissionCards(items, itemIds) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return itemIds.map((id) => itemsById.get(id)).filter(Boolean);
}

function validateMissionCards(items, itemIds) {
  if (itemIds.length !== 5 || new Set(itemIds).size !== 5) {
    throw new Error("Selecione exatamente 5 cartas duplas sacadas.");
  }

  const orderedItems = orderMissionCards(items, itemIds);
  const cards = getCardItems(orderedItems);

  if (
    items.length !== 5 ||
    orderedItems.length !== 5 ||
    cards.length !== 5 ||
    cards.some((item) => !getNormalizedCard(item))
  ) {
    throw new Error("Selecione exatamente 5 cartas duplas sacadas.");
  }

  return cards;
}

async function readMissionDeck(OBR, deckId, operation, stage) {
  try {
    const [deck] = await OBR.scene.items.getItems([deckId]);
    return deck || null;
  } catch (error) {
    logMissionDeckFailure(stage, error, operation);
    throw new Error("Nao consegui verificar a pilha de missao criada.");
  }
}

async function removeIntactMissionDeck(OBR, operation, reason) {
  const deck = await readMissionDeck(OBR, operation.deckId, operation, `${reason}: releitura`);

  if (!deck) {
    return true;
  }

  if (!missionDeckMatchesInitial(deck, operation)) {
    console.warn("Rollback da pilha de missao recusado porque a pilha foi alterada", {
      reason,
      ...summarizeMissionOperation(operation),
    });
    return false;
  }

  try {
    await OBR.scene.items.deleteItems([operation.deckId]);
  } catch (error) {
    logMissionDeckFailure(`${reason}: deleteItems da pilha`, error, operation);
  }

  return !(await readMissionDeck(
    OBR,
    operation.deckId,
    operation,
    `${reason}: confirmacao`,
  ));
}

async function reconcilePartiallyDeletedMissionCards(
  OBR,
  operation,
  remainingSourceIds,
) {
  const remainingSet = new Set(remainingSourceIds);
  const retainedRecords = operation.records.filter(
    (record) => !remainingSet.has(record.sourceId),
  );
  const retainedCards = retainedRecords.map((record) => cloneDeckCard(record.entry));
  let reconciled = false;

  await OBR.scene.items.updateItems([operation.deckId], (draftItems) => {
    const deck = draftItems[0];

    if (!missionDeckMatchesInitial(deck, operation)) {
      return;
    }

    const metadata = getNormalizedDeck(deck, "reconciliacao da pilha de missao", true);

    if (!metadata) {
      return;
    }

    const nextMetadata = {
      ...metadata,
      cards: retainedCards.map(cloneDeckCard),
    };

    applyDeckDisplay(deck, nextMetadata);
    setDeckMetadata(deck, nextMetadata);
    reconciled = true;
  });

  if (!reconciled) {
    return false;
  }

  const currentDeck = await readMissionDeck(
    OBR,
    operation.deckId,
    operation,
    "confirmacao da reconciliacao parcial",
  );
  const currentMetadata = currentDeck ? getNormalizedDeck(currentDeck) : null;

  return Boolean(currentMetadata && cardsMatch(currentMetadata.cards, retainedCards));
}

async function reconcileMissionSourceDeletion(OBR, operation, deleteError = null) {
  const remainingItems = await getItemsByIdsForMission(
    OBR,
    operation.sourceIds,
    "releitura apos deleteItems",
    operation,
  );
  const remainingSourceIds = remainingItems
    .map((item) => item.id)
    .filter((id) => operation.sourceIds.includes(id));

  if (!remainingSourceIds.length) {
    if (deleteError) {
      console.warn("deleteItems falhou, mas todas as cartas originais foram apagadas", {
        ...summarizeMissionOperation(operation, { remainingSourceIds }),
      });
    }
    return true;
  }

  const currentDeck = await readMissionDeck(
    OBR,
    operation.deckId,
    operation,
    "releitura antes da reconciliacao",
  );

  if (!currentDeck || !missionDeckMatchesInitial(currentDeck, operation)) {
    console.warn("Reconciliacao da pilha de missao recusada porque a pilha mudou", {
      ...summarizeMissionOperation(operation, { remainingSourceIds }),
    });
    throw new Error(
      "Nao consegui apagar todas as cartas e a pilha ja foi alterada; preservei o estado mais recente.",
    );
  }

  if (remainingSourceIds.length === operation.sourceIds.length) {
    const rolledBack = await removeIntactMissionDeck(
      OBR,
      operation,
      "rollback apos nenhuma carta original ser apagada",
    );

    if (rolledBack) {
      throw new Error(
        "Nao consegui apagar as cartas originais; a nova pilha foi removida com seguranca.",
      );
    }

    throw new Error(
      "Nao consegui apagar as cartas originais nem remover a nova pilha automaticamente.",
    );
  }

  let reconciled = false;

  try {
    reconciled = await reconcilePartiallyDeletedMissionCards(
      OBR,
      operation,
      remainingSourceIds,
    );
  } catch (error) {
    logMissionDeckFailure("reconciliacao parcial", error, operation, {
      remainingSourceIds,
    });
  }

  if (reconciled) {
    console.warn("Exclusao parcial reconciliada sem duplicar as cartas restantes", {
      ...summarizeMissionOperation(operation, { remainingSourceIds }),
    });
    throw new Error(
      "Algumas cartas nao foram apagadas; a pilha foi ajustada para evitar duplicacao.",
    );
  }

  throw new Error(
    "Algumas cartas nao foram apagadas e nao foi seguro ajustar a pilha automaticamente.",
  );
}

async function addMissionDeckOrRollback(OBR, operation) {
  try {
    await OBR.scene.items.addItems([operation.item]);
  } catch (error) {
    logMissionDeckFailure("addItems", error, operation);

    let removed = false;

    try {
      removed = await removeIntactMissionDeck(
        OBR,
        operation,
        "rollback apos falha em addItems",
      );
    } catch (rollbackError) {
      logMissionDeckFailure("rollback de addItems", rollbackError, operation);
    }

    if (removed) {
      throw new Error("Nao consegui criar a pilha de missao; as cartas foram preservadas.");
    }

    throw new Error(
      "A criacao da pilha falhou e nao foi seguro remover uma pilha residual automaticamente.",
    );
  }

  const createdDeck = await readMissionDeck(
    OBR,
    operation.deckId,
    operation,
    "confirmacao de addItems",
  );

  if (!createdDeck || !missionDeckMatchesInitial(createdDeck, operation)) {
    throw new Error("Nao consegui confirmar a pilha de missao criada.");
  }
}

export async function createMissionDeckFromSelection(OBR, buildImage) {
  let selection;

  try {
    selection = (await OBR.player.getSelection()) || [];
  } catch (error) {
    logMissionDeckFailure("leitura da selecao", error, null);
    throw new Error("Nao consegui ler a selecao atual.");
  }

  if (selection.length !== 5 || new Set(selection).size !== 5) {
    throw new Error("Selecione exatamente 5 cartas duplas sacadas.");
  }

  const sourceIds = [...selection];
  const operationKey = missionCreationKey(sourceIds);

  if (activeMissionDeckCreations.has(operationKey)) {
    throw new Error("Esta pilha de missao ja esta sendo criada.");
  }

  activeMissionDeckCreations.add(operationKey);

  try {
    const initialItems = await getItemsByIdsForMission(
      OBR,
      sourceIds,
      "releitura inicial",
    );
    validateMissionCards(initialItems, sourceIds);

    let currentSelection;

    try {
      currentSelection = (await OBR.player.getSelection()) || [];
    } catch (error) {
      logMissionDeckFailure("confirmacao da selecao", error, { sourceIds });
      throw new Error("Nao consegui confirmar a selecao atual.");
    }

    if (!sameItemIds(sourceIds, currentSelection)) {
      throw new Error("A selecao mudou; selecione novamente as 5 cartas.");
    }

    const currentItems = await getItemsByIdsForMission(
      OBR,
      sourceIds,
      "releitura antes da criacao",
    );
    const selectedCards = validateMissionCards(currentItems, sourceIds);
    let builtDeck;

    try {
      const records = selectedCards.map((item) => {
        const entry = createMissionDeckEntry(item);

        if (!entry) {
          throw new Error("Uma das cartas selecionadas deixou de ser compativel.");
        }

        return {
          sourceId: item.id,
          entry: cloneDeckCard(entry),
        };
      });
      const shuffledRecords = shuffleCards(records);
      builtDeck = createMissionDeckItem(buildImage, selectedCards, shuffledRecords);
    } catch (error) {
      logMissionDeckFailure("serializacao ou montagem da pilha", error, { sourceIds });
      throw new Error("Nao consegui preparar os dados da pilha de missao.");
    }

    const operation = {
      ...builtDeck,
      deckId: builtDeck.item.id,
      deckName: builtDeck.item.name,
      sourceIds,
    };

    await addMissionDeckOrRollback(OBR, operation);

    let deleteError = null;

    try {
      await OBR.scene.items.deleteItems(sourceIds);
    } catch (error) {
      deleteError = error;
      logMissionDeckFailure("deleteItems das cartas originais", error, operation);
    }

    await reconcileMissionSourceDeletion(OBR, operation, deleteError);
    return operation.item;
  } finally {
    activeMissionDeckCreations.delete(operationKey);
  }
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
  const cardMetadata = {
    ...cloneUnknownFields(operation.drawnCard, DECK_CARD_FIELDS),
    ...createCardMetadata({
      name: operation.drawnCard.name,
      front: operation.drawnCard.front,
      back: operation.back,
      gridWidth: operation.gridWidth,
      origin: operation.origin,
      currentFace: operation.drawnFace,
      mirrorBack: operation.mirrorBack,
      sourceDeckId: operation.deckId,
      sourceDeckName: operation.deckName,
    }),
  };
  const item = buildImage(
    createImageData(face),
    createGridData(face, operation.gridWidth, operation.origin),
  )
    .name(operation.drawnCard.name)
    .description(
      operation.description || `Carta dupla: ${faceLabel(operation.drawnFace)}`,
    )
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
  const metadata = requireNormalizedDeck(deck, "comprada");

  if (!metadata.cards.length) {
    return null;
  }

  const drawnCard = cloneDeckCard(metadata.cards[0]);
  const remainingCards = metadata.cards.slice(1).map(cloneDeckCard);
  const drawnFace = currentDeckFace(metadata);
  const back = cloneSerializable(drawnCard.back || metadata.back);
  const gridWidth = positiveGridWidth(drawnCard.gridWidth, metadata.gridWidth);
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
    back,
    gridWidth,
    origin: cloneSerializable(drawnCard.origin),
    mirrorBack:
      typeof drawnCard.mirrorBack === "boolean" ? drawnCard.mirrorBack : undefined,
    description:
      typeof drawnCard.description === "string" &&
      !/^Carta dupla:\s*(frente|verso)$/i.test(drawnCard.description.trim())
        ? drawnCard.description
        : "",
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
    const metadata = deck ? getNormalizedDeck(deck, "rollback de compra", true) : null;

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

  try {
    await OBR.scene.items.updateItems([deckId], (draftItems) => {
      const deck = draftItems[0];

      if (!deck) {
        return;
      }

      operation = applyDrawToDeckDraft(deck, drawOffset, options);
    });
  } catch (error) {
    logDrawFailure("validacao ou atualizacao da pilha", error, { deckId }, null);
    throw error;
  }

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

          if (!item) {
            return;
          }

          const metadata = requireNormalizedDeck(item, "embaralhada");

          if (metadata.cards.length <= 1) {
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
  const decks = getDeckItems(items).filter((item) => {
    const metadata = requireNormalizedDeck(item, "virada");
    return metadata.cards.length > 0;
  });

  if (!decks.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const item of draftItems) {
      const metadata = requireNormalizedDeck(item, "virada");
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
  const returnedCard = {
    ...cloneUnknownFields(metadata, CARD_METADATA_FIELDS),
    name: metadata.name || card.name || "Carta",
    front: cloneSerializable(metadata.faces.front),
    back: cloneSerializable(metadata.faces.back),
    gridWidth: metadata.gridWidth,
    mirrorBack: shouldMirrorCardBack(metadata),
  };

  if (metadata.origin) {
    returnedCard.origin = cloneSerializable(metadata.origin);
  }

  if (
    typeof card.description === "string" &&
    !/^Carta dupla:\s*(frente|verso)$/i.test(card.description.trim())
  ) {
    returnedCard.description = card.description;
  }

  return returnedCard;
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
  const metadata = getNormalizedCard(card);
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
    const metadata = deck ? getNormalizedDeck(deck, "rollback de devolucao", true) : null;

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
  const cardMetadata = getNormalizedCard(cardSnapshot, "devolucao", true);

  if (!cardMetadata) {
    return null;
  }

  await OBR.scene.items.updateItems([deckId], (draftItems) => {
    const deck = draftItems[0];
    const metadata = deck ? getNormalizedDeck(deck, "devolucao", true) : null;

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

  if (!getNormalizedCard(initialCard, "devolucao", true)) {
    throw new Error("Esta carta possui dados incompletos e nao pode ser devolvida.");
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

    const cardMetadata = getNormalizedCard(currentCard, "devolucao", true);

    if (!cardMetadata) {
      throw new Error("Esta carta possui dados incompletos e nao pode ser devolvida.");
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

    if (!sourceDeck) {
      console.warn("A pilha de origem nao existe ou nao e mais uma pilha", {
        cardId,
        deckId: sourceDeckId,
      });
      return { count: 0, deckId: null };
    }

    if (!getNormalizedDeck(sourceDeck, "devolucao", true)) {
      throw new Error("A pilha de origem possui dados incompletos e nao aceita devolucao.");
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
