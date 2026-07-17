const process = { env: { NODE_ENV: "production" } };

const EXTENSION_ID = "br.demonrider.double-sided-cards";
const REGISTRATION_ID = EXTENSION_ID;
const METADATA_KEY = `${EXTENSION_ID}/card`;
const DECK_METADATA_KEY = `${EXTENSION_ID}/deck`;
const COMMANDS_CHANNEL = `${REGISTRATION_ID}/commands`;

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

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeComparableUrl$1(value) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

function getGoogleDriveId(value) {
  try {
    const url = new URL(String(value || "").trim());
    const pathMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
    return pathMatch?.[1] || url.searchParams.get("id") || "";
  } catch {
    return "";
  }
}

function getUrlFilenameKey(value) {
  try {
    const url = new URL(String(value || "").trim());
    const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    return normalizeComparableText(filename);
  } catch {
    const filename = String(value || "").split(/[\\/]/).filter(Boolean).pop() || "";
    return normalizeComparableText(filename);
  }
}

function isUsefulFaceKey(value) {
  return Boolean(
    value &&
      !new Set([
        "back",
        "carta",
        "download",
        "frente",
        "front",
        "image",
        "imagem",
        "open",
        "preview",
        "uc",
        "verso",
        "view",
      ]).has(value),
  );
}

function getFaceKeys(face) {
  return [normalizeComparableText(face?.name), getUrlFilenameKey(face?.url)].filter(isUsefulFaceKey);
}

function shouldMirrorBackFace(front, back) {
  if (!front?.url || !back?.url) {
    return false;
  }

  if (normalizeComparableUrl$1(front.url) === normalizeComparableUrl$1(back.url)) {
    return true;
  }

  const frontDriveId = getGoogleDriveId(front.url);
  const backDriveId = getGoogleDriveId(back.url);
  if (frontDriveId && frontDriveId === backDriveId) {
    return true;
  }

  const backKeys = new Set(getFaceKeys(back));
  return getFaceKeys(front).some((key) => backKeys.has(key));
}

function shouldMirrorCardBack(metadata) {
  if (!metadata?.faces) {
    return false;
  }

  return typeof metadata.mirrorBack === "boolean"
    ? metadata.mirrorBack
    : shouldMirrorBackFace(metadata.faces.front, metadata.faces.back);
}

function applyCardFaceTransform(item, metadata, faceId = metadata?.currentFace) {
  const scale = item.scale && typeof item.scale === "object" ? item.scale : {};
  const x = Number.isFinite(scale.x) && scale.x !== 0 ? Math.abs(scale.x) : 1;
  const y = Number.isFinite(scale.y) && scale.y !== 0 ? scale.y : 1;
  const mirrorBack = faceId === "back" && shouldMirrorCardBack(metadata);

  item.scale = {
    ...scale,
    x: mirrorBack ? -x : x,
    y,
  };
}

function createCardMetadata({
  name,
  front,
  back,
  gridWidth,
  origin,
  currentFace = "front",
  sourceDeckId,
  sourceDeckName,
}) {
  const metadata = {
    version: 1,
    name,
    currentFace,
    gridWidth,
    mirrorBack: shouldMirrorBackFace(front, back),
    faces: {
      front,
      back,
    },
  };

  if (Number.isFinite(origin?.x) && Number.isFinite(origin?.y)) {
    metadata.origin = {
      x: origin.x,
      y: origin.y,
    };
  }

  if (sourceDeckId) {
    metadata.sourceDeckId = sourceDeckId;
  }

  if (sourceDeckName) {
    metadata.sourceDeckName = sourceDeckName;
  }

  return metadata;
}

function createDeckMetadata({ name, back, cards, gridWidth, deleteWhenEmpty = false }) {
  const metadata = {
    version: 1,
    name,
    currentFace: "back",
    back,
    cards,
    gridWidth,
  };

  if (deleteWhenEmpty) {
    metadata.deleteWhenEmpty = true;
  }

  return metadata;
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

function createGridData(face, gridWidth, origin) {
  const dpi = Math.max(1, face.width / gridWidth);
  const offset =
    Number.isFinite(origin?.x) && Number.isFinite(origin?.y)
      ? { x: origin.x, y: origin.y }
      : {
          x: face.width / 2,
          y: face.height / 2,
        };

  return {
    dpi,
    offset,
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

function getDeckItems(items) {
  return items.filter((item) => isDeckMetadata(getDeckMetadata(item)));
}

function getCardItems(items) {
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

function getDeckFace(metadata) {
  if (metadata.currentFace === "front" && metadata.cards[0]?.front) {
    return metadata.cards[0].front;
  }

  return metadata.back;
}

function applyDeckDisplay(item, metadata) {
  const count = metadata.cards.length;
  const face = getDeckFace(metadata);

  item.name = `${metadata.name} (${count})`;
  item.description = deckDescription(count);
  item.text = createDeckText(count);
  item.image = createImageData(face);
  item.grid = createGridData(face, metadata.gridWidth);
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

async function drawFromDecks(OBR, buildImage, items, options = {}) {
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

async function drawSelectedDecks(OBR, buildImage, fallbackSelection = []) {
  const decks = await getSelectedDeckItems(OBR, fallbackSelection);
  return drawFromDecks(OBR, buildImage, decks);
}

async function shuffleDecks(OBR, items) {
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

async function flipDeckItems(OBR, items) {
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

async function returnCardsToDeck(OBR, cards, fallbackDeckSelection = []) {
  const cardIds = uniqueCardIds(cards);

  if (!cardIds.length) {
    return 0;
  }

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

async function returnSelectedCardsToDeck(
  OBR,
  fallbackCardSelection = [],
  fallbackDeckSelection = [],
) {
  const cards = await getSelectedCardItems(OBR, fallbackCardSelection);
  return returnCardsToDeck(OBR, cards, fallbackDeckSelection);
}

const CARD_CATEGORY_KEY = `${EXTENSION_ID}/card-category`;
const ACTIVE_COLOR_KEY = `${EXTENSION_ID}/active-color`;
const SELECTION_BOARD_KEY = `${EXTENSION_ID}/selection-board`;

const PLAYER_COLORS = [
  { id: "red", label: "Vermelho", aliases: ["vermelho", "red"], pointerColor: "#ef4444" },
  { id: "white", label: "Branco", aliases: ["branco", "white"], pointerColor: "#f8fafc" },
  { id: "green", label: "Verde", aliases: ["verde", "green"], pointerColor: "#22c55e" },
  { id: "blue", label: "Azul", aliases: ["azul", "blue"], pointerColor: "#3b82f6" },
];

const CARD_CATEGORIES = [
  { id: "race", label: "Raca" },
  { id: "class", label: "Classe" },
  { id: "divinity", label: "Divindade" },
];

new Set(PLAYER_COLORS.map((color) => color.id));
const CATEGORY_IDS = new Set(CARD_CATEGORIES.map((category) => category.id));

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

function clearAssignmentsForItem(state, itemId) {
  for (const color of PLAYER_COLORS) {
    for (const category of CARD_CATEGORIES) {
      if (state.assigned[color.id][category.id] === itemId) {
        state.assigned[color.id][category.id] = null;
      }
    }
  }
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

function getPreferredFlipItems(items) {
  const decks = getDeckItems(items).filter((item) => getDeckMetadata(item).cards.length > 0);

  if (decks.length) {
    return decks;
  }

  return getDoubleSidedCards(items);
}

async function getItemsSafely(OBR, itemIds = []) {
  if (!itemIds.length) {
    return [];
  }

  try {
    return await OBR.scene.items.getItems(itemIds);
  } catch {
    return [];
  }
}

async function flipItems(OBR, items) {
  const itemsToFlip = getDoubleSidedCards(items);
  const deckItemsToFlip = getDeckItems(items);

  if (!itemsToFlip.length && !deckItemsToFlip.length) {
    return 0;
  }

  if (itemsToFlip.length) {
    await OBR.scene.items.updateItems(itemsToFlip, (draftItems) => {
      for (const item of draftItems) {
        const metadata = getCardMetadata(item);
        const targetFace = nextFace(metadata.currentFace);
        const nextMetadata = {
          ...metadata,
          currentFace: targetFace,
          mirrorBack: shouldMirrorBackFace(metadata.faces.front, metadata.faces.back),
        };
        const face = nextMetadata.faces[targetFace];

        item.image = createImageData(face);
        item.grid = createGridData(face, nextMetadata.gridWidth, nextMetadata.origin);
        applyDivinitySizing(item, face);
        applyCardFaceTransform(item, nextMetadata, targetFace);
        item.description = `Carta dupla: ${faceLabel(targetFace)}`;
        setCardMetadata(item, nextMetadata);
      }
    });
  }

  return itemsToFlip.length + (await flipDeckItems(OBR, deckItemsToFlip));
}

async function flipSelectedItems(OBR, fallbackSelection = []) {
  let selection = [];
  let hasCurrentSelection = false;

  try {
    selection = (await OBR.player.getSelection()) || [];
    hasCurrentSelection = selection.length > 0;
  } catch {
    selection = [];
  }

  const selectedItems = await getItemsSafely(OBR, selection);
  const selectedFlipItems = getPreferredFlipItems(selectedItems);

  if (selectedFlipItems.length) {
    return flipItems(OBR, selectedFlipItems);
  }

  if (hasCurrentSelection) {
    return 0;
  }

  const fallbackItems = getPreferredFlipItems(await getItemsSafely(OBR, fallbackSelection));

  return flipItems(OBR, fallbackItems);
}

const PRESET_DECKS_URL = new URL("../assets/preset-decks/decks.json", import.meta.url);
const ITEM_LAYERS$1 = new Set([
  "DRAWING",
  "PROP",
  "MOUNT",
  "CHARACTER",
  "ATTACHMENT",
  "NOTE",
  "TEXT",
]);

function isExternalUrl$1(value) {
  return /^(https?:|data:|blob:)/i.test(value);
}

function resolveAssetUrl$1(path) {
  if (!path || typeof path !== "string") {
    return "";
  }

  if (isExternalUrl$1(path)) {
    return path;
  }

  return new URL(`../${path.replace(/^\/+/, "")}`, import.meta.url).toString();
}

function getNameFromPath$1(path, fallback) {
  if (!path || typeof path !== "string") {
    return fallback;
  }

  try {
    const pathname = isExternalUrl$1(path) ? new URL(path).pathname : path;
    const filename = pathname.split("/").filter(Boolean).pop();

    if (!filename) {
      return fallback;
    }

    return decodeURIComponent(filename.replace(/\.[^.]+$/, "")) || fallback;
  } catch {
    return fallback;
  }
}

function normalizeAsset$1(value, fallbackName) {
  if (typeof value === "string") {
    return {
      name: getNameFromPath$1(value, fallbackName),
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
    name: value.name || getNameFromPath$1(value.path || value.url, fallbackName),
    path: value.path || value.url || "",
    width: value.width,
    height: value.height,
    mime: value.mime,
  };
}

function normalizePresetDeck(value, index) {
  const name = value?.name || `Pilha ${index + 1}`;
  const layer = ITEM_LAYERS$1.has(value?.layer) ? value.layer : "PROP";

  return {
    id: value?.id || `deck-${index + 1}`,
    name,
    gridWidth: Number.isFinite(value?.gridWidth) && value.gridWidth > 0 ? value.gridWidth : 2,
    layer,
    back: normalizeAsset$1(value?.back, `${name} verso`),
    cards: Array.isArray(value?.cards)
      ? value.cards.map((card, cardIndex) => {
          if (typeof card === "string") {
            return {
              name: getNameFromPath$1(card, `Carta ${cardIndex + 1}`),
              front: normalizeAsset$1(card, `Carta ${cardIndex + 1}`),
            };
          }

          return {
            name: card?.name || `Carta ${cardIndex + 1}`,
            front: normalizeAsset$1(card?.front || card?.path || card?.url, `Carta ${cardIndex + 1}`),
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

function readImage$1(url) {
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

async function buildFace$1(asset) {
  const url = resolveAssetUrl$1(asset.path);

  if (!url) {
    throw new Error("A pilha padrao ainda nao tem verso configurado.");
  }

  const dimensions =
    Number.isFinite(asset.width) && Number.isFinite(asset.height)
      ? { width: asset.width, height: asset.height }
      : await readImage$1(url);

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
    buildFace$1(deck.back),
    Promise.all(
      deck.cards.map(async (card, index) => ({
        name: card.name || `Carta ${index + 1}`,
        front: await buildFace$1(card.front),
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

const PRESET_CARDS_URL = new URL("../assets/preset-cards/cards.json", import.meta.url);
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

function normalizeOrigin(value) {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    return null;
  }

  return {
    x: value.x,
    y: value.y,
  };
}

function normalizePresetCardGroup(value, index) {
  const name = value?.name || `Cartas ${index + 1}`;
  const layer = ITEM_LAYERS.has(value?.layer) ? value.layer : "PROP";
  const category = normalizeCategory(value?.category);
  const groupOrigin = normalizeOrigin(value?.origin);

  return {
    id: value?.id || `cards-${index + 1}`,
    name,
    category,
    gridWidth: Number.isFinite(value?.gridWidth) && value.gridWidth > 0 ? value.gridWidth : 2,
    layer,
    origin: groupOrigin,
    back: normalizeAsset(value?.back, `${name} verso`),
    cards: Array.isArray(value?.cards)
      ? value.cards.map((card, cardIndex) => {
          if (typeof card === "string") {
            return {
              id: `card-${cardIndex + 1}`,
              name: getNameFromPath(card, `Carta ${cardIndex + 1}`),
              front: normalizeAsset(card, `Carta ${cardIndex + 1}`),
              back: normalizeAsset("", `Carta ${cardIndex + 1} verso`),
              origin: null,
            };
          }

          const cardName = card?.name || `Carta ${cardIndex + 1}`;

          return {
            id: card?.id || `card-${cardIndex + 1}`,
            name: cardName,
            category: normalizeCategory(card?.category) || category,
            front: normalizeAsset(card?.front || card?.path || card?.url, cardName),
            back: normalizeAsset(card?.back, `${cardName} verso`),
            origin: normalizeOrigin(card?.origin),
          };
        })
      : [],
  };
}

async function loadPresetCardGroups() {
  const response = await fetch(`${PRESET_CARDS_URL.toString()}?t=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Nao consegui carregar a biblioteca de cartas.");
  }

  const data = await response.json();
  const groups = Array.isArray(data?.groups) ? data.groups : [];

  return groups.map(normalizePresetCardGroup);
}

function isPresetCardReady(group, card) {
  return Boolean((card?.back?.path || group?.back?.path) && card?.front?.path);
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

async function buildFace(asset, label) {
  const url = resolveAssetUrl(asset.path);

  if (!url) {
    throw new Error(`A biblioteca ainda nao tem ${label} configurado.`);
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

async function buildPresetCardData(group, card) {
  if (!isPresetCardReady(group, card)) {
    throw new Error(`A carta "${card?.name || "padrao"}" ainda nao tem frente e verso.`);
  }

  const backAsset = card?.back?.path ? card.back : group.back;
  const [front, back] = await Promise.all([
    buildFace(card.front, "frente"),
    buildFace(backAsset, "verso"),
  ]);

  return {
    name: card.name,
    front,
    back,
    category: normalizeCategory(card.category) || group.category,
    gridWidth: group.gridWidth,
    layer: group.layer,
    origin: card.origin || group.origin,
  };
}

const PRESET_VERSION = 1;
const ITEM_CHUNK_SIZE = 80;
const SCENE_PRESETS = [
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

async function loadScenePreset(definition) {
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

async function loadScenePresetEntries() {
  return Promise.all(
    SCENE_PRESETS.map(async (definition) => ({
      definition,
      preset: await loadScenePreset(definition),
    })),
  );
}

async function saveScenePreset(OBR, presetId) {
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

async function restoreDefaultBoardPreset(OBR, preset) {
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

const elements = {
  form: document.querySelector("#cardForm"),
  deckForm: document.querySelector("#deckForm"),
  presetDeckSelect: document.querySelector("#presetDeckSelect"),
  presetDeckGridWidth: document.querySelector("#presetDeckGridWidth"),
  presetDeckLayer: document.querySelector("#presetDeckLayer"),
  presetDeckInfo: document.querySelector("#presetDeckInfo"),
  importPresetDeckButton: document.querySelector("#importPresetDeckButton"),
  presetCardGroupSelect: document.querySelector("#presetCardGroupSelect"),
  presetCardSelect: document.querySelector("#presetCardSelect"),
  presetCardGridWidth: document.querySelector("#presetCardGridWidth"),
  presetCardLayer: document.querySelector("#presetCardLayer"),
  presetCardInfo: document.querySelector("#presetCardInfo"),
  importPresetCardButton: document.querySelector("#importPresetCardButton"),
  missionDeckInfo: document.querySelector("#missionDeckInfo"),
  createMissionDeckButton: document.querySelector("#createMissionDeckButton"),
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
  returnOriginButton: document.querySelector("#returnOriginButton"),
  colorAssignments: document.querySelector("#colorAssignments"),
  publicBaseUrl: document.querySelector("#publicBaseUrl"),
  migratePublicButton: document.querySelector("#migratePublicButton"),
  createScenePresetButtons: [...document.querySelectorAll("[data-create-scene-preset]")],
  restoreScenePresetButtons: [...document.querySelectorAll("[data-restore-scene-preset]")],
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
let lastFlipSelection = [];
let presetDecks = [];
let presetCardGroups = [];
let scenePresetEntries = [];
let colorAssignmentsRefreshTimer = null;
const customSelects = new Map();
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
  if (!isConnected) {
    renderPlayerColorAssignments([]);
  }
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
  elements.returnOriginButton.disabled = !isConnected;
  updatePresetDeckControls(isConnected);
  updatePresetCardControls(isConnected);
  updateMissionDeckControls(isConnected);
}

function normalizePointerColor(color) {
  const value = String(color || "").trim().toLowerCase();

  if (/^#[0-9a-f]{8}$/.test(value)) {
    return value.slice(0, 7);
  }

  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);

  if (rgb) {
    return `#${rgb
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  return value;
}

function getPlayerColor(player) {
  const metadataColor = player.metadata?.[ACTIVE_COLOR_KEY]?.color;

  if (PLAYER_COLORS.some((entry) => entry.id === metadataColor)) {
    return metadataColor;
  }

  const pointerColor = normalizePointerColor(player.color);
  return (
    PLAYER_COLORS.find(
      (entry) => normalizePointerColor(entry.pointerColor) === pointerColor,
    )?.id || null
  );
}

function playerName(player) {
  return player.name || player.username || "Jogador sem nome";
}

function renderPlayerColorAssignments(players) {
  if (!elements.colorAssignments) {
    return;
  }

  elements.colorAssignments.replaceChildren();

  for (const color of PLAYER_COLORS) {
    const playersUsingColor = players.filter((player) => getPlayerColor(player) === color.id);
    const names = playersUsingColor.length
      ? playersUsingColor.map(playerName).join(", ")
      : "Sem jogador";
    const item = document.createElement("li");
    item.textContent = `${names} - ${color.label.toLowerCase()}`;
    elements.colorAssignments.append(item);
  }
}

async function getCurrentPlayerSnapshot() {
  if (!obr) {
    return null;
  }

  const [id, name, color, metadata] = await Promise.all([
    obr.player.getId().catch(() => obr.player.id || ""),
    obr.player.getName().catch(() => ""),
    obr.player.getColor().catch(() => ""),
    obr.player.getMetadata().catch(() => ({})),
  ]);

  if (!id) {
    return null;
  }

  return {
    id,
    name,
    color,
    metadata,
  };
}

function mergeCurrentPlayer(players, currentPlayer) {
  if (!currentPlayer?.id) {
    return players;
  }

  const nextPlayers = [...players];
  const playerIndex = nextPlayers.findIndex((player) => player.id === currentPlayer.id);

  if (playerIndex >= 0) {
    nextPlayers[playerIndex] = {
      ...nextPlayers[playerIndex],
      ...currentPlayer,
      metadata: {
        ...(nextPlayers[playerIndex].metadata || {}),
        ...(currentPlayer.metadata || {}),
      },
    };
  } else {
    nextPlayers.push(currentPlayer);
  }

  return nextPlayers;
}

async function refreshPlayerColorAssignments() {
  if (!obr?.party?.getPlayers) {
    renderPlayerColorAssignments([]);
    return;
  }

  try {
    const [players, currentPlayer] = await Promise.all([
      obr.party.getPlayers(),
      getCurrentPlayerSnapshot(),
    ]);
    renderPlayerColorAssignments(mergeCurrentPlayer(players, currentPlayer));
  } catch (error) {
    console.warn("Nao consegui atualizar as cores dos jogadores", error);
    if (elements.colorAssignments) {
      elements.colorAssignments.replaceChildren();
      const item = document.createElement("li");
      item.textContent = "Nao consegui ler os jogadores.";
      elements.colorAssignments.append(item);
    }
  }
}

function schedulePlayerColorAssignmentsRefresh(fallbackPlayers = null) {
  if (colorAssignmentsRefreshTimer) {
    window.clearTimeout(colorAssignmentsRefreshTimer);
  }

  colorAssignmentsRefreshTimer = window.setTimeout(() => {
    colorAssignmentsRefreshTimer = null;
    refreshPlayerColorAssignments().catch((error) => {
      console.warn("Nao consegui atualizar as cores do painel", error);

      if (fallbackPlayers) {
        renderPlayerColorAssignments(fallbackPlayers);
      }
    });
  }, 150);
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
  const entriesById = new Map(scenePresetEntries.map((entry) => [entry.definition.id, entry]));

  for (const button of elements.createScenePresetButtons) {
    button.hidden = true;
    button.disabled = true;
  }

  for (const button of elements.restoreScenePresetButtons) {
    const entry = entriesById.get(button.dataset.restoreScenePreset);
    button.disabled = !isConnected || !entry?.preset;
  }

  if (!scenePresetEntries.length) {
    elements.defaultBoardInfo.textContent = "Carregando mapas salvos...";
    return;
  }

  const parts = scenePresetEntries.map(({ definition, preset }) => {
    if (!preset) {
      return `${definition.name}: nao cadastrado`;
    }

    const itemLabel = preset.itemCount === 1 ? "1 item" : `${preset.itemCount} itens`;
    return `${definition.name}: ${itemLabel}, salvo em ${formatPresetDate(preset.savedAt)}`;
  });

  elements.defaultBoardInfo.textContent = parts.join(" | ");
}

async function refreshDefaultBoardInfo() {
  scenePresetEntries = await loadScenePresetEntries();
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
    lastFlipSelection = cardIds;
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
    lastFlipSelection = deckIds;
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

function getSelectLabel(select) {
  return select.selectedOptions?.[0]?.textContent || select.options?.[0]?.textContent || "Escolha uma opcao";
}

function closeCustomSelect(select) {
  const state = customSelects.get(select);

  if (!state) {
    return;
  }

  state.root.dataset.open = "false";
  state.menu.hidden = true;
  state.button.setAttribute("aria-expanded", "false");
}

function closeOtherCustomSelects(currentSelect) {
  for (const select of customSelects.keys()) {
    if (select !== currentSelect) {
      closeCustomSelect(select);
    }
  }
}

function buildCustomSelectMenu(select) {
  const state = customSelects.get(select);

  if (!state) {
    return;
  }

  state.menu.replaceChildren();

  for (const option of select.options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "custom-select__option";
    item.textContent = option.textContent;
    item.disabled = option.disabled;
    item.dataset.selected = String(option.selected);
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.selected));
    item.addEventListener("click", () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeCustomSelect(select);
      syncAllCustomSelects();
    });
    state.menu.append(item);
  }
}

function openCustomSelect(select) {
  const state = customSelects.get(select);

  if (!state || select.disabled) {
    return;
  }

  closeOtherCustomSelects(select);
  buildCustomSelectMenu(select);
  state.root.dataset.open = "true";
  state.menu.hidden = false;
  state.button.setAttribute("aria-expanded", "true");
}

function syncCustomSelect(select) {
  const state = customSelects.get(select);

  if (!state) {
    return;
  }

  state.button.textContent = getSelectLabel(select);
  state.button.disabled = select.disabled;
  state.root.dataset.disabled = String(select.disabled);

  if (state.root.dataset.open === "true") {
    buildCustomSelectMenu(select);
  }
}

function syncAllCustomSelects() {
  for (const select of customSelects.keys()) {
    syncCustomSelect(select);
  }
}

function enhanceCustomSelect(select) {
  if (!select || customSelects.has(select)) {
    return;
  }

  select.classList.add("native-select-hidden");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const root = document.createElement("div");
  root.className = "custom-select";
  root.dataset.open = "false";
  root.dataset.disabled = String(select.disabled);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "custom-select__button";
  button.textContent = getSelectLabel(select);
  button.disabled = select.disabled;
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "custom-select__menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");

  root.append(button, menu);
  select.after(root);

  const observer = new MutationObserver(() => syncCustomSelect(select));
  observer.observe(select, {
    attributes: true,
    attributeFilter: ["disabled"],
    childList: true,
    subtree: true,
  });

  customSelects.set(select, { button, menu, observer, root });

  button.addEventListener("click", (event) => {
    event.stopPropagation();

    if (root.dataset.open === "true") {
      closeCustomSelect(select);
      return;
    }

    openCustomSelect(select);
  });

  button.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCustomSelect(select);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCustomSelect(select);
    }
  });

  select.addEventListener("change", () => syncCustomSelect(select));
  syncCustomSelect(select);
}

function enhancePanelSelects() {
  for (const select of document.querySelectorAll("select")) {
    enhanceCustomSelect(select);
  }

  document.addEventListener("click", (event) => {
    for (const { root } of customSelects.values()) {
      if (!root.contains(event.target)) {
        root.dataset.open = "false";
        root.querySelector(".custom-select__menu").hidden = true;
        root.querySelector(".custom-select__button").setAttribute("aria-expanded", "false");
      }
    }
  });

  syncAllCustomSelects();
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

function imageMayHaveTransparency(blob) {
  const mime = blob.type || "";
  return mime === "image/png" || mime === "image/webp";
}

function imageLooksTransparent(image) {
  const sampleSize = 64;
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const context = canvas.getContext("2d");

  if (!context) {
    return false;
  }

  context.clearRect(0, 0, sampleSize, sampleSize);
  context.drawImage(image, 0, 0, sampleSize, sampleSize);
  const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;

  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 250) {
      return true;
    }
  }

  return false;
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

  if (repairableItems.length) {
    await obr.scene.items.updateItems(repairableItems, (draftItems) => {
      for (const item of draftItems) {
        const cardMetadata = getCardMetadata(item);

        if (cardMetadata) {
          const currentFace = cardMetadata.currentFace === "back" ? "back" : "front";
          const nextCardMetadata = {
            ...cardMetadata,
            currentFace,
            mirrorBack: shouldMirrorBackFace(cardMetadata.faces.front, cardMetadata.faces.back),
          };
          const face = nextCardMetadata.faces[currentFace];

          item.image = createImageData(face);
          item.grid = createGridData(face, nextCardMetadata.gridWidth, nextCardMetadata.origin);
          applyDivinitySizing(item, face);
          applyCardFaceTransform(item, nextCardMetadata, currentFace);
          item.description = currentFace === "back" ? "Carta dupla: verso" : "Carta dupla: frente";
          setCardMetadata(item, nextCardMetadata);
          continue;
        }

        const deckMetadata = getDeckMetadata(item);

        if (deckMetadata) {
          applyDeckDisplay(item, deckMetadata);
          setDeckMetadata(item, deckMetadata);
        }
      }
    });
  }

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

function repairNestedPublicUrl(rawUrl, stats) {
  const value = String(rawUrl || "");
  const matches = [...value.matchAll(/https?:\/\//g)];

  if (matches.length < 2) {
    return value;
  }

  const nextUrl = value.slice(matches[matches.length - 1].index);

  if (normalizeComparableUrl(value) === normalizeComparableUrl(nextUrl)) {
    return value;
  }

  stats.urls += 1;
  return nextUrl;
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

function isRemoteSceneAssetUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    const isLocalUrl = url.hostname === "localhost" || url.hostname === "127.0.0.1";

    return !isLocalUrl && (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}

function shouldCachePlainSceneImage(item) {
  if (!item.image?.url || !isRemoteSceneAssetUrl(item.image.url)) {
    return false;
  }

  try {
    const url = new URL(item.image.url, window.location.origin);

    if (url.hostname === "images.owlbear.rodeo") {
      return true;
    }
  } catch {
    return false;
  }

  const area = (item.image.width || 0) * (item.image.height || 0);
  const mime = item.image.mime || "";
  const isWebp = mime === "image/webp" || /\.webp(?:$|[?#])/i.test(item.image.url);

  return item.layer === "MAP" || item.layer === "NOTE" || area >= 2_000_000 || isWebp;
}

function getCachedAssetInfo(rawUrl, remoteCache) {
  const repairedUrl = repairNestedPublicUrl(rawUrl, { urls: 0 });
  return remoteCache.get(rawUrl) || remoteCache.get(repairedUrl) || null;
}

function getRemoteAssetName(item, mime = "image/jpeg") {
  const fallback = item.name || getNameFromUrl(item.image?.url || "", "image");
  const extension = mime === "image/png" ? "png" : "jpg";
  return `${fallback}.${extension}`;
}

async function loadBlobImage(blob) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await loadImageFromUrl(objectUrl, blob.type || "image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Nao consegui converter a imagem para o formato otimizado."));
      },
      mime,
      quality,
    );
  });
}

async function optimizeSceneImageBlob(blob, info) {
  const shouldConvertToJpeg =
    blob.type === "image/webp" ||
    blob.type === "image/png" ||
    (info.width || 0) * (info.height || 0) >= 2_000_000;

  if (!shouldConvertToJpeg) {
    return { blob, mime: blob.type || info.mime || "image/png" };
  }

  const image = await createImageBitmap(blob);

  try {
    const transparent = imageMayHaveTransparency(blob) && imageLooksTransparent(image);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");

    if (!context) {
      return { blob, mime: blob.type || info.mime || "image/png" };
    }

    if (!transparent) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(image, 0, 0);
    const mime = transparent ? "image/png" : "image/jpeg";

    return {
      blob: await canvasToBlob(canvas, mime, transparent ? undefined : 0.84),
      mime,
    };
  } finally {
    image.close?.();
  }
}

async function uploadBlobAsLocalAsset(blob, name) {
  const response = await fetch(`./__local_asset?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
    },
    body: blob,
  });

  if (!response.ok) {
    throw new Error("O servidor local nao conseguiu salvar a imagem otimizada.");
  }

  const payload = await response.json();
  if (!payload.url) {
    throw new Error("O servidor local nao retornou a imagem otimizada.");
  }

  return payload.url;
}

async function cachePlainSceneImage(item) {
  const response = await fetch(item.image.url, {
    cache: "no-store",
    mode: "cors",
  });

  if (!response.ok) {
    throw new Error(`Nao consegui baixar "${item.name || "imagem"}" do Owlbear.`);
  }

  const originalBlob = await response.blob();
  const info = await loadBlobImage(originalBlob);
  const optimized = await optimizeSceneImageBlob(originalBlob, info);
  const url = await uploadBlobAsLocalAsset(optimized.blob, getRemoteAssetName(item, optimized.mime));

  return {
    url,
    width: info.width,
    height: info.height,
    mime: optimized.mime,
  };
}

async function cachePlainRemoteSceneImages(items, stats) {
  const cache = new Map();

  if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    return cache;
  }

  const remoteItems = [];
  const seenUrls = new Set();

  for (const item of items) {
    if (
      item.type !== "IMAGE" ||
      getCardMetadata(item) ||
      getDeckMetadata(item) ||
      !shouldCachePlainSceneImage(item) ||
      seenUrls.has(item.image.url)
    ) {
      continue;
    }

    seenUrls.add(item.image.url);
    remoteItems.push(item);
  }

  if (!remoteItems.length) {
    return cache;
  }

  setMessage(`Otimizando ${remoteItems.length} imagens normais da cena...`, "neutral");

  for (const item of remoteItems) {
    try {
      const info = await cachePlainSceneImage(item);
      cache.set(item.image.url, info);
      stats.cached += 1;
    } catch (error) {
      console.warn("Nao consegui otimizar imagem normal da cena", item.name, error);
      stats.cacheErrors += 1;
    }
  }

  return cache;
}

function migrateAssetUrl(rawUrl, publicBaseUrl, stats, remoteCache = new Map()) {
  const repairedUrl = repairNestedPublicUrl(rawUrl, stats);
  const cachedAsset = getCachedAssetInfo(repairedUrl, remoteCache);
  const urlToMigrate = cachedAsset?.url || repairedUrl;
  const filename = getMigratableAssetFilename(urlToMigrate);

  if (!filename) {
    return repairedUrl;
  }

  const nextUrl = `${publicBaseUrl}/assets/local-assets/${encodeAssetFilename(filename)}`;

  if (normalizeComparableUrl(rawUrl) === normalizeComparableUrl(nextUrl)) {
    return repairedUrl;
  }

  stats.urls += 1;
  return nextUrl;
}

function migrateFaceUrl(face, publicBaseUrl, stats, remoteCache) {
  const cachedAsset = getCachedAssetInfo(face.url, remoteCache);
  const nextUrl = migrateAssetUrl(face.url, publicBaseUrl, stats, remoteCache);

  if (
    normalizeComparableUrl(face.url) === normalizeComparableUrl(nextUrl) &&
    (!cachedAsset?.mime || face.mime === cachedAsset.mime)
  ) {
    return face;
  }

  return {
    ...face,
    url: nextUrl,
    width: cachedAsset?.width || face.width,
    height: cachedAsset?.height || face.height,
    mime: cachedAsset?.mime || face.mime,
  };
}

function migrateImageItem(item, publicBaseUrl, stats, remoteCache) {
  if (!item.image?.url) {
    return false;
  }

  const cachedAsset = getCachedAssetInfo(item.image.url, remoteCache);
  const nextUrl = migrateAssetUrl(item.image.url, publicBaseUrl, stats, remoteCache);

  if (
    normalizeComparableUrl(item.image.url) === normalizeComparableUrl(nextUrl) &&
    (!cachedAsset?.mime || item.image.mime === cachedAsset.mime)
  ) {
    return false;
  }

  item.image = {
    ...item.image,
    url: nextUrl,
    width: cachedAsset?.width || item.image.width,
    height: cachedAsset?.height || item.image.height,
    mime: cachedAsset?.mime || item.image.mime,
  };
  return true;
}

function migrateCardItem(item, publicBaseUrl, stats, remoteCache) {
  const metadata = getCardMetadata(item);

  if (!metadata) {
    return false;
  }

  const urlCountBefore = stats.urls;
  const nextMetadata = {
    ...metadata,
    faces: {
      front: migrateFaceUrl(metadata.faces.front, publicBaseUrl, stats, remoteCache),
      back: migrateFaceUrl(metadata.faces.back, publicBaseUrl, stats, remoteCache),
    },
  };
  nextMetadata.mirrorBack = shouldMirrorBackFace(
    nextMetadata.faces.front,
    nextMetadata.faces.back,
  );
  const currentFace = nextMetadata.faces[nextMetadata.currentFace] || nextMetadata.faces.front;
  const urlsChanged = stats.urls !== urlCountBefore;
  const divinitySizingChanged = needsDivinitySizing(item, currentFace);
  const mirrorChanged = metadata.mirrorBack !== nextMetadata.mirrorBack;

  if (!urlsChanged && !divinitySizingChanged && !mirrorChanged) {
    return false;
  }

  item.image = createImageData(currentFace);
  item.grid = createGridData(currentFace, nextMetadata.gridWidth, nextMetadata.origin);
  applyDivinitySizing(item, currentFace);
  applyCardFaceTransform(
    item,
    nextMetadata,
    nextMetadata.currentFace === "back" ? "back" : "front",
  );
  if (divinitySizingChanged) {
    stats.sized += 1;
  }
  setCardMetadata(item, nextMetadata);
  return true;
}

function migrateDeckItem(item, publicBaseUrl, stats, remoteCache) {
  const metadata = getDeckMetadata(item);

  if (!metadata) {
    return false;
  }

  const urlCountBefore = stats.urls;
  const nextCards = metadata.cards.map((card) => ({
    ...card,
    front: migrateFaceUrl(card.front, publicBaseUrl, stats, remoteCache),
  }));
  const nextMetadata = {
    ...metadata,
    back: migrateFaceUrl(metadata.back, publicBaseUrl, stats, remoteCache),
    cards: nextCards,
  };

  if (stats.urls === urlCountBefore) {
    return false;
  }

  nextMetadata.cards.length;
  applyDeckDisplay(item, nextMetadata);
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
    cached: 0,
    cacheErrors: 0,
    items: 0,
    urls: 0,
    sized: 0,
  };
  const remoteCache = await cachePlainRemoteSceneImages(items, stats);

  await obr.scene.items.updateItems(items, (draftItems) => {
    for (const item of draftItems) {
      const changed =
        migrateCardItem(item, publicBaseUrl, stats, remoteCache) ||
        migrateDeckItem(item, publicBaseUrl, stats, remoteCache) ||
        migrateImageItem(item, publicBaseUrl, stats, remoteCache);

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
  const cachedLabel =
    stats.cached === 1 ? "1 imagem normal otimizada" : `${stats.cached} imagens normais otimizadas`;
  const cacheErrorLabel =
    stats.cacheErrors === 1
      ? "1 imagem normal nao pode ser otimizada"
      : `${stats.cacheErrors} imagens normais nao puderam ser otimizadas`;
  const message = stats.urls
    ? `Migrei ${itemLabel} da cena para usar ${urlLabel} publicas${
        stats.sized || stats.cached || stats.cacheErrors
          ? `; ${[stats.cached ? cachedLabel : "", stats.sized ? divinityLabel : ""]
              .filter(Boolean)
              .concat(stats.cacheErrors ? [cacheErrorLabel] : [])
              .join("; ")}.`
          : "."
      }`
    : stats.sized
      ? `${divinityLabel}.`
      : cacheErrorLabel;

  setMessage(message, "success");
  await obr.notification.show(
    stats.urls ? "Links locais migrados para o GitHub Pages." : "Divindades ajustadas.",
    "SUCCESS",
  );
}

function getScenePresetEntry(presetId) {
  return scenePresetEntries.find((entry) => entry.definition.id === presetId) || null;
}

async function createDefaultBoardFromCurrentScene(presetId) {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para criar o mapa salvo.", "warning");
    return;
  }

  const definition = SCENE_PRESETS.find((preset) => preset.id === presetId);
  const confirmed = window.confirm(
    `Salvar "${definition?.name || "mapa salvo"}" vai substituir esse backup pelo estado atual da cena. Continuar?`,
  );

  if (!confirmed) {
    return;
  }

  const result = await saveScenePreset(obr, presetId);
  await refreshDefaultBoardInfo();

  const itemLabel = result.itemCount === 1 ? "1 item" : `${result.itemCount} itens`;
  const message = `${definition?.name || "Mapa salvo"} criado com ${itemLabel}.`;
  setMessage(message, "success");
  await obr.notification.show("Mapa salvo criado.", "SUCCESS");
}

async function restoreDefaultBoard(presetId) {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para restaurar o tabuleiro.", "warning");
    return;
  }

  const entry = getScenePresetEntry(presetId);

  if (!entry?.preset) {
    setMessage("Esse mapa salvo ainda nao foi cadastrado na extensao.", "warning");
    await obr.notification.show("Mapa salvo nao cadastrado.", "WARNING");
    return;
  }

  const confirmed = window.confirm(
    `${entry.definition.restoreLabel} vai substituir a cena atual. Continuar?`,
  );

  if (!confirmed) {
    return;
  }

  const result = await restoreDefaultBoardPreset(obr, entry.preset);
  updateDefaultBoardControls(true);

  const message = `Cena restaurada: ${result.updated} atualizados, ${result.added} recriados, ${result.deleted} removidos.`;
  setMessage(message, "success");
  await obr.notification.show(`${entry.definition.name} restaurado.`, "SUCCESS");
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

function getSelectedPresetCardGroup() {
  const selectedId = elements.presetCardGroupSelect.value;
  return presetCardGroups.find((group) => group.id === selectedId) || null;
}

function getSelectedPresetCard() {
  const group = getSelectedPresetCardGroup();
  const selectedId = elements.presetCardSelect.value;
  const card = group?.cards.find((entry) => entry.id === selectedId) || null;

  return { group, card };
}

function setPresetCardDefaultControls(group) {
  if (!group) {
    elements.presetCardGridWidth.value = "2";
    elements.presetCardLayer.value = "PROP";
    return;
  }

  elements.presetCardGridWidth.value = String(group.gridWidth || 2);
  if (
    [...elements.presetCardLayer.options].some((option) => option.value === group.layer)
  ) {
    elements.presetCardLayer.value = group.layer;
  } else {
    elements.presetCardLayer.value = "PROP";
  }
}

function shuffleCardsForMission(cards) {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function updateMissionDeckControls(isConnected = Boolean(obr)) {
  elements.createMissionDeckButton.disabled = !isConnected;
  elements.missionDeckInfo.textContent =
    "Selecione exatamente 5 cartas sacadas para unir em uma pilha temporaria.";
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

  syncAllCustomSelects();

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
    updateMissionDeckControls(Boolean(obr));
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
  updateMissionDeckControls(Boolean(obr));
}

function updatePresetCardControls(isConnected = Boolean(obr), syncDefaults = false) {
  const hasGroups = presetCardGroups.length > 0;
  const { group, card } = hasGroups ? getSelectedPresetCard() : { group: null, card: null };
  const hasCards = Boolean(group?.cards?.length);
  const isReady = isPresetCardReady(group, card);

  elements.presetCardGroupSelect.disabled = !hasGroups;
  elements.presetCardSelect.disabled = !hasCards;
  elements.presetCardGridWidth.disabled = !hasGroups;
  elements.presetCardLayer.disabled = !hasGroups;
  elements.importPresetCardButton.disabled = !isConnected || !isReady;

  if (syncDefaults) {
    setPresetCardDefaultControls(group);
  }

  syncAllCustomSelects();

  if (!hasGroups) {
    elements.presetCardInfo.textContent = "Nenhuma carta cadastrada na biblioteca.";
    return;
  }

  if (!group) {
    elements.presetCardInfo.textContent = "Escolha um grupo de cartas.";
    return;
  }

  if (!hasCards) {
    elements.presetCardInfo.textContent =
      "Este grupo ja existe no catalogo, mas ainda precisa de verso e cartas.";
    return;
  }

  if (!isReady) {
    elements.presetCardInfo.textContent =
      "Esta carta ainda precisa de frente e verso no catalogo.";
    return;
  }

  const categoryLabel = group.category
    ? " Marca automatica para selecao de personagem."
    : "";
  elements.presetCardInfo.textContent =
    `${group.cards.length} cartas cadastradas. Padrao: ${group.gridWidth} no grid.${categoryLabel}`;
}

function populatePresetCardSelect(syncDefaults = false) {
  const group = getSelectedPresetCardGroup();
  elements.presetCardSelect.replaceChildren();

  if (!group?.cards?.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhuma carta cadastrada";
    elements.presetCardSelect.append(option);
    updatePresetCardControls(Boolean(obr), syncDefaults);
    return;
  }

  for (const card of group.cards) {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = isPresetCardReady(group, card)
      ? card.name
      : `${card.name} (configurar imagens)`;
    elements.presetCardSelect.append(option);
  }

  updatePresetCardControls(Boolean(obr), syncDefaults);
}

function populatePresetCardGroupSelect() {
  elements.presetCardGroupSelect.replaceChildren();

  if (!presetCardGroups.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhuma carta cadastrada";
    elements.presetCardGroupSelect.append(option);
    populatePresetCardSelect(true);
    return;
  }

  for (const group of presetCardGroups) {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.cards.length
      ? `${group.name} (${group.cards.length})`
      : `${group.name} (configurar imagens)`;
    elements.presetCardGroupSelect.append(option);
  }

  populatePresetCardSelect(true);
}

async function loadPresetLibrary() {
  [presetDecks, presetCardGroups] = await Promise.all([
    loadPresetDecks(),
    loadPresetCardGroups(),
  ]);
  populatePresetDeckSelect();
  populatePresetCardGroupSelect();
}

function getPresetDeckGridWidth() {
  const gridWidth = Number.parseFloat(elements.presetDeckGridWidth.value);

  if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
    throw new Error("A largura no grid da biblioteca precisa ser maior que zero.");
  }

  return gridWidth;
}

function getPresetCardGridWidth() {
  const gridWidth = Number.parseFloat(elements.presetCardGridWidth.value);

  if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
    throw new Error("A largura no grid da carta precisa ser maior que zero.");
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

function getAverageItemPosition(items) {
  const positionedItems = items.filter(
    (item) =>
      Number.isFinite(item.position?.x) && Number.isFinite(item.position?.y),
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

async function addDeckToScene({
  name,
  back,
  cards,
  gridWidth,
  layer,
  position,
  deleteWhenEmpty = false,
}) {
  const deckPosition = position || (await getViewportCenter());
  const metadata = createDeckMetadata({ name, back, cards, gridWidth, deleteWhenEmpty });
  const item = buildImage(createImageData(back), createGridData(back, gridWidth))
    .name(`${name} (${cards.length})`)
    .description(deckDescription(cards.length))
    .text(createDeckText(cards.length))
    .layer(layer)
    .position(deckPosition)
    .metadata(createDeckMetadataMap(metadata))
    .build();

  await obr.scene.items.addItems([item]);
  return item;
}

async function addCardToScene({
  name,
  front,
  back,
  gridWidth,
  layer,
  category,
  origin,
  position,
}) {
  const cardPosition = position || (await getViewportCenter());
  const metadata = createCardMetadata({ name, front, back, gridWidth, origin });
  const metadataMap = createCardMetadataMap(metadata);

  if (category) {
    metadataMap[CARD_CATEGORY_KEY] = {
      version: 1,
      category,
    };
  }

  const item = buildImage(createImageData(front), createGridData(front, gridWidth, origin))
    .name(name)
    .description("Carta dupla: frente")
    .layer(layer)
    .position(cardPosition)
    .metadata(metadataMap)
    .build();

  applyCardFaceTransform(item, metadata, "front");
  applyDivinitySizing(item, front);
  await obr.scene.items.addItems([item]);
  return item;
}

async function getSelectedMissionCards() {
  const selection = await obr.player.getSelection();
  const itemIds = selection?.length ? selection : lastCardSelection;

  if (!itemIds.length) {
    throw new Error("Selecione exatamente 5 cartas sacadas.");
  }

  const items = await obr.scene.items.getItems(itemIds);
  const cards = getDoubleSidedCards(items);

  if (items.length !== 5 || cards.length !== 5) {
    throw new Error("Selecione exatamente 5 cartas duplas sacadas.");
  }

  return cards;
}

async function createMissionDeck() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para criar a pilha.", "warning");
    return;
  }

  elements.createMissionDeckButton.disabled = true;
  setMessage("Criando pilha de missao...", "neutral");

  try {
    const selectedCards = await getSelectedMissionCards();
    const firstMetadata = getCardMetadata(selectedCards[0]);
    const missionCards = shuffleCardsForMission(
      selectedCards.map((item) => {
        const metadata = getCardMetadata(item);

        return {
          name: metadata.name || item.name || "Carta",
          front: metadata.faces.front,
        };
      }),
    );
    const deck = await addDeckToScene({
      name: "Salas da Missao",
      back: firstMetadata.faces.back,
      cards: missionCards,
      gridWidth: firstMetadata.gridWidth || 1.5,
      layer: selectedCards[0].layer || "PROP",
      position: getAverageItemPosition(selectedCards),
      deleteWhenEmpty: true,
    });
    await obr.scene.items.deleteItems(selectedCards.map((item) => item.id));
    if (deck?.id) {
      await obr.player.select([deck.id], true);
      lastDeckSelection = [deck.id];
      lastFlipSelection = [deck.id];
    }
    lastCardSelection = [];
    await obr.notification.show("Pilha de missao criada.", "SUCCESS");
    setMessage("Pilha de missao criada com 5 cartas selecionadas.", "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui criar a pilha de missao.", "error");
  } finally {
    updateMissionDeckControls(Boolean(obr));
  }
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
    await addCardToScene({
      name,
      front,
      back,
      gridWidth,
      layer: elements.layer.value,
    });
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

async function createPresetCard() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para criar uma carta.", "warning");
    return;
  }

  const { group, card } = getSelectedPresetCard();
  if (!group || !card) {
    setMessage("Escolha uma carta da biblioteca.", "warning");
    return;
  }

  if (!isPresetCardReady(group, card)) {
    setMessage("Esta carta ainda precisa de frente e verso no catalogo.", "warning");
    return;
  }

  elements.importPresetCardButton.disabled = true;
  setMessage("Criando carta da biblioteca...", "neutral");

  try {
    const cardData = await buildPresetCardData(group, card);
    const gridWidth = getPresetCardGridWidth();
    await addCardToScene({
      ...cardData,
      gridWidth,
      layer: elements.presetCardLayer.value || cardData.layer,
      origin: cardData.origin,
    });
    await obr.notification.show(`Carta "${cardData.name}" criada.`);
    setMessage(`Carta "${cardData.name}" criada da biblioteca.`, "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui criar a carta da biblioteca.", "error");
  } finally {
    updatePresetCardControls(Boolean(obr));
  }
}

async function init() {
  enhancePanelSelects();

  if (elements.form) {
    elements.form.addEventListener("submit", createCard);
  }
  if (elements.deckForm) {
    elements.deckForm.addEventListener("submit", createDeck);
  }
  elements.presetDeckSelect.addEventListener("change", () =>
    updatePresetDeckControls(Boolean(obr), true),
  );
  elements.presetCardGroupSelect.addEventListener("change", () =>
    populatePresetCardSelect(true),
  );
  elements.presetCardSelect.addEventListener("change", () =>
    updatePresetCardControls(Boolean(obr)),
  );
  elements.importPresetDeckButton.addEventListener("click", () =>
    createPresetDeck().catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui criar a pilha da biblioteca.", "error");
    }),
  );
  elements.importPresetCardButton.addEventListener("click", () =>
    createPresetCard().catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui criar a carta da biblioteca.", "error");
    }),
  );
  elements.createMissionDeckButton.addEventListener("click", () =>
    createMissionDeck().catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui criar a pilha de missao.", "error");
    }),
  );
  loadPresetLibrary().catch((error) => {
    console.warn(error);
    presetDecks = [];
    presetCardGroups = [];
    populatePresetDeckSelect();
    populatePresetCardGroupSelect();
    elements.presetDeckInfo.textContent =
      error.message || "Nao consegui carregar a biblioteca de pilhas.";
    elements.presetCardInfo.textContent =
      error.message || "Nao consegui carregar a biblioteca de cartas.";
  });
  elements.publicBaseUrl.value = getDefaultPublicBaseUrl();
  elements.panelFlipButton.addEventListener("click", () =>
    runPanelAction(elements.panelFlipButton, async () => {
      const fallbackSelection = lastFlipSelection.length
        ? lastFlipSelection
        : lastDeckSelection.length
          ? lastDeckSelection
          : lastCardSelection;
      const count = await flipSelectedItems(obr, fallbackSelection);
      await showPanelActionResult(
        count,
        "Carta virada.",
        (total) => `${total} itens virados.`,
        "Selecione uma carta dupla ou uma pilha com cartas para virar.",
      );
    }),
  );
  elements.panelDrawButton.addEventListener("click", () =>
    runPanelAction(elements.panelDrawButton, async () => {
      const count = await drawSelectedDecks(obr, buildImage, lastDeckSelection);
      if (count) {
        lastFlipSelection = lastDeckSelection;
        lastCardSelection = [];
      }
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
          "Selecione uma carta comprada com pilha de origem.",
        );
        return;
      }

      lastCardSelection = [];
      lastFlipSelection = lastDeckSelection;
      setMessage("", "neutral");
    }),
  );
  elements.returnOriginButton.addEventListener("click", () =>
    runPanelAction(elements.returnOriginButton, async () => {
      await returnSelectedCardToOrigin(obr, lastCardSelection);
      const message = "Carta devolvida para a posicao original.";
      setMessage(message, "success");
      await obr.notification.show(message, "SUCCESS");
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
  for (const button of elements.createScenePresetButtons) {
    button.addEventListener("click", () =>
      runPanelAction(button, () => createDefaultBoardFromCurrentScene(button.dataset.createScenePreset)),
    );
  }
  for (const button of elements.restoreScenePresetButtons) {
    button.addEventListener("click", () =>
      runPanelAction(button, () => restoreDefaultBoard(button.dataset.restoreScenePreset)),
    );
  }

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
      (await import("./" + "sdk-client.js?v=65").then((sdkModule) =>
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
    await refreshPlayerColorAssignments();
    obr.player.onChange((player) => {
      rememberCardSelection(player.selection).catch((error) => {
        console.warn("Nao consegui atualizar a selecao de cartas", error);
      });
      rememberDeckSelection(player.selection).catch((error) => {
        console.warn("Nao consegui atualizar a selecao de pilhas", error);
      });
      schedulePlayerColorAssignmentsRefresh();
    });
    if (obr.party?.onChange) {
      obr.party.onChange((players) => {
        schedulePlayerColorAssignmentsRefresh(players);
      });
    }
    if (colorAssignmentsRefreshTimer) {
      window.clearTimeout(colorAssignmentsRefreshTimer);
    }
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
