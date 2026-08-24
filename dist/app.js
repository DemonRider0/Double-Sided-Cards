const process = { env: { NODE_ENV: "production" } };

const EXTENSION_ID = "br.demonrider.double-sided-cards";
const REGISTRATION_ID = EXTENSION_ID;
const METADATA_KEY = `${EXTENSION_ID}/card`;
const DECK_METADATA_KEY = `${EXTENSION_ID}/deck`;
const COMMANDS_CHANNEL = `${REGISTRATION_ID}/commands`;

const CARD_CATEGORY_METADATA_KEY = `${EXTENSION_ID}/card-category`;
const CARD_CATEGORY_GRID_WIDTHS = new Map([
  ["class", 3],
  ["race", 3],
  ["divinity", 2],
]);
const VALID_FACES = new Set(["front", "back"]);

function isObject$1(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validationFailure(code, message, details = {}) {
  return {
    ok: false,
    code,
    message,
    ...details,
  };
}

function validationSuccess(value, details = {}) {
  return {
    ok: true,
    value,
    ...details,
  };
}

function cloneSerializableValue(value, seen) {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Metadata contem um numero nao finito.");
    }

    return value;
  }

  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "object") {
    throw new TypeError("Metadata contem um valor nao serializavel.");
  }

  if (seen.has(value)) {
    throw new TypeError("Metadata contem uma referencia circular.");
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        const clonedEntry = cloneSerializableValue(entry, seen);

        if (typeof clonedEntry === "undefined") {
          throw new TypeError("Metadata contem uma entrada de array indefinida.");
        }

        return clonedEntry;
      });
    }

    const prototype = Object.getPrototypeOf(value);

    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length
    ) {
      throw new TypeError("Metadata contem um objeto nao serializavel.");
    }

    const clone = {};

    for (const [key, entry] of Object.entries(value)) {
      const clonedEntry = cloneSerializableValue(entry, seen);

      if (typeof clonedEntry !== "undefined") {
        Object.defineProperty(clone, key, {
          value: clonedEntry,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }

    return clone;
  } finally {
    seen.delete(value);
  }
}

function cloneMetadataValue(value) {
  return cloneSerializableValue(value, new WeakSet());
}

function metadataValuesEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }

  if (
    left == null ||
    right == null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => metadataValuesEqual(entry, right[index]))
    );
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        metadataValuesEqual(left[key], right[key]),
    )
  );
}

function comparableUrl(value) {
  const rawValue = typeof value === "string" ? value.trim() : "";

  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue, "https://comparison.invalid/");
    url.hash = "";
    return url.toString();
  } catch {
    return rawValue.replace(/#.*$/, "");
  }
}

function imageUrlsMatch(left, right) {
  const leftUrl = comparableUrl(left);
  const rightUrl = comparableUrl(right);
  return Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
}

function positiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}

function isCardMetadata(value) {
  return Boolean(isObject$1(value) && value.version === 1);
}

function isDeckMetadata(value) {
  return Boolean(isObject$1(value) && value.version === 1);
}

function getCardMetadata(item) {
  const metadata = item.metadata?.[METADATA_KEY];
  return isCardMetadata(metadata) ? metadata : null;
}

function getDeckMetadata(item) {
  const metadata = item.metadata?.[DECK_METADATA_KEY];
  return isDeckMetadata(metadata) ? metadata : null;
}

function normalizeImageData(value, options = {}) {
  if (!isObject$1(value) || typeof value.url !== "string" || !value.url.trim()) {
    return validationFailure("invalid-image-url", "A imagem nao possui uma URL valida.");
  }

  let image;

  try {
    image = cloneMetadataValue(value);
  } catch (error) {
    return validationFailure("invalid-image-data", error.message);
  }

  const fallbackImage =
    isObject$1(options.fallbackImage) &&
    imageUrlsMatch(image.url, options.fallbackImage.url)
      ? options.fallbackImage
      : null;
  const width = positiveFinite(image.width)
    ? image.width
    : positiveFinite(fallbackImage?.width)
      ? fallbackImage.width
      : null;
  const height = positiveFinite(image.height)
    ? image.height
    : positiveFinite(fallbackImage?.height)
      ? fallbackImage.height
      : null;

  if (!width || !height) {
    return validationFailure(
      "invalid-image-dimensions",
      "A imagem nao possui dimensoes positivas e confiaveis.",
    );
  }

  image.width = width;
  image.height = height;
  image.mime =
    typeof image.mime === "string" && image.mime.trim()
      ? image.mime
      : getMimeFromUrl(image.url);

  return validationSuccess(image, {
    usedVisualFallback:
      width !== value.width || height !== value.height,
  });
}

function getCategoryGridWidth(item) {
  const category = item?.metadata?.[CARD_CATEGORY_METADATA_KEY]?.category;
  return CARD_CATEGORY_GRID_WIDTHS.get(category) || null;
}

function resolveGridWidth(value, options = {}) {
  if (positiveFinite(value)) {
    return validationSuccess(value, { source: "metadata" });
  }

  const face = options.face;
  const item = options.item;

  if (
    positiveFinite(face?.width) &&
    positiveFinite(item?.grid?.dpi) &&
    imageUrlsMatch(face.url, item?.image?.url)
  ) {
    const visualGridWidth = face.width / item.grid.dpi;

    if (positiveFinite(visualGridWidth)) {
      return validationSuccess(visualGridWidth, { source: "item-visual" });
    }
  }

  const categoryGridWidth = getCategoryGridWidth(item);

  if (positiveFinite(categoryGridWidth)) {
    return validationSuccess(categoryGridWidth, { source: "category-default" });
  }

  if (positiveFinite(options.creatorDefault)) {
    return validationSuccess(options.creatorDefault, { source: "creator-default" });
  }

  return validationFailure(
    "invalid-grid-width",
    "Nao foi possivel determinar uma largura de grid segura.",
  );
}

function normalizeOrigin$1(value) {
  if (value == null) {
    return validationSuccess(null, { present: false });
  }

  if (!isObject$1(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    return validationFailure("invalid-origin", "A origem da carta nao e valida.");
  }

  return validationSuccess(
    {
      x: value.x,
      y: value.y,
    },
    { present: true },
  );
}

function faceFromExactImageMatch(faces, item) {
  const frontMatches = imageUrlsMatch(item?.image?.url, faces.front.url);
  const backMatches = imageUrlsMatch(item?.image?.url, faces.back.url);

  if (frontMatches !== backMatches) {
    return frontMatches ? "front" : "back";
  }

  return null;
}

function historicalCardFace(faces, item) {
  if (
    imageUrlsMatch(faces.front.url, faces.back.url) &&
    Number.isFinite(item?.scale?.x) &&
    item.scale.x < 0
  ) {
    return "back";
  }

  const description = typeof item?.description === "string" ? item.description.trim() : "";

  if (/^Carta dupla:\s*verso$/i.test(description)) {
    return "back";
  }

  if (/^Carta dupla:\s*frente$/i.test(description)) {
    return "front";
  }

  return null;
}

function resolveCardCurrentFace(value, faces, item) {
  if (VALID_FACES.has(value)) {
    return validationSuccess(value, { source: "metadata" });
  }

  const exactMatch = faceFromExactImageMatch(faces, item);

  if (exactMatch) {
    return validationSuccess(exactMatch, { source: "item-image" });
  }

  const historicalFace = historicalCardFace(faces, item);

  return validationSuccess(historicalFace || "front", {
    source: historicalFace ? "historical-visual" : "creator-default",
  });
}

function resolveDeckCurrentFace(value, back, cards, item) {
  if (VALID_FACES.has(value)) {
    return validationSuccess(value, { source: "metadata" });
  }

  const topFront = cards[0]?.front;
  const frontMatches = imageUrlsMatch(item?.image?.url, topFront?.url);
  const backMatches = imageUrlsMatch(item?.image?.url, back.url);

  if (frontMatches !== backMatches) {
    return validationSuccess(frontMatches ? "front" : "back", {
      source: "item-image",
    });
  }

  // Pilhas criadas antes de currentFace sempre eram exibidas pelo verso.
  return validationSuccess("back", { source: "historical-default" });
}

function getFallbackName(value, itemName, fallback) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof itemName === "string" && itemName.trim()) {
    return itemName.replace(/\s+\(\d+\)\s*$/, "").trim() || fallback;
  }

  return fallback;
}

function normalizeCardMetadata(value, options = {}) {
  if (!isCardMetadata(value)) {
    return validationFailure(
      "unrecognized-card-metadata",
      "A metadata da carta nao possui uma versao reconhecida.",
    );
  }

  let metadata;

  try {
    metadata = cloneMetadataValue(value);
  } catch (error) {
    return validationFailure("invalid-card-metadata", error.message);
  }

  const front = normalizeImageData(metadata.faces?.front, {
    fallbackImage: options.item?.image,
  });
  const back = normalizeImageData(metadata.faces?.back, {
    fallbackImage: options.item?.image,
  });

  if (!front.ok || !back.ok) {
    return validationFailure(
      "invalid-card-faces",
      !front.ok ? front.message : back.message,
      { face: !front.ok ? "front" : "back" },
    );
  }

  const currentFace = resolveCardCurrentFace(
    metadata.currentFace,
    {
      front: front.value,
      back: back.value,
    },
    options.item,
  );
  const currentImage = currentFace.value === "back" ? back.value : front.value;
  const gridWidth = resolveGridWidth(metadata.gridWidth, {
    item: options.item,
    face: currentImage,
    creatorDefault: 2,
  });

  if (!gridWidth.ok) {
    return gridWidth;
  }

  const origin = normalizeOrigin$1(metadata.origin);

  metadata.name = getFallbackName(metadata.name, options.item?.name, "Carta");
  metadata.currentFace = currentFace.value;
  metadata.gridWidth = gridWidth.value;
  metadata.faces = {
    ...metadata.faces,
    front: front.value,
    back: back.value,
  };
  metadata.mirrorBack =
    typeof metadata.mirrorBack === "boolean"
      ? metadata.mirrorBack
      : shouldMirrorBackFace(front.value, back.value);

  if (origin.ok && origin.present) {
    metadata.origin = origin.value;
  } else if (!origin.ok) {
    delete metadata.origin;
  }

  return validationSuccess(metadata, {
    fallbacks: {
      currentFace: currentFace.source,
      gridWidth: gridWidth.source,
      origin: origin.ok ? (origin.present ? "metadata" : "missing") : "invalid-ignored",
    },
  });
}

function normalizeDeckCardEntry(value, options = {}) {
  if (!isObject$1(value)) {
    return validationFailure("invalid-deck-card", "A entrada da pilha nao e um objeto.");
  }

  let card;

  try {
    card = cloneMetadataValue(value);
  } catch (error) {
    return validationFailure("invalid-deck-card", error.message);
  }

  const front = normalizeImageData(card.front, {
    fallbackImage: options.fallbackImage,
  });

  if (!front.ok) {
    return validationFailure("invalid-deck-card-front", front.message);
  }

  card.front = front.value;
  card.name = getFallbackName(card.name, "", "Carta");

  if (card.back != null) {
    const back = normalizeImageData(card.back, {
      fallbackImage: options.fallbackImage,
    });

    if (!back.ok) {
      return validationFailure("invalid-deck-card-back", back.message);
    }

    card.back = back.value;
  }

  if (card.gridWidth != null && !positiveFinite(card.gridWidth)) {
    delete card.gridWidth;
  }

  const origin = normalizeOrigin$1(card.origin);

  if (origin.ok && origin.present) {
    card.origin = origin.value;
  } else if (!origin.ok) {
    delete card.origin;
  }

  if (card.mirrorBack != null && typeof card.mirrorBack !== "boolean") {
    delete card.mirrorBack;
  }

  return validationSuccess(card);
}

function normalizeDeckMetadata(value, options = {}) {
  if (!isDeckMetadata(value)) {
    return validationFailure(
      "unrecognized-deck-metadata",
      "A metadata da pilha nao possui uma versao reconhecida.",
    );
  }

  let metadata;

  try {
    metadata = cloneMetadataValue(value);
  } catch (error) {
    return validationFailure("invalid-deck-metadata", error.message);
  }

  if (!Array.isArray(metadata.cards)) {
    return validationFailure(
      "invalid-deck-cards",
      "A pilha nao possui uma lista de cartas valida.",
    );
  }

  const back = normalizeImageData(metadata.back, {
    fallbackImage: options.item?.image,
  });

  if (!back.ok) {
    return validationFailure("invalid-deck-back", back.message);
  }

  const cards = [];

  for (let index = 0; index < metadata.cards.length; index += 1) {
    const card = normalizeDeckCardEntry(metadata.cards[index], {
      fallbackImage: index === 0 ? options.item?.image : null,
    });

    if (!card.ok) {
      return validationFailure(
        "invalid-deck-card",
        `A carta ${index + 1} da pilha possui dados incompletos.`,
        {
          cardIndex: index,
          cause: card.code,
        },
      );
    }

    cards.push(card.value);
  }

  const currentFace = resolveDeckCurrentFace(
    metadata.currentFace,
    back.value,
    cards,
    options.item,
  );
  const displayedFace =
    currentFace.value === "front" && cards[0]?.front
      ? cards[0].front
      : back.value;
  const gridWidth = resolveGridWidth(metadata.gridWidth, {
    item: options.item,
    face: displayedFace,
    creatorDefault: 2,
  });

  if (!gridWidth.ok) {
    return gridWidth;
  }

  metadata.name = getFallbackName(metadata.name, options.item?.name, "Pilha");
  metadata.currentFace = currentFace.value;
  metadata.back = back.value;
  metadata.cards = cards;
  metadata.gridWidth = gridWidth.value;

  return validationSuccess(metadata, {
    fallbacks: {
      currentFace: currentFace.source,
      gridWidth: gridWidth.source,
    },
  });
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

function normalizeComparableUrl(value) {
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

  if (normalizeComparableUrl(front.url) === normalizeComparableUrl(back.url)) {
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
  mirrorBack,
  sourceDeckId,
  sourceDeckName,
}) {
  const metadata = {
    version: 1,
    name,
    currentFace,
    gridWidth,
    mirrorBack:
      typeof mirrorBack === "boolean" ? mirrorBack : shouldMirrorBackFace(front, back),
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
  if (
    !face ||
    typeof face.url !== "string" ||
    !face.url.trim() ||
    !positiveFinite(face.width) ||
    !positiveFinite(face.height)
  ) {
    throw new TypeError("Nao foi possivel criar uma imagem com dados incompletos.");
  }

  return {
    url: face.url,
    width: face.width,
    height: face.height,
    mime:
      typeof face.mime === "string" && face.mime.trim()
        ? face.mime
        : getMimeFromUrl(face.url),
  };
}

function createGridData(face, gridWidth, origin) {
  if (!positiveFinite(face?.width) || !positiveFinite(face?.height)) {
    throw new TypeError("Nao foi possivel criar o grid sem dimensoes validas.");
  }

  if (!positiveFinite(gridWidth)) {
    throw new TypeError("Nao foi possivel criar o grid sem uma largura valida.");
  }

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
const activeMissionDeckCreations = new Set();
const RETURNED_SCENE_ITEM_ID_FIELD = "returnedSceneItemId";
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
  return Object.fromEntries(
    Object.entries(value || {})
      .filter(([key]) => !knownFields.has(key))
      .map(([key, entry]) => [key, cloneSerializable(entry)]),
  );
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
    throw new Error(`Esta pilha possui dados incompletos e não pode ser ${operation}.`);
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
    throw new Error("A primeira carta da pilha de missão possui dados incompletos.");
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
    throw new Error("Não consegui reler as cartas da pilha de missão.");
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
    throw new Error("Não consegui verificar a pilha de missão criada.");
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
      "Não consegui apagar todas as cartas e a pilha já foi alterada; preservei o estado mais recente.",
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
        "Não consegui apagar as cartas originais; a nova pilha foi removida com segurança.",
      );
    }

    throw new Error(
      "Não consegui apagar as cartas originais nem remover a nova pilha automaticamente.",
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
      "Algumas cartas não foram apagadas; a pilha foi ajustada para evitar duplicação.",
    );
  }

  throw new Error(
    "Algumas cartas não foram apagadas e não foi seguro ajustar a pilha automaticamente.",
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
      throw new Error("Não consegui criar a pilha de missão; as cartas foram preservadas.");
    }

    throw new Error(
      "A criação da pilha falhou e não foi seguro remover uma pilha residual automaticamente.",
    );
  }

  const createdDeck = await readMissionDeck(
    OBR,
    operation.deckId,
    operation,
    "confirmacao de addItems",
  );

  if (!createdDeck || !missionDeckMatchesInitial(createdDeck, operation)) {
    throw new Error("Não consegui confirmar a pilha de missão criada.");
  }
}

async function createMissionDeckFromSelection(OBR, buildImage) {
  let selection;

  try {
    selection = (await OBR.player.getSelection()) || [];
  } catch (error) {
    logMissionDeckFailure("leitura da selecao", error, null);
    throw new Error("Não consegui ler a seleção atual.");
  }

  if (selection.length !== 5 || new Set(selection).size !== 5) {
    throw new Error("Selecione exatamente 5 cartas duplas sacadas.");
  }

  const sourceIds = [...selection];
  const operationKey = missionCreationKey(sourceIds);

  if (activeMissionDeckCreations.has(operationKey)) {
    throw new Error("Esta pilha de missão já está sendo criada.");
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
      throw new Error("Não consegui confirmar a seleção atual.");
    }

    if (!sameItemIds(sourceIds, currentSelection)) {
      throw new Error("A seleção mudou; selecione novamente as 5 cartas.");
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
          throw new Error("Uma das cartas selecionadas deixou de ser compatível.");
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
      throw new Error("Não consegui preparar os dados da pilha de missão.");
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
        throw new Error("Não consegui montar a carta; a pilha foi restaurada.");
      }
    } catch (rollbackError) {
      if (rollbackError.message === "Não consegui montar a carta; a pilha foi restaurada.") {
        throw rollbackError;
      }

      console.warn("Nao consegui restaurar a pilha apos falha ao montar carta", rollbackError);
      throw new Error(
        "Não consegui montar a carta e também não consegui restaurar a pilha automaticamente.",
      );
    }

    throw new Error(
      "Não consegui montar a carta; a pilha mudou depois da compra e não foi alterada de novo.",
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
        "Não consegui criar a carta e também não consegui restaurar a pilha automaticamente.",
      );
    }

    if (rollbackSucceeded) {
      throw new Error("Não consegui criar a carta; a pilha foi restaurada.");
    }

    console.warn("Compra parcial sem rollback seguro", error);
    throw new Error(
      "Não consegui criar a carta; a pilha mudou depois da compra e não foi alterada de novo.",
    );
  }

  if (operation.deleteWhenEmpty) {
    try {
      await OBR.scene.items.deleteItems([operation.deckId]);
      return { count: 1, deckId, deckDeleted: true };
    } catch (error) {
      console.warn("Carta comprada, mas nao consegui apagar a pilha temporaria vazia", error);
      await OBR.notification
        .show("Carta comprada, mas não consegui apagar a pilha vazia.", "WARNING")
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

async function flipDeckItems(OBR, items) {
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
  const returnedCard = {
    ...cloneUnknownFields(metadata, CARD_METADATA_FIELDS),
    name: metadata.name || card.name || "Carta",
    front: cloneSerializable(metadata.faces.front),
    back: cloneSerializable(metadata.faces.back),
    gridWidth: metadata.gridWidth,
    mirrorBack: shouldMirrorCardBack(metadata),
    [RETURNED_SCENE_ITEM_ID_FIELD]: card.id,
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
    throw new Error("Não consegui reler a carta para devolver.");
  }
}

async function readDeckById(OBR, deckId, stage) {
  try {
    const [item] = await OBR.scene.items.getItems([deckId]);
    return item || null;
  } catch (error) {
    logReturnFailure(`releitura da pilha (${stage})`, error, { deckId });
    throw new Error("Não consegui reler a pilha de origem.");
  }
}

function getReturnSourceDeckId(card) {
  const metadata = getNormalizedCard(card);
  const deckId = metadata?.sourceDeckId;

  return typeof deckId === "string" && deckId.length ? deckId : "";
}

function buildReturnOperation(card, deck, metadata, returnedCard) {
  const preReturnCards = metadata.cards.map(cloneDeckCard);
  const alreadyReturned = preReturnCards.some(
    (entry) => entry?.[RETURNED_SCENE_ITEM_ID_FIELD] === card.id,
  );
  const postReturnCards = alreadyReturned
    ? preReturnCards.map(cloneDeckCard)
    : [...preReturnCards, cloneDeckCard(returnedCard)];

  return {
    cardId: card.id,
    deckId: deck.id,
    deckName: metadata.name,
    returnedCard: cloneDeckCard(returnedCard),
    preReturnCards,
    postReturnCards,
    appended: !alreadyReturned,
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

    if (!operation.appended) {
      return;
    }

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

  if (!operation.appended) {
    throw new Error(
      "A pilha já registrou esta carta, mas não consegui apagá-la da cena.",
    );
  }

  let rollbackSucceeded = false;

  try {
    rollbackSucceeded = await rollbackReturnedCard(OBR, operation);
  } catch (rollbackError) {
    logReturnFailure("rollback", rollbackError, operation);
    throw new Error(
      "Não consegui apagar a carta e também não consegui restaurar a pilha automaticamente.",
    );
  }

  if (rollbackSucceeded) {
    console.warn("Rollback seguro realizado apos falha ao apagar carta devolvida", {
      cardId: operation.cardId,
      deckId: operation.deckId,
    });
    throw new Error("Não consegui apagar a carta; a pilha foi restaurada.");
  }

  console.warn("Rollback recusado porque a pilha mudou apos a devolucao", {
    cardId: operation.cardId,
    deckId: operation.deckId,
  });
  throw new Error(
    "Não consegui apagar a carta; a pilha mudou depois da devolução e não foi alterada de novo.",
  );
}

async function returnSingleCardToDeck(OBR, cardId) {
  const initialCard = await readCardById(OBR, cardId, "inicial");

  if (!initialCard) {
    console.warn("A carta selecionada ja nao existe na cena", { cardId });
    return { count: 0, deckId: null };
  }

  if (!getNormalizedCard(initialCard, "devolucao", true)) {
    throw new Error("Esta carta possui dados incompletos e não pode ser devolvida.");
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
      throw new Error("Esta carta possui dados incompletos e não pode ser devolvida.");
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
      throw new Error("A pilha de origem possui dados incompletos e não aceita devolução.");
    }

    let operation = null;

    try {
      operation = await applyReturnToDeck(OBR, currentCard, sourceDeckId);
    } catch (error) {
      logReturnFailure("updateItems", error, { cardId, deckId: sourceDeckId });
      throw new Error("Não consegui atualizar a pilha para devolver a carta.");
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

const COLOR_TOKEN_KEY = `${EXTENSION_ID}/color-token`;
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
const selectionOperationTails = new Map();
Promise.resolve();

function isRecord$4(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function copyDefinedRecord(value) {
  if (!isRecord$4(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
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
  const emptyState = createEmptyState();

  if (!isRecord$4(value)) {
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

async function returnSelectedCardToOrigin(OBR, fallbackSelection = []) {
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

const DIVINITY_GRID_WIDTH = 2;
const DIVINITY_GRID_HEIGHT = 3;
const DIVINITY_ORIGIN = {
  x: 390,
  y: 395,
};
const EPSILON = 0.0001;

function hasValidDimensions(face) {
  return (
    Number.isFinite(face?.width) &&
    face.width > 0 &&
    Number.isFinite(face?.height) &&
    face.height > 0
  );
}

function isDivinityCategoryItem(item) {
  return item?.metadata?.[CARD_CATEGORY_KEY]?.category === "divinity";
}

function getDivinityGridData(face) {
  if (!hasValidDimensions(face)) {
    throw new TypeError("Nao foi possivel dimensionar a divindade sem imagem valida.");
  }

  const dpi = Math.max(1, face.width / DIVINITY_GRID_WIDTH);

  return {
    dpi,
    offset: { ...DIVINITY_ORIGIN },
  };
}

function getDivinityScale(face) {
  if (!hasValidDimensions(face)) {
    throw new TypeError("Nao foi possivel dimensionar a divindade sem imagem valida.");
  }

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
  if (!isDivinityCategoryItem(item) || !hasValidDimensions(face)) {
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
  if (!isDivinityCategoryItem(item) || !hasValidDimensions(face)) {
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
  const decks = getDeckItems(items);

  if (decks.length) {
    return decks;
  }

  return getDoubleSidedCards(items);
}

function requireNormalizedCard(item) {
  const result = normalizeCardMetadata(getCardMetadata(item), { item });

  if (!result.ok) {
    console.warn("Carta incompativel durante a virada", {
      itemId: item?.id,
      itemName: item?.name,
      code: result.code,
      face: result.face,
    });
    throw new Error("Esta carta possui dados incompletos e não pode ser virada.");
  }

  return result.value;
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
    itemsToFlip.forEach(requireNormalizedCard);

    await OBR.scene.items.updateItems(itemsToFlip, (draftItems) => {
      for (const item of draftItems) {
        const metadata = requireNormalizedCard(item);
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

const PRIVATE_ASSET_STATE_VERSION = 1;

const PRIVATE_ASSET_PACK_FORMAT = "double-sided-cards-private-asset-pack";
const PRIVATE_ASSET_PACK_VERSION = 2;
const PRIVATE_ASSET_PACK_SUPPORTED_VERSIONS = Object.freeze([1, 2]);
const PRIVATE_ASSET_STORAGE_KEY =
  "br.demonrider.double-sided-cards/private-asset-pack";
const PRIVATE_ASSET_MAX_FILE_SIZE = 25_000_000;
const PRIVATE_ASSET_UPLOAD_FORMATS = Object.freeze({
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
});

let cachedStorage = null;
let cachedRawState = undefined;
let cachedState = null;
let cachedResolver = null;

function isRecord$3(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clone$1(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getDefaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeSlashes(value) {
  return String(value || "").replaceAll("\\", "/");
}

function getPrivateAssetUploadMime(value) {
  const fileName = normalizeSlashes(value).split("/").filter(Boolean).pop() || "";
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : "";
  return PRIVATE_ASSET_UPLOAD_FORMATS[extension] || null;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function addPathCandidates(candidates, rawPath) {
  const decoded = safeDecode(normalizeSlashes(rawPath))
    .replace(/[?#].*$/, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");

  if (!decoded) {
    return;
  }

  candidates.add(decoded);

  const repositoryMarker = "Double-Sided-Cards/";
  const repositoryIndex = decoded.indexOf(repositoryMarker);
  if (repositoryIndex >= 0) {
    candidates.add(decoded.slice(repositoryIndex + repositoryMarker.length));
  }

  const assetsIndex = decoded.indexOf("assets/");
  if (assetsIndex >= 0) {
    candidates.add(decoded.slice(assetsIndex));
  }

  const localMarker = ".local-assets/";
  const localIndex = decoded.indexOf(localMarker);
  if (localIndex >= 0) {
    const filename = decoded.slice(localIndex + localMarker.length);
    candidates.add(`${localMarker}${filename}`);
    candidates.add(`assets/local-assets/${filename}`);
  }

  const publishedLocalMarker = "assets/local-assets/";
  const publishedLocalIndex = decoded.indexOf(publishedLocalMarker);
  if (publishedLocalIndex >= 0) {
    const filename = decoded.slice(publishedLocalIndex + publishedLocalMarker.length);
    candidates.add(`${localMarker}${filename}`);
    candidates.add(`${publishedLocalMarker}${filename}`);
  }
}

function getAssetAliasCandidates(value) {
  const candidates = new Set();
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) {
    return [];
  }

  candidates.add(raw);

  const nestedMatches = [...raw.matchAll(/https?:\/\//gi)];
  if (nestedMatches.length > 1) {
    const nested = raw.slice(nestedMatches[nestedMatches.length - 1].index);
    if (nested && nested !== raw) {
      for (const candidate of getAssetAliasCandidates(nested)) {
        candidates.add(candidate);
      }
    }
  }

  addPathCandidates(candidates, raw);

  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    candidates.add(url.toString());
    addPathCandidates(candidates, url.pathname);

    if (url.hostname.toLowerCase() === "images.owlbear.rodeo") {
      const filename = safeDecode(url.pathname.split("/").filter(Boolean).pop() || "");
      const assetId = filename.replace(/\.[^.]+$/, "");
      if (assetId) {
        candidates.add(`owlbear:${assetId}`);
      }
    }
  } catch {
    // Caminhos relativos e IDs lógicos são candidatos válidos sem serem URLs.
  }

  return [...candidates].filter(Boolean);
}

function assertSafeRelativePath(value, label) {
  const normalized = normalizeSlashes(value).replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`${label} precisa ser um caminho relativo dentro do pack.`);
  }
  return normalized;
}

function normalizeSha256$1(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} precisa ser um SHA-256 no formato sha256:<hex>.`);
  }
  return normalized;
}

function isSupportedPrivateAssetPackVersion(version) {
  return PRIVATE_ASSET_PACK_SUPPORTED_VERSIONS.includes(version);
}

function validatePrivateAssetPack(value) {
  if (
    !isRecord$3(value) ||
    value.format !== PRIVATE_ASSET_PACK_FORMAT ||
    !isSupportedPrivateAssetPackVersion(value.version) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    !isRecord$3(value.assets) ||
    !isRecord$3(value.aliases) ||
    !isRecord$3(value.presets)
  ) {
    throw new Error("O Private Asset Pack possui uma estrutura inválida.");
  }

  const sourceFormatVersion = value.version;
  const pack = clone$1(value);
  pack.version = PRIVATE_ASSET_PACK_VERSION;
  pack.sourceFormatVersion = sourceFormatVersion;
  for (const [assetId, asset] of Object.entries(pack.assets)) {
    if (!assetId || !isRecord$3(asset)) {
      throw new Error("O Private Asset Pack possui um asset canônico inválido.");
    }
    asset.file = assertSafeRelativePath(asset.file, `O asset ${assetId}`);
    const logicalSha256 = normalizeSha256$1(assetId, `O asset lógico ${assetId}`);
    asset.blobSha256 = normalizeSha256$1(
      sourceFormatVersion === 1 ? asset.blobSha256 || logicalSha256 : asset.blobSha256,
      `O hash físico do asset ${assetId}`,
    );
    const expectedMime = getPrivateAssetUploadMime(asset.file);
    if (!expectedMime) {
      throw new Error(
        `O asset ${assetId} usa um formato não suportado para upload no Owlbear: ${asset.file}.`,
      );
    }
    const declaredMime =
      typeof asset.mime === "string" ? asset.mime.trim().toLowerCase() : "";
    if (declaredMime !== expectedMime) {
      throw new Error(
        `O asset ${assetId} possui MIME incompatível: ${declaredMime || "não informado"}; esperado ${expectedMime}.`,
      );
    }
    asset.mime = expectedMime;
    if (
      !Number.isFinite(asset.size) ||
      asset.size <= 0 ||
      asset.size > PRIVATE_ASSET_MAX_FILE_SIZE
    ) {
      throw new Error(
        `O asset ${assetId} possui tamanho incompatível com o plano Fledgling: ${asset.size || 0} bytes; máximo ${PRIVATE_ASSET_MAX_FILE_SIZE} bytes.`,
      );
    }
    if (typeof asset.owlbearName !== "string" || !asset.owlbearName.trim()) {
      throw new Error(`O asset ${assetId} não possui nome para o Owlbear.`);
    }
    if (
      !Number.isInteger(asset.width) ||
      asset.width <= 0 ||
      !Number.isInteger(asset.height) ||
      asset.height <= 0
    ) {
      throw new Error(`O asset ${assetId} não possui dimensões válidas.`);
    }
  }

  pack.runtimeSize = Object.values(pack.assets).reduce((total, asset) => total + asset.size, 0);

  for (const [alias, assetId] of Object.entries(pack.aliases)) {
    if (!alias || typeof assetId !== "string" || !pack.assets[assetId]) {
      throw new Error(`O alias ${alias || "sem nome"} aponta para um asset desconhecido.`);
    }
  }

  if (
    !isRecord$3(pack.presets.cards) ||
    !isRecord$3(pack.presets.decks) ||
    !isRecord$3(pack.presets.scenes)
  ) {
    throw new Error("Os manifests e presets do Private Asset Pack não foram carregados.");
  }

  for (const [sceneId, scene] of Object.entries(pack.presets.scenes)) {
    if (
      !sceneId ||
      !isRecord$3(scene) ||
      !isRecord$3(scene.definition) ||
      !isRecord$3(scene.preset)
    ) {
      throw new Error(`O preset privado ${sceneId || "sem ID"} é inválido.`);
    }
  }

  return pack;
}

function normalizeBinding(value) {
  const image = isRecord$3(value?.image) ? value.image : value;
  if (!isRecord$3(image) || typeof image.url !== "string" || !image.url.trim()) {
    return null;
  }

  return {
    url: image.url,
    width: Number.isFinite(image.width) && image.width > 0 ? image.width : undefined,
    height: Number.isFinite(image.height) && image.height > 0 ? image.height : undefined,
    mime: typeof image.mime === "string" && image.mime.trim() ? image.mime : undefined,
    name: typeof value?.name === "string" && value.name.trim() ? value.name : undefined,
  };
}

function normalizeBindings(bindings, pack) {
  const normalized = {};
  for (const [assetId, binding] of Object.entries(bindings || {})) {
    if (!pack.assets[assetId]) {
      continue;
    }
    const value = normalizeBinding(binding);
    if (value) {
      normalized[assetId] = value;
    }
  }
  return normalized;
}

function validateStoredState(value) {
  if (!isRecord$3(value) || value.version !== PRIVATE_ASSET_STATE_VERSION) {
    return null;
  }

  try {
    const pack = validatePrivateAssetPack(value.pack);
    return {
      version: PRIVATE_ASSET_STATE_VERSION,
      pack,
      bindings: normalizeBindings(value.bindings, pack),
    };
  } catch (error) {
    console.warn("Private Asset Pack persistido ignorado", error);
    return null;
  }
}

function resetCache() {
  cachedStorage = null;
  cachedRawState = undefined;
  cachedState = null;
  cachedResolver = null;
}

function readPrivateAssetState(storage = getDefaultStorage()) {
  if (!storage) {
    return null;
  }

  let raw;
  try {
    raw = storage.getItem(PRIVATE_ASSET_STORAGE_KEY);
  } catch {
    return null;
  }

  if (storage === cachedStorage && raw === cachedRawState) {
    return cachedState ? clone$1(cachedState) : null;
  }

  let state = null;
  if (raw) {
    try {
      state = validateStoredState(JSON.parse(raw));
    } catch (error) {
      console.warn("Não foi possível ler o Private Asset Pack persistido", error);
    }
  }

  cachedStorage = storage;
  cachedRawState = raw;
  cachedState = state;
  cachedResolver = null;
  return state ? clone$1(state) : null;
}

function writePrivateAssetState(state, storage = getDefaultStorage()) {
  if (!storage) {
    throw new Error("O navegador não disponibilizou armazenamento persistente.");
  }

  const normalized = validateStoredState(state);
  if (!normalized) {
    throw new Error("O estado do Private Asset Pack é inválido.");
  }

  storage.setItem(PRIVATE_ASSET_STORAGE_KEY, JSON.stringify(normalized));
  resetCache();
  return clone$1(normalized);
}

function installPrivateAssetPack(pack, storage = getDefaultStorage()) {
  const normalizedPack = validatePrivateAssetPack(pack);
  const previous = readPrivateAssetState(storage);
  const bindings =
    previous?.pack?.id === normalizedPack.id
      ? normalizeBindings(previous.bindings, normalizedPack)
      : {};

  return writePrivateAssetState(
    {
      version: PRIVATE_ASSET_STATE_VERSION,
      pack: normalizedPack,
      bindings,
    },
    storage,
  );
}

function savePrivateAssetBindings(bindings, storage = getDefaultStorage()) {
  const state = readPrivateAssetState(storage);
  if (!state) {
    throw new Error("Configure o Private Asset Pack antes de vincular os assets.");
  }

  return writePrivateAssetState(
    {
      ...state,
      bindings: {
        ...state.bindings,
        ...normalizeBindings(bindings, state.pack),
      },
    },
    storage,
  );
}

function clearPrivateAssetPack(storage = getDefaultStorage()) {
  if (storage) {
    storage.removeItem(PRIVATE_ASSET_STORAGE_KEY);
  }
  resetCache();
}

function addAlias(aliasMap, ambiguousAliases, alias, assetId) {
  for (const candidate of getAssetAliasCandidates(alias)) {
    for (const key of [candidate, candidate.toLowerCase()]) {
      if (ambiguousAliases.has(key)) {
        continue;
      }
      const current = aliasMap.get(key);
      if (current && current !== assetId) {
        aliasMap.delete(key);
        ambiguousAliases.add(key);
      } else {
        aliasMap.set(key, assetId);
      }
    }
  }
}

function createAssetResolver(pack = null, bindings = {}) {
  const normalizedPack = pack ? validatePrivateAssetPack(pack) : null;
  const normalizedBindings = normalizedPack ? normalizeBindings(bindings, normalizedPack) : {};
  const aliasMap = new Map();
  const ambiguousAliases = new Set();

  if (normalizedPack) {
    for (const assetId of Object.keys(normalizedPack.assets)) {
      addAlias(aliasMap, ambiguousAliases, assetId, assetId);
      addAlias(aliasMap, ambiguousAliases, `asset:${assetId}`, assetId);
    }
    for (const [alias, assetId] of Object.entries(normalizedPack.aliases)) {
      addAlias(aliasMap, ambiguousAliases, alias, assetId);
    }
  }

  function getCanonicalId(reference) {
    if (!normalizedPack || typeof reference !== "string" || !reference.trim()) {
      return null;
    }

    if (normalizedPack.assets[reference]) {
      return reference;
    }

    for (const candidate of getAssetAliasCandidates(reference)) {
      const exact = aliasMap.get(candidate);
      if (exact) {
        return exact;
      }
      const insensitive = aliasMap.get(candidate.toLowerCase());
      if (insensitive) {
        return insensitive;
      }
    }
    return null;
  }

  function resolve(reference) {
    const isObjectReference = isRecord$3(reference);
    const rawReference = isObjectReference
      ? reference.assetId || reference.path || reference.url || ""
      : reference;
    const assetId = getCanonicalId(rawReference);

    if (!assetId) {
      return {
        canonicalId: null,
        resolved: false,
        value: reference,
      };
    }

    const asset = normalizedPack.assets[assetId];
    const binding = normalizedBindings[assetId];
    if (!binding) {
      return {
        canonicalId: assetId,
        resolved: false,
        value: isObjectReference
          ? { ...reference, assetId }
          : reference,
      };
    }

    if (!isObjectReference) {
      return {
        canonicalId: assetId,
        resolved: true,
        value: binding.url,
      };
    }

    const value = {
      ...reference,
      assetId,
      url: binding.url,
      width: binding.width || reference.width || asset.width,
      height: binding.height || reference.height || asset.height,
      mime: binding.mime || reference.mime || asset.mime,
    };
    delete value.path;

    return {
      canonicalId: assetId,
      resolved: true,
      value,
    };
  }

  return {
    pack: normalizedPack,
    bindings: normalizedBindings,
    getCanonicalId,
    isReady(reference) {
      const assetId = getCanonicalId(
        isRecord$3(reference)
          ? reference.assetId || reference.path || reference.url || ""
          : reference,
      );
      return Boolean(assetId && normalizedBindings[assetId]);
    },
    resolve,
  };
}

function getConfiguredAssetResolver(storage = getDefaultStorage()) {
  const state = readPrivateAssetState(storage);
  if (!state) {
    return createAssetResolver();
  }

  if (storage === cachedStorage && cachedResolver) {
    return cachedResolver;
  }

  const resolver = createAssetResolver(state.pack, state.bindings);
  if (storage === cachedStorage) {
    cachedResolver = resolver;
  }
  return resolver;
}

function getConfiguredPrivateAssetPack(storage = getDefaultStorage()) {
  return readPrivateAssetState(storage)?.pack || null;
}

function getPrivateAssetPackStatus(storage = getDefaultStorage()) {
  const state = readPrivateAssetState(storage);
  const total = state ? Object.keys(state.pack.assets).length : 0;
  const linked = state ? Object.keys(state.bindings).length : 0;
  return {
    configured: Boolean(state),
    id: state?.pack.id || "",
    name: state?.pack.name || "",
    runtimeSize: state?.pack.runtimeSize || 0,
    total,
    linked,
    missing: Math.max(0, total - linked),
  };
}

function resolveAssetReferences(value, options = {}) {
  const resolver = options.resolver || getConfiguredAssetResolver(options.storage);
  const stats = {
    canonical: new Set(),
    resolved: new Set(),
    unresolved: new Set(),
  };

  function visit(entry) {
    if (Array.isArray(entry)) {
      return entry.map(visit);
    }

    if (!isRecord$3(entry)) {
      if (typeof entry === "string") {
        const result = resolver.resolve(entry);
        if (result.canonicalId) {
          stats.canonical.add(result.canonicalId);
          (result.resolved ? stats.resolved : stats.unresolved).add(result.canonicalId);
          return result.value;
        }
      }
      return entry;
    }

    const result = resolver.resolve(entry);
    if (result.canonicalId) {
      stats.canonical.add(result.canonicalId);
      (result.resolved ? stats.resolved : stats.unresolved).add(result.canonicalId);
      return result.value;
    }

    return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, visit(child)]));
  }

  const resolvedValue = visit(value);
  return {
    value: resolvedValue,
    canonical: stats.canonical.size,
    resolved: stats.resolved.size,
    unresolved: stats.unresolved.size,
    unresolvedIds: [...stats.unresolved],
  };
}

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

function normalizePresetLayer(value) {
  return ITEM_LAYERS.has(value) ? value : "PROP";
}

function getPresetNameFromPath(path, fallback) {
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

function normalizePresetAsset(value, fallbackName) {
  if (typeof value === "string") {
    return {
      name: getPresetNameFromPath(value, fallbackName),
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
    name: value.name || getPresetNameFromPath(value.path || value.url, fallbackName),
    assetId: value.assetId,
    path: value.path || value.url || "",
    width: value.width,
    height: value.height,
    mime: value.mime,
  };
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

async function buildPresetFace(asset, missingAssetMessage) {
  const resolved = getConfiguredAssetResolver().resolve(asset);
  const value = resolved.resolved ? resolved.value : null;
  const url = value?.url || "";

  if (!url) {
    throw new Error(missingAssetMessage);
  }

  const dimensions =
    Number.isFinite(value.width) && Number.isFinite(value.height)
      ? { width: value.width, height: value.height }
      : await readImage(url);

  return {
    assetId: resolved.canonicalId,
    url,
    width: dimensions.width,
    height: dimensions.height,
    mime: value.mime || getMimeFromUrl(url),
  };
}

function isPresetAssetReady(asset) {
  return getConfiguredAssetResolver().isReady(asset);
}

function isPresetAssetConfigured(asset) {
  return Boolean(
    asset &&
      typeof asset === "object" &&
      ((typeof asset.assetId === "string" && asset.assetId.trim()) ||
        (typeof asset.path === "string" && asset.path.trim()) ||
        (typeof asset.url === "string" && asset.url.trim())),
  );
}

function normalizePresetDeck(value, index) {
  const name = value?.name || `Pilha ${index + 1}`;
  const layer = normalizePresetLayer(value?.layer);

  return {
    id: value?.id || `deck-${index + 1}`,
    name,
    gridWidth: Number.isFinite(value?.gridWidth) && value.gridWidth > 0 ? value.gridWidth : 2,
    layer,
    back: normalizePresetAsset(value?.back, `${name} verso`),
    cards: Array.isArray(value?.cards)
      ? value.cards.map((card, cardIndex) => {
          if (typeof card === "string") {
            return {
              name: getPresetNameFromPath(card, `Carta ${cardIndex + 1}`),
              front: normalizePresetAsset(card, `Carta ${cardIndex + 1}`),
            };
          }

          return {
            name: card?.name || `Carta ${cardIndex + 1}`,
            front: normalizePresetAsset(
              card?.front || card?.path || card?.url,
              `Carta ${cardIndex + 1}`,
            ),
          };
        })
      : [],
  };
}

async function loadPresetDecks(pack = getConfiguredPrivateAssetPack()) {
  const data = pack?.presets?.decks;
  const decks = Array.isArray(data?.decks) ? data.decks : [];

  return decks.map(normalizePresetDeck);
}

function isPresetDeckReady(deck) {
  return Boolean(
    deck?.cards?.length &&
      isPresetAssetReady(deck.back) &&
      deck.cards.every((card) => isPresetAssetReady(card.front)),
  );
}

function isPresetDeckConfigured(deck) {
  return Boolean(
    deck?.cards?.length &&
      isPresetAssetConfigured(deck.back) &&
      deck.cards.every((card) => isPresetAssetConfigured(card.front)),
  );
}

async function buildFace$1(asset) {
  return buildPresetFace(asset, "A pilha padrão ainda não tem verso configurado.");
}

async function buildPresetDeckData(deck) {
  if (!isPresetDeckReady(deck)) {
    throw new Error(`A pilha "${deck?.name || "padrão"}" ainda não tem cartas configuradas.`);
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
  const layer = normalizePresetLayer(value?.layer);
  const category = normalizeCategory(value?.category);
  const groupOrigin = normalizeOrigin(value?.origin);

  return {
    id: value?.id || `cards-${index + 1}`,
    name,
    category,
    gridWidth: Number.isFinite(value?.gridWidth) && value.gridWidth > 0 ? value.gridWidth : 2,
    layer,
    origin: groupOrigin,
    back: normalizePresetAsset(value?.back, `${name} verso`),
    cards: Array.isArray(value?.cards)
      ? value.cards.map((card, cardIndex) => {
          if (typeof card === "string") {
            return {
              id: `card-${cardIndex + 1}`,
              name: getPresetNameFromPath(card, `Carta ${cardIndex + 1}`),
              front: normalizePresetAsset(card, `Carta ${cardIndex + 1}`),
              back: normalizePresetAsset("", `Carta ${cardIndex + 1} verso`),
              origin: null,
            };
          }

          const cardName = card?.name || `Carta ${cardIndex + 1}`;

          return {
            id: card?.id || `card-${cardIndex + 1}`,
            name: cardName,
            category: normalizeCategory(card?.category) || category,
            front: normalizePresetAsset(card?.front || card?.path || card?.url, cardName),
            back: normalizePresetAsset(card?.back, `${cardName} verso`),
            origin: normalizeOrigin(card?.origin),
          };
        })
      : [],
  };
}

async function loadPresetCardGroups(pack = getConfiguredPrivateAssetPack()) {
  const data = pack?.presets?.cards;
  const groups = Array.isArray(data?.groups) ? data.groups : [];

  return groups.map(normalizePresetCardGroup);
}

function isPresetCardReady(group, card) {
  const back = card?.back?.assetId || card?.back?.path ? card.back : group?.back;
  return Boolean(isPresetAssetReady(back) && isPresetAssetReady(card?.front));
}

function isPresetCardConfigured(group, card) {
  const back = card?.back?.assetId || card?.back?.path ? card.back : group?.back;
  return Boolean(isPresetAssetConfigured(back) && isPresetAssetConfigured(card?.front));
}

async function buildFace(asset, label) {
  return buildPresetFace(asset, `A biblioteca ainda não tem ${label} configurado.`);
}

async function buildPresetCardData(group, card) {
  if (!isPresetCardReady(group, card)) {
    throw new Error(`A carta "${card?.name || "padrão"}" ainda não tem frente e verso.`);
  }

  const backAsset = card?.back?.assetId || card?.back?.path ? card.back : group.back;
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
const SCENE_RESTORE_MARKER_KEY = `${EXTENSION_ID}/scene-restore`;
const SCENE_BOOTSTRAP_MARKER_KEY = `${EXTENSION_ID}/scene-bootstrap`;

function describeUnavailablePrivateAssets(count) {
  return `${count} ${count === 1 ? "asset privado não está acessível" : "assets privados não estão acessíveis"}`;
}

const SCENE_PRESETS = [
  {
    id: "tutorial",
    name: "Tutorial",
    restoreLabel: "Restaurar o Tutorial",
  },
  {
    id: "missao-0-5",
    name: "Missao 0.5 (nao oficial)",
    label: "Missão 0.5 (não oficial)",
    restoreLabel: "Restaurar a Missão 0.5 (não oficial)",
  },
];

class SceneRestoreError extends Error {
  constructor(
    message,
    { code = "RESTORE_FAILED", stage = "unknown", partial = false, cause } = {},
  ) {
    super(message);
    this.name = "SceneRestoreError";
    this.code = code;
    this.stage = stage;
    this.partial = partial;
    this.cause = cause;
  }
}

function isRecord$2(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSerializable(value, path = "preset", ancestors = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} possui um número não finito.`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new Error(`${path} possui um valor não serializável.`);
  }

  if (ancestors.has(value)) {
    throw new Error(`${path} possui uma referência circular.`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} precisa usar apenas objetos comuns.`);
  }

  if (Object.getOwnPropertySymbols(value).length) {
    throw new Error(`${path} possui chaves não serializáveis.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new Error(`${path}[${index}] está ausente.`);
        }
        assertSerializable(value[index], `${path}[${index}]`, ancestors);
      }
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      if (key === "__proto__") {
        throw new Error(`${path} possui uma chave que pode alterar prototipos.`);
      }

      assertSerializable(entry, `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function isPublicRuntime() {
  const hostname = globalThis.location?.hostname;
  return hostname !== "localhost" && hostname !== "127.0.0.1";
}

function isForbiddenLocalReference(value) {
  const text = String(value || "").trim();
  if (/^[a-z]:[\\/]/i.test(text) || /^file:/i.test(text)) {
    return true;
  }

  try {
    const url = new URL(text);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function validatePublicReferences(value, path = "preset", key = "") {
  if (typeof value === "string") {
    if (isForbiddenLocalReference(value)) {
      throw new Error(`${path} aponta para um endereço local.`);
    }

    if (key.toLowerCase() === "url" && !/^https?:\/\//i.test(value)) {
      throw new Error(`${path} não possui uma URL pública válida.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validatePublicReferences(entry, `${path}[${index}]`));
    return;
  }

  if (isRecord$2(value)) {
    for (const [entryKey, entryValue] of Object.entries(value)) {
      validatePublicReferences(entryValue, `${path}.${entryKey}`, entryKey);
    }
  }
}

function validatePresetBoardIntegrity(preset, itemIds) {
  const board = preset.metadata[SELECTION_BOARD_KEY];
  if (!board) {
    return;
  }

  if (!isRecord$2(board)) {
    throw new Error("A metadata de seleção do mapa é inválida.");
  }

  for (const categories of Object.values(board.assigned || {})) {
    if (!isRecord$2(categories)) {
      continue;
    }

    for (const itemId of Object.values(categories)) {
      if (itemId && !itemIds.has(itemId)) {
        throw new Error(`O slot do mapa aponta para um item ausente: ${itemId}.`);
      }
    }
  }

  const explicitColors = new Set();
  for (const item of preset.items) {
    const colorMetadata = item.metadata?.[COLOR_TOKEN_KEY];
    if (isRecord$2(colorMetadata) && typeof colorMetadata.color === "string") {
      explicitColors.add(colorMetadata.color);
    }
  }

  for (const color of PLAYER_COLORS) {
    if (!explicitColors.has(color.id)) {
      throw new Error(`O mapa não possui identificador explícito para ${color.label}.`);
    }
  }
}

function validateOptionalSceneEnvironment(value) {
  if (value.grid !== undefined) {
    const grid = value.grid;
    if (
      !isRecord$2(grid) ||
      !Number.isFinite(grid.dpi) ||
      grid.dpi <= 0 ||
      typeof grid.scale !== "string" ||
      !grid.scale.trim() ||
      typeof grid.color !== "string" ||
      !grid.color.trim() ||
      !Number.isFinite(grid.opacity) ||
      grid.opacity < 0 ||
      grid.opacity > 1 ||
      !new Set(["SOLID", "DASHED", "DOTTED"]).has(grid.lineType) ||
      !new Set(["CHEBYSHEV", "ALTERNATING", "EUCLIDEAN", "MANHATTAN"]).has(
        grid.measurement,
      ) ||
      !new Set(["SQUARE", "HEX_VERTICAL", "HEX_HORIZONTAL", "DIMETRIC", "ISOMETRIC"]).has(
        grid.type,
      )
    ) {
      throw new Error("O grid capturado do mapa é inválido.");
    }
  }
  if (value.fog !== undefined) {
    const fog = value.fog;
    if (
      !isRecord$2(fog) ||
      typeof fog.filled !== "boolean" ||
      typeof fog.color !== "string" ||
      !fog.color.trim() ||
      !Number.isFinite(fog.strokeWidth) ||
      fog.strokeWidth < 0
    ) {
      throw new Error("A fog capturada do mapa é inválida.");
    }
  }
}

function validateCardAndDeckMetadata(item) {
  for (const [key, value] of Object.entries(item.metadata || {})) {
    const isCardOrDeck =
      key === METADATA_KEY ||
      key === DECK_METADATA_KEY ||
      key.endsWith("/card") ||
      key.endsWith("/deck");
    if (isCardOrDeck && !isRecord$2(value)) {
      throw new Error(`O item ${item.id} possui metadata de carta ou pilha inválida.`);
    }
  }
}

function validateScenePreset(
  value,
  { publicMode = isPublicRuntime() } = {},
) {
  try {
    assertSerializable(value);
  } catch (error) {
    throw new SceneRestoreError("O mapa salvo possui dados não serializáveis.", {
      code: "INVALID_PRESET",
      stage: "validation",
      cause: error,
    });
  }

  if (
    !isRecord$2(value) ||
    value.version !== PRESET_VERSION ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    !isRecord$2(value.metadata)
  ) {
    throw new SceneRestoreError("O mapa salvo possui uma estrutura inválida.", {
      code: "INVALID_PRESET",
      stage: "validation",
    });
  }

  if (Object.prototype.hasOwnProperty.call(value.metadata, SCENE_RESTORE_MARKER_KEY)) {
    throw new SceneRestoreError("O mapa salvo contém metadata interna de restauração.", {
      code: "INVALID_PRESET",
      stage: "validation",
    });
  }

  if (
    value.itemCount !== undefined &&
    (!Number.isInteger(value.itemCount) || value.itemCount !== value.items.length)
  ) {
    throw new SceneRestoreError("A contagem do mapa salvo não corresponde aos itens.", {
      code: "INVALID_PRESET",
      stage: "validation",
    });
  }

  const ids = new Set();
  for (const [index, item] of value.items.entries()) {
    if (!isRecord$2(item) || typeof item.id !== "string" || !item.id.trim()) {
      throw new SceneRestoreError(`O item ${index + 1} do mapa não possui ID válido.`, {
        code: "INVALID_PRESET",
        stage: "validation",
      });
    }
    if (ids.has(item.id)) {
      throw new SceneRestoreError(`O mapa salvo possui ID duplicado: ${item.id}.`, {
        code: "DUPLICATE_PRESET_ID",
        stage: "validation",
      });
    }
    if (typeof item.type !== "string" || !item.type.trim() || !isRecord$2(item.metadata)) {
      throw new SceneRestoreError(`O item ${item.id} possui estrutura inválida.`, {
        code: "INVALID_PRESET",
        stage: "validation",
      });
    }

    ids.add(item.id);
    validateCardAndDeckMetadata(item);
  }

  try {
    validateOptionalSceneEnvironment(value);
    validatePresetBoardIntegrity(value, ids);
    if (publicMode) {
      validatePublicReferences(value);
    }
  } catch (error) {
    throw new SceneRestoreError(error.message || "O mapa salvo não passou pela validação.", {
      code: "INVALID_PRESET",
      stage: "validation",
      cause: error,
    });
  }

  return clone(value);
}

function getScenePresetDefinition(presetId) {
  const definition = SCENE_PRESETS.find((preset) => preset.id === presetId);

  if (!definition) {
    throw new Error("Mapa salvo desconhecido.");
  }

  return definition;
}

function createDefaultBoardPreset(
  items,
  metadata,
  definition = SCENE_PRESETS[0],
  environment = {},
) {
  const presetMetadata = clone(metadata || {});
  delete presetMetadata[SCENE_RESTORE_MARKER_KEY];

  return {
    version: PRESET_VERSION,
    id: definition.id,
    name: definition.name,
    savedAt: new Date().toISOString(),
    itemCount: items.length,
    items: clone(items),
    metadata: presetMetadata,
    ...(environment.grid ? { grid: clone(environment.grid) } : {}),
    ...(environment.fog ? { fog: clone(environment.fog) } : {}),
  };
}

async function captureApiGroup(entries) {
  if (entries.some(([, method]) => typeof method !== "function")) {
    return null;
  }
  try {
    const values = await Promise.all(entries.map(([, method]) => method()));
    return Object.fromEntries(entries.map(([key], index) => [key, values[index]]));
  } catch (error) {
    console.warn("[scene-preset] Não foi possível capturar parte de grid/fog.", error);
    return null;
  }
}

async function captureSceneEnvironment(OBR) {
  const [gridValues, fog] = await Promise.all([
    captureApiGroup([
      ["dpi", OBR?.scene?.grid?.getDpi?.bind(OBR.scene.grid)],
      ["scale", OBR?.scene?.grid?.getScale?.bind(OBR.scene.grid)],
      ["color", OBR?.scene?.grid?.getColor?.bind(OBR.scene.grid)],
      ["opacity", OBR?.scene?.grid?.getOpacity?.bind(OBR.scene.grid)],
      ["lineType", OBR?.scene?.grid?.getLineType?.bind(OBR.scene.grid)],
      ["measurement", OBR?.scene?.grid?.getMeasurement?.bind(OBR.scene.grid)],
      ["type", OBR?.scene?.grid?.getType?.bind(OBR.scene.grid)],
    ]),
    captureApiGroup([
      ["filled", OBR?.scene?.fog?.getFilled?.bind(OBR.scene.fog)],
      ["color", OBR?.scene?.fog?.getColor?.bind(OBR.scene.fog)],
      ["strokeWidth", OBR?.scene?.fog?.getStrokeWidth?.bind(OBR.scene.fog)],
    ]),
  ]);
  const grid = gridValues
    ? {
        ...gridValues,
        scale:
          typeof gridValues.scale === "string"
            ? gridValues.scale
            : gridValues.scale?.raw,
      }
    : null;
  return {
    ...(grid && typeof grid.scale === "string" ? { grid } : {}),
    ...(fog ? { fog } : {}),
  };
}

function addSceneBootstrapMarker(items, metadata) {
  const selectionBoard = metadata?.[SELECTION_BOARD_KEY];
  if (!selectionBoard || !items.length) {
    return items;
  }
  const markedItems = clone(items);
  markedItems[0].metadata = {
    ...(markedItems[0].metadata || {}),
    [SCENE_BOOTSTRAP_MARKER_KEY]: {
      version: 1,
      completed: false,
      selectionBoard: clone(selectionBoard),
    },
  };
  return markedItems;
}

function applySceneEnvironment(builder, preset) {
  const grid = preset.grid;
  const fog = preset.fog;
  if (grid) {
    if (typeof grid.scale === "string") builder.gridScale(grid.scale);
    if (typeof grid.color === "string") builder.gridColor(grid.color);
    if (Number.isFinite(grid.opacity)) builder.gridOpacity(grid.opacity);
    if (typeof grid.lineType === "string") builder.gridLineType(grid.lineType);
    if (typeof grid.measurement === "string") builder.gridMeasurement(grid.measurement);
    if (typeof grid.type === "string") builder.gridType(grid.type);
  }
  if (fog) {
    if (typeof fog.filled === "boolean") builder.fogFilled(fog.filled);
    if (typeof fog.color === "string") builder.fogColor(fog.color);
    if (Number.isFinite(fog.strokeWidth)) builder.fogStrokeWidth(fog.strokeWidth);
  }
  const upload = builder.build();
  if (grid && Number.isFinite(grid.dpi) && grid.dpi > 0) {
    // O SDK 3.1.0 tipa SceneUpload.grid.dpi, mas o builder não expõe um setter para DPI.
    upload.grid.dpi = grid.dpi;
  }
  return upload;
}

function buildPrivateSceneUpload(buildSceneUpload, preset, options = {}) {
  if (typeof buildSceneUpload !== "function") {
    throw new Error("O construtor de SceneUpload do Owlbear não está disponível.");
  }
  const resolution = resolveAssetReferences(preset, options);
  if (resolution.unresolved) {
    const error = new Error(
      `A cena não pode ser criada: ${describeUnavailablePrivateAssets(resolution.unresolved)} como vínculo no Owlbear. Vincule manualmente antes de tentar novamente.`,
    );
    error.name = "MissingPrivateAssetBindingsError";
    error.missingBindings = resolution.unresolved;
    error.missingAssetIds = resolution.unresolvedIds;
    throw error;
  }
  const normalized = validateScenePreset(resolution.value, { publicMode: true });
  const items = addSceneBootstrapMarker(normalized.items, normalized.metadata);
  const builder = buildSceneUpload().name(normalized.name).items(items);
  const upload = applySceneEnvironment(builder, normalized);
  return {
    upload,
    itemCount: items.length,
    idsPreserved: items.every((item, index) => item.id === normalized.items[index].id),
    usedCapturedGrid: Boolean(normalized.grid),
    usedCapturedFog: Boolean(normalized.fog),
  };
}

async function createPrivateScene(OBR, buildSceneUpload, preset, options = {}) {
  if (!OBR?.assets?.uploadScenes) {
    throw new Error("A API de criação de cenas do Owlbear não está disponível.");
  }
  const result = buildPrivateSceneUpload(buildSceneUpload, preset, options);
  await OBR.assets.uploadScenes([result.upload]);
  return result;
}

async function loadScenePresetEntries(pack, options = {}) {
  const configuredPack = getConfiguredPrivateAssetPack() ;
  const resolver =
    options.resolver ||
    (getConfiguredAssetResolver() );

  return SCENE_PRESETS.map((fallbackDefinition) => {
    const entry = configuredPack?.presets?.scenes?.[fallbackDefinition.id];
    const definition = entry?.definition
      ? { ...fallbackDefinition, ...entry.definition, id: fallbackDefinition.id }
      : fallbackDefinition;
    const resolution = entry?.preset
      ? resolveAssetReferences(entry.preset, { resolver })
      : null;
    const summary = entry?.summary;
    const validSummary = Boolean(
      typeof summary?.savedAt === "string" &&
        Number.isInteger(summary?.itemCount) &&
        summary.itemCount > 0,
    );
    return {
      definition,
      loadError: null,
      ready: Boolean(entry?.preset && !resolution?.unresolved),
      unresolvedAssetIds: resolution?.unresolvedIds || [],
      summary: validSummary
        ? {
            savedAt: summary.savedAt,
            itemCount: summary.itemCount,
          }
        : null,
      preset: entry?.preset || null,
    };
  });
}

async function saveScenePreset(OBR, presetId) {
  const definition = getScenePresetDefinition(presetId);
  const [items, metadata, environment] = await Promise.all([
    OBR.scene.items.getItems(),
    OBR.scene.getMetadata(),
    captureSceneEnvironment(OBR),
  ]);
  const preset = createDefaultBoardPreset(items, metadata, definition, environment);
  const response = await fetch(`./__scene_preset?id=${encodeURIComponent(definition.id)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preset),
  });

  if (!response.ok) {
    throw new Error(
      "Não consegui criar o mapa salvo. Essa ação precisa do servidor localhost.",
    );
  }

  return response.json();
}

const ASSET_DESCRIPTION_PREFIX = "double-sided-cards-private-asset:";

function isRecord$1(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function getFilePaths(file) {
  const full = normalizePath(file.webkitRelativePath || file.name);
  const paths = new Set([full]);
  const slashIndex = full.indexOf("/");
  if (slashIndex >= 0) {
    paths.add(full.slice(slashIndex + 1));
  }
  return [...paths];
}

function buildFileIndex(files) {
  const index = new Map();
  for (const file of files) {
    for (const filePath of getFilePaths(file)) {
      const current = index.get(filePath);
      if (current && current !== file) {
        index.set(filePath, null);
      } else {
        index.set(filePath, file);
      }
    }
  }
  return index;
}

function findFile(index, requestedPath) {
  const normalized = normalizePath(requestedPath);
  const exact = index.get(normalized);
  if (exact) {
    return exact;
  }

  const matches = [...index.entries()].filter(
    ([filePath, file]) => file && filePath.endsWith(`/${normalized}`),
  );
  if (matches.length === 1) {
    return matches[0][1];
  }
  return null;
}

async function parseJsonFile(file, label) {
  if (!file) {
    throw new Error(`${label} não foi encontrado no Private Asset Pack.`);
  }

  try {
    return JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`${label} possui JSON inválido: ${error.message}`);
  }
}

async function hydratePrivateAssetPackManifest(manifest, readJson) {
  if (
    !isRecord$1(manifest) ||
    manifest.format !== PRIVATE_ASSET_PACK_FORMAT ||
    !isSupportedPrivateAssetPackVersion(manifest.version) ||
    !isRecord$1(manifest.presets)
  ) {
    throw new Error("O manifesto do Private Asset Pack é inválido.");
  }

  const cards = await readJson(manifest.presets.cards, "Manifesto de cartas");
  const decks = await readJson(manifest.presets.decks, "Manifesto de pilhas");
  const scenes = {};

  for (const [sceneId, sceneEntry] of Object.entries(manifest.presets.scenes || {})) {
    if (!isRecord$1(sceneEntry) || typeof sceneEntry.file !== "string") {
      throw new Error(`A definição do preset ${sceneId} é inválida.`);
    }

    const preset = await readJson(sceneEntry.file, `Preset ${sceneId}`);
    scenes[sceneId] = {
      definition: {
        id: sceneId,
        name: sceneEntry.name || preset.name || sceneId,
        label: sceneEntry.label,
        createLabel:
          sceneEntry.createLabel || `Criar cena ${sceneEntry.label || sceneEntry.name || preset.name || sceneId}`,
        restoreLabel:
          sceneEntry.restoreLabel || `Restaurar ${sceneEntry.label || sceneEntry.name || preset.name || sceneId}`,
      },
      summary: {
        savedAt: preset.savedAt,
        itemCount: preset.itemCount,
      },
      preset,
    };
  }

  return validatePrivateAssetPack({
    ...manifest,
    presets: {
      cards,
      decks,
      scenes,
    },
  });
}

async function readPrivateAssetPackFiles(fileList) {
  const files = [...(fileList || [])];
  const index = buildFileIndex(files);
  const manifestCandidates = files.filter(
    (file) => normalizePath(file.name).toLowerCase() === "private-asset-pack.json",
  );

  if (manifestCandidates.length !== 1) {
    throw new Error(
      "Selecione uma pasta que contenha exatamente um private-asset-pack.json.",
    );
  }

  const manifest = await parseJsonFile(manifestCandidates[0], "Manifesto do pack");
  const pack = await hydratePrivateAssetPackManifest(manifest, async (filePath, label) =>
    parseJsonFile(findFile(index, filePath), label),
  );
  const assetFiles = new Map();

  for (const [assetId, asset] of Object.entries(pack.assets)) {
    const file = findFile(index, asset.file);
    if (file) {
      assetFiles.set(assetId, file);
    }
  }

  return {
    pack,
    assetFiles,
    fileCount: files.length,
  };
}

function getUploadType(asset) {
  return new Set(["MAP", "PROP", "MOUNT", "CHARACTER", "ATTACHMENT", "NOTE"]).has(
    asset.typeHint,
  )
    ? asset.typeHint
    : "PROP";
}

function getErrorText(error) {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (error == null) {
    return "A API rejeitou a operação sem fornecer detalhes.";
  }

  for (const candidate of [
    error.message,
    error.error?.message,
    error.error,
    error.reason?.message,
    error.reason,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") {
      return serialized;
    }
  } catch {
    // A referência ao erro original continua disponível em `cause`.
  }

  const fallback = String(error);
  return fallback && fallback !== "[object Object]"
    ? fallback
    : "A API rejeitou a operação com um objeto de erro sem mensagem.";
}

function getErrorCategory(error, fallback = "api") {
  const values = [
    error?.name,
    error?.code,
    error?.message,
    error?.error?.message,
    error?.error,
    error?.reason?.message,
    error?.reason,
  ]
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" ")
    .toLowerCase();

  if (
    error?.name === "AbortError" ||
    /\b(?:abort(?:ed)?|cancel(?:ed|led|ado|ada)?|user denied)\b/i.test(values)
  ) {
    return "cancelled";
  }

  if (
    error?.name === "QuotaExceededError" ||
    error?.code === 22 ||
    error?.code === 1014 ||
    /quota|storage|armazenamento|cota|insufficient (?:space|storage)|not enough (?:space|storage)|storage limit/i.test(
      values,
    )
  ) {
    return "storage";
  }

  if (
    /invalid (?:file|image)|unsupported (?:file|image|mime|format)|mime|empty file|arquivo (?:inválido|vazio)/i.test(
      values,
    )
  ) {
    return "invalid-file";
  }

  return fallback;
}

function createPreparationError(stage, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "PrivateAssetPreparationError";
  error.uploadStage = stage;
  error.uploadCategory = "invalid-file";
  if (cause !== undefined && error.cause === undefined) {
    error.cause = cause;
  }
  return error;
}

function getAssetFileName(asset) {
  return normalizePath(asset?.file).split("/").filter(Boolean).pop() || "";
}

function assertPreparedFile(file, expectedName, expectedMime, expectedSize) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw createPreparationError(
      "validação do File reconstruído",
      "O ImageUpload não contém um File/Blob legível.",
    );
  }
  if (file.name !== expectedName) {
    throw createPreparationError(
      "validação do File reconstruído",
      `O File reconstruído recebeu o nome incorreto: ${file.name || "sem nome"}.`,
    );
  }
  if (file.type !== expectedMime) {
    throw createPreparationError(
      "validação do File reconstruído",
      `O File reconstruído recebeu o MIME incorreto: ${file.type || "sem MIME"}.`,
    );
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size !== expectedSize) {
    throw createPreparationError(
      "validação do File reconstruído",
      `O File reconstruído possui tamanho inválido: ${file.size || 0} bytes.`,
    );
  }
}

async function preparePrivateAssetUpload(buildImageUpload, file, assetId, asset) {
  if (typeof buildImageUpload !== "function") {
    throw createPreparationError(
      "construção do ImageUpload",
      "O construtor de ImageUpload do Owlbear não está disponível.",
    );
  }
  if (!file || typeof file.arrayBuffer !== "function") {
    throw createPreparationError(
      "leitura do arquivo",
      "O arquivo selecionado não expõe bytes legíveis com arrayBuffer().",
    );
  }

  const expectedName = getAssetFileName(asset);
  if (!expectedName || typeof file.name !== "string" || file.name !== expectedName) {
    throw createPreparationError(
      "validação do arquivo",
      `Nome de arquivo inválido para ${assetId}: esperado ${expectedName || "um nome canônico"}, recebido ${file?.name || "sem nome"}.`,
    );
  }

  const mime = getPrivateAssetUploadMime(expectedName);
  const manifestMime =
    typeof asset?.mime === "string" ? asset.mime.trim().toLowerCase() : "";
  const browserMime = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  if (!mime) {
    throw createPreparationError(
      "validação do arquivo",
      `Formato não suportado para upload privado no Owlbear: ${expectedName}.`,
    );
  }
  if (manifestMime !== mime || (browserMime && browserMime !== mime)) {
    throw createPreparationError(
      "validação do arquivo",
      `MIME inválido para ${expectedName}: manifesto ${manifestMime || "não informado"}, navegador ${browserMime || "não informado"}; esperado ${mime}.`,
    );
  }

  let bytes;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    throw createPreparationError(
      "leitura dos bytes do arquivo",
      `Não foi possível ler ${expectedName}: ${getErrorText(error)}`,
      error,
    );
  }

  if (!Number.isFinite(bytes?.byteLength) || bytes.byteLength <= 0) {
    throw createPreparationError(
      "validação dos bytes do arquivo",
      `O arquivo ${expectedName} está vazio ou não retornou um ArrayBuffer válido.`,
    );
  }
  if (Number.isFinite(asset?.size) && asset.size > 0 && bytes.byteLength !== asset.size) {
    throw createPreparationError(
      "validação dos bytes do arquivo",
      `O arquivo ${expectedName} possui ${bytes.byteLength} bytes; o manifesto exige ${asset.size}.`,
    );
  }
  if (typeof globalThis.File !== "function") {
    throw createPreparationError(
      "reconstrução do File",
      "O navegador não disponibilizou o construtor File exigido pelo upload do Owlbear.",
    );
  }

  let rebuiltFile;
  try {
    rebuiltFile = new File([bytes], expectedName, { type: mime });
  } catch (error) {
    throw createPreparationError(
      "reconstrução do File",
      `Não foi possível reconstruir ${expectedName}: ${getErrorText(error)}`,
      error,
    );
  }
  assertPreparedFile(rebuiltFile, expectedName, mime, bytes.byteLength);

  let upload;
  try {
    upload = buildImageUpload(rebuiltFile)
      .name(asset.owlbearName)
      .description(`${ASSET_DESCRIPTION_PREFIX}${encodeURIComponent(assetId)}`)
      .build();
  } catch (error) {
    throw createPreparationError(
      "construção do ImageUpload",
      `Não foi possível criar o ImageUpload de ${expectedName}: ${getErrorText(error)}`,
      error,
    );
  }
  assertPreparedFile(upload?.file, expectedName, mime, bytes.byteLength);
  return upload;
}

function createUploadError(error, context) {
  const originalError = error?.cause ?? error;
  const category = getErrorCategory(
    originalError,
    error?.uploadCategory || context.category || "api",
  );
  const assetLabel = context.assetId
    ? ` Asset: ${context.assetName || "sem nome"} (${context.assetId}).`
    : "";
  const categoryMessage =
    category === "cancelled"
      ? " O envio foi cancelado pelo usuário; tente novamente quando estiver pronto."
      : category === "storage"
        ? " A rejeição indica um possível problema de armazenamento/cota do Owlbear; confira o espaço disponível na conta."
        : category === "invalid-file"
          ? " O arquivo não atende aos requisitos de upload; selecione novamente o pack e confira o arquivo indicado."
          : "";
  const message =
    `Falha na etapa \"${context.stage}\". ` +
    `${context.prepared} de ${context.total} arquivos preparados; ` +
    `${context.uploaded} de ${context.total} uploads confirmados.` +
    assetLabel +
    ` Erro original: ${getErrorText(originalError)}.` +
    categoryMessage;
  const wrapped = new Error(message, { cause: originalError });
  wrapped.name = "PrivateAssetUploadError";
  wrapped.stage = context.stage;
  wrapped.category = category;
  wrapped.cancelled = category === "cancelled";
  wrapped.possibleStorageIssue = category === "storage";
  wrapped.prepared = context.prepared;
  wrapped.uploaded = context.uploaded;
  wrapped.total = context.total;
  wrapped.assetId = context.assetId || null;
  wrapped.assetName = context.assetName || null;
  if (wrapped.cause === undefined) {
    wrapped.cause = originalError;
  }
  return wrapped;
}

async function uploadPrivateAssetPack(
  OBR,
  buildImageUpload,
  importedPack,
  onProgress = () => {},
) {
  if (!OBR?.assets?.uploadImages || typeof buildImageUpload !== "function") {
    throw new Error("A API de assets do Owlbear não está disponível.");
  }

  const entries = Object.entries(importedPack?.pack?.assets || {}).filter(([assetId]) =>
    importedPack.assetFiles?.has(assetId),
  );
  if (!entries.length) {
    throw new Error("O pack selecionado não contém os arquivos canônicos para envio.");
  }

  let uploaded = 0;
  let prepared = 0;
  const groups = new Map();
  for (const entry of entries) {
    const type = getUploadType(entry[1]);
    const values = groups.get(type) || [];
    values.push(entry);
    groups.set(type, values);
  }

  for (const [type, group] of groups) {
    const uploads = [];
    for (const [assetId, asset] of group) {
      try {
        uploads.push(
          await preparePrivateAssetUpload(
            buildImageUpload,
            importedPack.assetFiles.get(assetId),
            assetId,
            asset,
          ),
        );
      } catch (error) {
        throw createUploadError(error, {
          stage: error?.uploadStage || "preparação do ImageUpload",
          category: "invalid-file",
          prepared,
          uploaded,
          total: entries.length,
          assetId,
          assetName: asset.owlbearName,
        });
      }
      prepared += 1;
      onProgress({
        stage: "preparing",
        processed: prepared,
        prepared,
        uploaded,
        total: entries.length,
        assetId,
        assetName: asset.owlbearName,
      });
    }

    onProgress({
      stage: "uploading",
      processed: uploaded,
      prepared,
      uploaded,
      total: entries.length,
      groupSize: group.length,
      type,
    });
    try {
      await OBR.assets.uploadImages(uploads, type);
    } catch (error) {
      throw createUploadError(error, {
        stage: "envio à API do Owlbear",
        prepared,
        uploaded,
        total: entries.length,
      });
    }
    uploaded += group.length;
    onProgress({
      stage: "uploaded",
      processed: uploaded,
      prepared,
      uploaded,
      total: entries.length,
      groupSize: group.length,
      type,
    });
  }

  return {
    uploaded,
    missingFiles: Object.keys(importedPack.pack.assets).length - entries.length,
  };
}

function getAssetIdFromDescription(description, pack) {
  if (typeof description !== "string" || !description.startsWith(ASSET_DESCRIPTION_PREFIX)) {
    return null;
  }

  try {
    const assetId = decodeURIComponent(description.slice(ASSET_DESCRIPTION_PREFIX.length));
    return pack.assets[assetId] ? assetId : null;
  } catch {
    return null;
  }
}

function buildUniqueNameIndex(pack) {
  const index = new Map();
  const ambiguous = new Set();

  for (const [assetId, asset] of Object.entries(pack.assets)) {
    const names = [asset.owlbearName, asset.name, asset.file?.split("/").pop()]
      .map(normalizeName)
      .filter(Boolean);
    for (const name of names) {
      if (ambiguous.has(name)) {
        continue;
      }
      const current = index.get(name);
      if (current && current !== assetId) {
        index.delete(name);
        ambiguous.add(name);
      } else {
        index.set(name, assetId);
      }
    }
  }

  return index;
}

function matchOwlbearAssetBindings(pack, selectedAssets, options = {}) {
  const normalizedPack = validatePrivateAssetPack(pack);
  const resolver = createAssetResolver(normalizedPack);
  const nameIndex = buildUniqueNameIndex(normalizedPack);
  const allowedAssetIds = options.assetIds
    ? new Set(
        [...options.assetIds]
          .map((assetId) => resolver.getCanonicalId(assetId) || assetId)
          .filter((assetId) => normalizedPack.assets[assetId]),
      )
    : null;
  const bindings = {};
  const unmatched = [];
  const ignored = [];

  for (const selected of selectedAssets || []) {
    const assetId =
      getAssetIdFromDescription(selected?.description, normalizedPack) ||
      nameIndex.get(normalizeName(selected?.name)) ||
      resolver.getCanonicalId(selected?.image?.url || "");

    if (!assetId || !selected?.image?.url) {
      unmatched.push(selected?.name || "asset sem nome");
      continue;
    }

    if (allowedAssetIds && !allowedAssetIds.has(assetId)) {
      ignored.push(selected?.name || normalizedPack.assets[assetId].name || assetId);
      continue;
    }

    bindings[assetId] = {
      ...selected.image,
      name: selected.name,
    };
  }

  return { bindings, unmatched, ignored };
}

async function linkPrivateAssetPackFromOwlbear(OBR, storage) {
  if (!OBR?.assets?.downloadImages) {
    throw new Error("A API de assets do Owlbear não está disponível.");
  }

  const pack = getConfiguredPrivateAssetPack(storage);
  if (!pack) {
    throw new Error("Configure o Private Asset Pack antes de vincular os assets.");
  }

  const search =
    typeof pack.bindingSearch === "string" && pack.bindingSearch.trim()
      ? pack.bindingSearch.trim()
      : "DSC";
  const selected = await OBR.assets.downloadImages(true, search);
  const { bindings, unmatched } = matchOwlbearAssetBindings(pack, selected);
  if (Object.keys(bindings).length) {
    savePrivateAssetBindings(bindings, storage);
  }

  return {
    selected: selected.length,
    linked: Object.keys(bindings).length,
    unmatched,
    search,
  };
}

function configurePrivateAssetPack(importedPack, storage) {
  installPrivateAssetPack(importedPack.pack, storage);
  return importedPack.pack;
}

const UPLOAD_REQUEST_ID = "OBR_ASSETS_UPLOAD_IMAGES";
const UPLOAD_RESPONSE_PREFIX = `${UPLOAD_REQUEST_ID}_RESPONSE_`;
const DEFAULT_TIMEOUT_MS = 7000;
const DIAGNOSTIC_FIELDS = [
  "url",
  "width",
  "height",
  "mime",
  "id",
  "assetId",
  "name",
  "images",
  "assets",
  "items",
];
const IDENTIFIER_FIELD_PATTERN = /(?:id|identifier|uuid|key|ref|hash|path|uri|url)$/i;
const activeMessageBuses = new WeakSet();

function isObject(value) {
  return Boolean(value && typeof value === "object");
}

function getJavascriptType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function decodeBase64Url(value, atobImplementation) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atobImplementation(padded);
}

function getOwlbearOriginFromLocation(location, atobImplementation = globalThis.atob) {
  const encodedReference = new URLSearchParams(location?.search || "").get("obrref");
  if (!encodedReference || typeof atobImplementation !== "function") {
    throw new Error("A origem do Owlbear não está disponível para a sondagem.");
  }

  let decodedReference;
  try {
    decodedReference = decodeBase64Url(encodedReference, atobImplementation);
  } catch {
    throw new Error("A referência de origem do Owlbear é inválida.");
  }

  const separatorIndex = decodedReference.indexOf(" ");
  const origin = separatorIndex >= 0 ? decodedReference.slice(0, separatorIndex) : "";
  try {
    return new URL(origin).origin;
  } catch {
    throw new Error("A referência não contém uma origem válida do Owlbear.");
  }
}

function isPrivateAssetUploadResponseMessage(event, owlbearOrigin, responseId) {
  return Boolean(
    event?.origin === owlbearOrigin &&
      typeof responseId === "string" &&
      responseId.startsWith(UPLOAD_RESPONSE_PREFIX) &&
      isObject(event?.data) &&
      event.data.id === responseId,
  );
}

function isImageContent(value) {
  return Boolean(
    isObject(value) &&
      typeof value.url === "string" &&
      typeof value.width === "number" &&
      typeof value.height === "number" &&
      typeof value.mime === "string",
  );
}

function inspectPayload(payload) {
  const keys = new Set();
  const fieldPaths = Object.fromEntries(DIAGNOSTIC_FIELDS.map((field) => [field, []]));
  const urls = [];
  const imageContents = [];
  const imageContentPaths = [];
  const assetReferences = [];
  const identifierCandidates = [];
  const fieldInventory = [];
  const arrayLengths = [];
  const visited = new WeakSet();

  function visit(value, path) {
    if (!isObject(value) || visited.has(value)) {
      return;
    }
    visited.add(value);

    if (isImageContent(value)) {
      imageContents.push(value);
      imageContentPaths.push(path);
    }
    if (Array.isArray(value)) {
      arrayLengths.push({ path, length: value.length });
    }

    for (const key of Object.keys(value)) {
      keys.add(key);
      const child = value[key];
      const childPath = path ? `${path}.${key}` : key;
      const fieldEntry = {
        path: childPath,
        key,
        javascriptType: getJavascriptType(child),
      };
      fieldInventory.push(fieldEntry);
      if (IDENTIFIER_FIELD_PATTERN.test(key)) {
        identifierCandidates.push(
          isObject(child) ? fieldEntry : { ...fieldEntry, value: child },
        );
      }
      if (Object.hasOwn(fieldPaths, key)) {
        fieldPaths[key].push(childPath);
      }
      if (typeof child === "string" && (/^https?:\/\//i.test(child) || key === "url")) {
        urls.push({ path: childPath, value: child });
      }
      if (typeof child === "string" && /^(?:assetId|assetName|id|name)$/i.test(key)) {
        assetReferences.push({ path: childPath, value: child });
      }
      visit(child, childPath);
    }
  }

  visit(payload, "payload");
  const directItemArray = [payload, payload?.items, payload?.images, payload?.assets].find(
    Array.isArray,
  );

  return {
    javascriptType: getJavascriptType(payload),
    foundAtAnyDepth: {
      ImageContent: imageContents.length > 0,
      ...Object.fromEntries(
        DIAGNOSTIC_FIELDS.map((field) => [field, fieldPaths[field].length > 0]),
      ),
    },
    fieldPaths,
    imageContentPaths,
    keys: [...keys],
    urls,
    imageContents,
    assetReferences,
    identifierCandidates,
    fieldInventory,
    arrayLengths,
    returnedItemCount: directItemArray?.length ?? (isImageContent(payload) ? 1 : 0),
  };
}

function createPrivateAssetUploadResponseReport(responseId, payload) {
  return {
    responseMessageId: responseId,
    rawPayload: payload,
    ...inspectPayload(payload),
  };
}

function logPrivateAssetUploadResponseReport(report, logger) {
  const { rawPayload, ...summary } = report;

  logger.log(
    `[Cartas Duplas] Payload bruto de ${report.responseMessageId} (sem normalização):`,
    rawPayload,
  );
  logger.log("[Cartas Duplas] Resumo da resposta de upload:", summary);
}

function createSerializableDiagnosticSnapshot(value, path, visited) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : `[Number: ${String(value)}]`;
  }
  if (typeof value === "undefined") {
    return "[undefined]";
  }
  if (typeof value === "bigint") {
    return `[BigInt: ${value.toString()}]`;
  }
  if (typeof value === "symbol") {
    return `[Symbol: ${value.description || "sem descrição"}]`;
  }
  if (typeof value === "function") {
    return `[Function: ${value.name || "anônima"}]`;
  }
  if (!isObject(value)) {
    return String(value);
  }
  if (visited.has(value)) {
    return `[Circular -> ${visited.get(value)}]`;
  }
  visited.set(value, path);

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "[Date inválida]" : value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => {
      try {
        return createSerializableDiagnosticSnapshot(child, `${path}[${index}]`, visited);
      } catch (error) {
        return `[Falha ao representar: ${error?.message || String(error)}]`;
      }
    });
  }

  const snapshot = {};
  let propertyKeys;
  try {
    propertyKeys = Reflect.ownKeys(value);
  } catch (error) {
    return `[Falha ao listar propriedades: ${error?.message || String(error)}]`;
  }
  for (const propertyKey of propertyKeys) {
    const displayKey =
      typeof propertyKey === "symbol"
        ? `[Symbol: ${propertyKey.description || "sem descrição"}]`
        : propertyKey;
    try {
      snapshot[displayKey] = createSerializableDiagnosticSnapshot(
        value[propertyKey],
        `${path}.${displayKey}`,
        visited,
      );
    } catch (error) {
      snapshot[displayKey] = `[Falha ao representar: ${error?.message || String(error)}]`;
    }
  }
  return snapshot;
}

function stringifyPrivateAssetUploadDiagnostic(value) {
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // A representação abaixo é usada somente para exibição e cópia do diagnóstico.
  }

  try {
    return JSON.stringify(
      createSerializableDiagnosticSnapshot(value, "payload", new WeakMap()),
      null,
      2,
    );
  } catch (error) {
    return `[Não foi possível representar o valor: ${error?.message || String(error)}]`;
  }
}

function formatPrivateAssetUploadResponseReport(report) {
  if (!report || typeof report !== "object") {
    throw new Error("O relatório da sondagem não está disponível.");
  }

  const { rawPayload, ...summary } = report;
  const foundFields = Object.entries(report.foundAtAnyDepth || {})
    .map(([field, found]) => `${field}: ${found ? "sim" : "não"}`)
    .join("\n");

  return [
    "Cartas Duplas — diagnóstico temporário de uploadImages",
    "Resposta capturada: sim",
    `Mensagem: ${report.responseMessageId || "não informada"}`,
    `Tipo JavaScript do payload: ${report.javascriptType || typeof rawPayload}`,
    "",
    "CAMPOS PROCURADOS",
    foundFields || "Nenhum campo diagnóstico foi enumerado.",
    "",
    "CAMINHOS DOS CAMPOS",
    stringifyPrivateAssetUploadDiagnostic(report.fieldPaths || {}),
    "",
    "URLS ENCONTRADAS",
    stringifyPrivateAssetUploadDiagnostic(report.urls || []),
    "",
    "CANDIDATOS A IDS E REFERÊNCIAS",
    stringifyPrivateAssetUploadDiagnostic({
      assetReferences: report.assetReferences || [],
      identifierCandidates: report.identifierCandidates || [],
    }),
    "",
    "PAYLOAD BRUTO — REPRESENTAÇÃO PARA EXIBIÇÃO/CÓPIA",
    stringifyPrivateAssetUploadDiagnostic(rawPayload),
    "",
    "RESUMO COMPLETO",
    stringifyPrivateAssetUploadDiagnostic(summary),
  ].join("\n");
}

async function probePrivateAssetUploadResponse(
  OBR,
  imageUpload,
  typeHint,
  options = {},
) {
  if (!OBR?.assets?.uploadImages || !imageUpload || Array.isArray(imageUpload)) {
    throw new Error("A sondagem exige exatamente um ImageUpload válido.");
  }

  const windowObject = options.windowObject || globalThis.window;
  const messageBus = options.messageBus || OBR.assets.messageBus;
  const owlbearOrigin =
    options.owlbearOrigin || getOwlbearOriginFromLocation(windowObject?.location);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logger = options.logger === undefined ? globalThis.console : options.logger;
  const onReport = options.onReport;
  if (
    !windowObject?.addEventListener ||
    !windowObject?.removeEventListener ||
    typeof messageBus?.send !== "function"
  ) {
    throw new Error("Os recursos internos necessários à sondagem não estão disponíveis.");
  }
  if (activeMessageBuses.has(messageBus)) {
    throw new Error("Já existe uma sondagem de upload em andamento neste painel.");
  }
  activeMessageBuses.add(messageBus);

  let expectedResponseId = null;
  let listenerInstalled = false;
  let timeoutId = null;
  let resolveResponse;
  let rejectResponse;
  const responsePromise = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  const removeListener = () => {
    if (listenerInstalled) {
      windowObject.removeEventListener("message", onMessage);
      listenerInstalled = false;
    }
  };
  const clearResponseTimeout = () => {
    if (timeoutId !== null) {
      windowObject.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  const onMessage = (event) => {
    if (!isPrivateAssetUploadResponseMessage(event, owlbearOrigin, expectedResponseId)) {
      return;
    }

    removeListener();
    clearResponseTimeout();
    const payload = event.data.data;
    try {
      const report = createPrivateAssetUploadResponseReport(event.data.id, payload);
      if (logger?.log) {
        logPrivateAssetUploadResponseReport(report, logger);
      }
      if (typeof onReport === "function") {
        onReport(report);
      }
    } catch (error) {
      rejectResponse(error);
      return;
    }
    resolveResponse(payload);
  };

  const originalSend = messageBus.send;
  let sendWasWrapped = false;
  try {
    windowObject.addEventListener("message", onMessage);
    listenerInstalled = true;
    timeoutId = windowObject.setTimeout(() => {
      removeListener();
      timeoutId = null;
      rejectResponse(
        new Error(`A resposta de ${UPLOAD_REQUEST_ID} não chegou em ${timeoutMs}ms.`),
      );
    }, timeoutMs);

    messageBus.send = function sendWithUploadNonceCapture(id, data, nonce) {
      if (id === UPLOAD_REQUEST_ID && expectedResponseId === null) {
        if (typeof nonce !== "string" || !nonce.startsWith("_")) {
          throw new Error("O nonce da sondagem de upload é inválido.");
        }
        expectedResponseId = `${id}_RESPONSE${nonce}`;
      }
      return originalSend.call(this, id, data, nonce);
    };
    sendWasWrapped = true;

    const uploadPromise = OBR.assets.uploadImages([imageUpload], typeHint);
    messageBus.send = originalSend;
    sendWasWrapped = false;

    if (!expectedResponseId) {
      throw new Error("A sondagem não identificou o nonce do upload.");
    }

    const [payload] = await Promise.all([responsePromise, uploadPromise]);
    return payload;
  } finally {
    if (sendWasWrapped) {
      messageBus.send = originalSend;
    }
    removeListener();
    clearResponseTimeout();
    activeMessageBuses.delete(messageBus);
  }
}

function selectSingleImageForUploadProbe(
  documentObject = globalThis.document,
  accept = "image/*",
) {
  if (!documentObject?.createElement) {
    return Promise.reject(
      new Error("O seletor de arquivo não está disponível neste contexto."),
    );
  }

  return new Promise((resolve, reject) => {
    const input = documentObject.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = false;
    input.hidden = true;

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      input.remove();
    };
    const onChange = () => {
      const files = [...(input.files || [])];
      cleanup();
      if (files.length !== 1) {
        reject(new Error("Selecione exatamente uma imagem pequena para a sondagem."));
        return;
      }
      resolve(files[0]);
    };
    const onCancel = () => {
      cleanup();
      reject(new Error("A seleção da imagem da sondagem foi cancelada."));
    };

    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    (documentObject.body || documentObject.documentElement).append(input);
    try {
      input.click();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function runPrivateAssetUploadResponseConsoleProbe(
  OBR,
  buildImageUpload,
  options = {},
) {
  if (typeof buildImageUpload !== "function") {
    throw new Error("O construtor de ImageUpload do Owlbear não está disponível.");
  }

  const {
    file: providedFile,
    documentObject = globalThis.document,
    typeHint = "PROP",
    onFileSelected,
    ...probeOptions
  } = options;
  const file = providedFile || (await selectSingleImageForUploadProbe(documentObject));
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) {
    throw new Error("A sondagem exige exatamente um arquivo de imagem não vazio.");
  }
  if (typeof file.type !== "string" || !file.type.startsWith("image/")) {
    throw new Error("O arquivo escolhido não foi reconhecido como imagem.");
  }
  if (typeof onFileSelected === "function") {
    onFileSelected(file);
  }

  const builder = buildImageUpload(file);
  if (!builder?.name || !builder?.build) {
    throw new Error("Não foi possível construir o ImageUpload da sondagem.");
  }
  builder.name(`[Sonda Cartas Duplas] ${file.name || "imagem"}`);
  if (typeof builder.description === "function") {
    builder.description("Upload diagnóstico único de OBR_ASSETS_UPLOAD_IMAGES");
  }
  const imageUpload = builder.build();

  return probePrivateAssetUploadResponse(OBR, imageUpload, typeHint, probeOptions);
}

const DATA_URL_PROBE_NAME = "[Sonda Cartas Duplas] data URL";
const DATA_URL_PROBE_ACCEPT = "image/png,image/jpeg,image/webp";
const DATA_URL_PROBE_GRID_WIDTH = 2;
const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function asBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Os bytes da imagem não estão em um formato reconhecido.");
}

function hasBytes(bytes, expected, offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function detectDataUrlProbeMime(bytesValue, file = {}) {
  const bytes = asBytes(bytesValue);
  if (bytes.length >= 8 && hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytes.length >= 3 && hasBytes(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }

  const declaredMime = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  if (SUPPORTED_MIME_TYPES.has(declaredMime)) {
    return declaredMime;
  }

  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  throw new Error("Escolha uma imagem PNG, JPEG ou WebP válida para a sonda.");
}

function bytesToDataUrl(
  bytesValue,
  mime,
  btoaImplementation = globalThis.btoa,
) {
  const bytes = asBytes(bytesValue);
  if (!bytes.length) {
    throw new Error("A imagem escolhida está vazia.");
  }
  if (!SUPPORTED_MIME_TYPES.has(mime)) {
    throw new Error(`MIME não suportado pela sonda: ${mime || "não informado"}.`);
  }
  if (typeof btoaImplementation !== "function") {
    throw new Error("O navegador não disponibilizou a conversão base64 necessária.");
  }

  const chunks = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return `data:${mime};base64,${btoaImplementation(chunks.join(""))}`;
}

function readDataUrlImageDimensions(
  dataUrl,
  ImageImplementation = globalThis.Image,
) {
  if (typeof ImageImplementation !== "function") {
    return Promise.reject(
      new Error("O navegador não disponibilizou o decodificador de imagem necessário."),
    );
  }

  return new Promise((resolve, reject) => {
    const image = new ImageImplementation();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      image.onload = null;
      image.onerror = null;
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        reject(new Error("A imagem foi lida, mas não apresentou dimensões válidas."));
        return;
      }
      resolve({ width, height });
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      reject(new Error("O navegador não conseguiu decodificar a imagem escolhida."));
    };
    image.src = dataUrl;
  });
}

async function prepareDataUrlProbeImage(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Selecione exatamente um arquivo de imagem local.");
  }

  const buffer = await file.arrayBuffer();
  const bytes = asBytes(buffer);
  const mime = detectDataUrlProbeMime(bytes, file);
  const dataUrl = bytesToDataUrl(bytes, mime, options.btoaImplementation);
  const readDimensions = options.readDimensions || readDataUrlImageDimensions;
  const { width, height } = await readDimensions(dataUrl, options.ImageImplementation);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("A imagem escolhida não possui dimensões positivas válidas.");
  }

  return {
    dataUrl,
    height,
    mime,
    originalByteLength: bytes.byteLength,
    width,
  };
}

function redactDataUrls(value) {
  return String(value).replace(
    /data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/_=-]*/gi,
    (dataUrl) => {
      const prefix = dataUrl.slice(0, dataUrl.indexOf(",") + 1);
      return `${prefix}...[base64 omitida; comprimento ${dataUrl.length}]`;
    },
  );
}

function getErrorDetails(error) {
  return {
    message: redactDataUrls(error?.message || String(error)),
    name: error?.name || "Error",
    stack: typeof error?.stack === "string" ? redactDataUrls(error.stack) : null,
  };
}

function createDataUrlSummary(prepared) {
  return {
    dataUrlLength: prepared.dataUrl.length,
    dataUrlPrefix: `data:${prepared.mime};base64,...`,
    height: prepared.height,
    mime: prepared.mime,
    originalByteLength: prepared.originalByteLength,
    width: prepared.width,
  };
}

function createDataUrlProbeReport(prepared, item, addItemsCompleted, error = null) {
  return {
    probe: "ImageContent.url com data URL",
    success: addItemsCompleted && !error,
    addItemsCompleted,
    itemId: item?.id || null,
    itemName: item?.name || DATA_URL_PROBE_NAME,
    ...createDataUrlSummary(prepared),
    error: error ? getErrorDetails(error) : null,
  };
}

async function getDefaultProbePosition(OBR) {
  const [width, height] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  return OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 });
}

async function runDataUrlImageProbe(OBR, buildImage, options = {}) {
  if (!OBR?.scene?.items?.addItems || typeof buildImage !== "function") {
    throw new Error("A API de itens de imagem do Owlbear não está disponível.");
  }

  const file =
    options.file ||
    (await selectSingleImageForUploadProbe(
      options.documentObject || globalThis.document,
      DATA_URL_PROBE_ACCEPT,
    ));
  if (typeof options.onFileSelected === "function") {
    options.onFileSelected(file);
  }

  const prepared = await prepareDataUrlProbeImage(file, options);
  if (typeof options.onPrepared === "function") {
    options.onPrepared(createDataUrlSummary(prepared));
  }

  const getPosition = options.getPosition || (() => getDefaultProbePosition(OBR));
  const position = await getPosition();
  const imageContent = createImageData({
    height: prepared.height,
    mime: prepared.mime,
    url: prepared.dataUrl,
    width: prepared.width,
  });
  const item = buildImage(
    imageContent,
    createGridData(imageContent, DATA_URL_PROBE_GRID_WIDTH),
  )
    .name(DATA_URL_PROBE_NAME)
    .description("Experimento diagnóstico temporário de ImageContent.url com data URL")
    .layer("PROP")
    .position(position)
    .build();

  try {
    await OBR.scene.items.addItems([item]);
  } catch (error) {
    const report = createDataUrlProbeReport(prepared, item, false, error);
    const failure = new Error(
      `O Owlbear rejeitou o Image item da sonda: ${report.error.message}`,
      { cause: error },
    );
    failure.name = "DataUrlImageProbeError";
    failure.diagnosticReport = report;
    if (failure.cause === undefined) {
      failure.cause = error;
    }
    throw failure;
  }

  return createDataUrlProbeReport(prepared, item, true);
}

function formatDataUrlImageProbeReport(report) {
  if (!report || typeof report !== "object") {
    throw new Error("O relatório da sonda de data URL não está disponível.");
  }

  const lines = [
    "Cartas Duplas — diagnóstico temporário de data URL",
    `Resultado: ${report.success ? "item criado" : "falha"}`,
    `addItems terminou sem erro: ${report.addItemsCompleted ? "sim" : "não"}`,
    `itemId: ${report.itemId || "não disponível"}`,
    `itemName: ${report.itemName || DATA_URL_PROBE_NAME}`,
    `mime: ${report.mime || "não disponível"}`,
    `width: ${report.width ?? "não disponível"}`,
    `height: ${report.height ?? "não disponível"}`,
    `originalByteLength: ${report.originalByteLength ?? "não disponível"}`,
    `dataUrlPrefix: ${report.dataUrlPrefix || "não disponível"}`,
    `dataUrlLength: ${report.dataUrlLength ?? "não disponível"}`,
  ];

  if (report.error) {
    lines.push(
      "",
      "ERRO",
      `name: ${report.error.name || "Error"}`,
      `message: ${report.error.message || "não disponível"}`,
      "stack:",
      report.error.stack || "não disponível",
      "",
      "A sonda parou após a rejeição. Nenhuma alternativa foi tentada.",
    );
  } else {
    lines.push(
      "",
      "VERIFICAÇÃO MANUAL",
      "1. Verifique se a imagem apareceu corretamente na cena.",
      "2. Recarregue completamente a página do Owlbear.",
      "3. Verifique se o mesmo item continua aparecendo com a imagem correta.",
    );
  }

  return lines.join("\n");
}

const PROBE_MIME_TYPES = Object.freeze(["image/webp", "image/jpeg"]);
const SHA256_PATTERN = /^sha256:([0-9a-f]{64})$/;
const MAX_PROBE_ASSET_SIZE = 2_000_000;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getErrorMessage$1(error, fallback = "Falha desconhecida.") {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : fallback;
}

function normalizeSha256(value, label = "blobSha256") {
  const normalized = String(value || "").trim().toLowerCase();
  const match = normalized.match(SHA256_PATTERN);
  if (!match) {
    throw new Error(`${label} precisa usar o formato sha256:<64 caracteres hexadecimais>.`);
  }
  return { value: normalized, hex: match[1] };
}

function normalizeMime(value) {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function assertProbeMime(value, label = "Asset") {
  const mime = normalizeMime(value);
  if (!PROBE_MIME_TYPES.includes(mime)) {
    throw new Error(
      `${label} usa MIME inesperado: ${mime || "não informado"}. A sonda aceita apenas image/webp e image/jpeg.`,
    );
  }
  return mime;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} precisa ser um inteiro positivo.`);
  }
  return value;
}

function normalizeGatewayUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Informe uma URL válida para o gateway HTTPS.");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("O gateway precisa usar HTTPS e não pode conter credenciais na URL.");
  }
  if (url.search || url.hash || !url.hostname) {
    throw new Error("A URL do gateway não pode conter query string ou fragmento.");
  }

  return url.origin + url.pathname.replace(/\/+$/, "");
}

function getCrypto(cryptoImplementation) {
  const implementation = cryptoImplementation || globalThis.crypto;
  if (!implementation?.subtle?.digest) {
    throw new Error("Este ambiente não oferece SHA-256 pela Web Crypto API.");
  }
  return implementation;
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new TypeError("O cálculo de SHA-256 exige bytes em ArrayBuffer.");
}

async function calculateBlobSha256(bytes, cryptoImplementation) {
  const digest = await getCrypto(cryptoImplementation).subtle.digest(
    "SHA-256",
    toArrayBuffer(bytes),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function getCandidateSize(asset, file) {
  return Number.isFinite(file?.size) && file.size > 0 ? file.size : asset.size;
}

function findSmallestCandidate(selection, mime) {
  return Object.entries(selection.pack.assets)
    .flatMap(([assetId, asset]) => {
      const file = selection.assetFiles.get(assetId);
      return file && normalizeMime(asset.mime) === mime ? [{ assetId, asset, file }] : [];
    })
    .sort(
      (left, right) =>
        getCandidateSize(left.asset, left.file) - getCandidateSize(right.asset, right.file) ||
        left.assetId.localeCompare(right.assetId),
    )[0];
}

async function prepareCandidate(candidate, kind, cryptoImplementation) {
  const { assetId, asset, file } = candidate;
  const label = `${kind} ${assetId}`;
  const mime = assertProbeMime(asset.mime, label);
  const width = positiveInteger(asset.width, `A largura de ${label}`);
  const height = positiveInteger(asset.height, `A altura de ${label}`);
  const expectedSize = positiveInteger(asset.size, `O tamanho de ${label}`);
  if (expectedSize > MAX_PROBE_ASSET_SIZE) {
    throw new Error(
      `${label} possui ${expectedSize} bytes; a POC aceita no máximo ${MAX_PROBE_ASSET_SIZE} bytes por arquivo.`,
    );
  }

  const browserMime = normalizeMime(file.type);
  if (browserMime && browserMime !== mime) {
    throw new Error(
      `${label} possui MIME divergente: manifesto ${mime}, navegador ${browserMime}.`,
    );
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== expectedSize) {
    throw new Error(
      `${label} possui ${bytes.byteLength} bytes, mas o manifesto declara ${expectedSize}.`,
    );
  }

  const expectedHash = normalizeSha256(asset.blobSha256, `O blobSha256 de ${label}`).value;
  const calculatedHash = await calculateBlobSha256(bytes, cryptoImplementation);
  if (calculatedHash !== expectedHash) {
    throw new Error(
      `Integridade inválida em ${label}: calculado ${calculatedHash}, esperado ${expectedHash}.`,
    );
  }

  return {
    kind,
    assetId,
    blobSha256: expectedHash,
    mime,
    width,
    height,
    originalByteLength: bytes.byteLength,
    bytes,
  };
}

async function selectPrivateAssetStorageProbeAssets(
  selection,
  options = {},
) {
  if (!selection?.pack?.assets || !(selection.assetFiles instanceof Map)) {
    throw new Error("Selecione novamente o Runtime Private Asset Pack antes da sonda HTTPS.");
  }

  const webp = findSmallestCandidate(selection, "image/webp");
  const jpeg = findSmallestCandidate(selection, "image/jpeg");
  if (!webp || !jpeg) {
    throw new Error(
      "O pack selecionado precisa conter pelo menos um WebP e um JPEG com arquivo disponível.",
    );
  }

  return Promise.all([
    prepareCandidate(webp, "WebP", options.crypto),
    prepareCandidate(jpeg, "JPEG", options.crypto),
  ]);
}

async function readJsonResponse(response, stage) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : `HTTP ${response.status}`;
    throw new Error(`${stage}: ${message}.`);
  }
  if (!isRecord(payload)) {
    throw new Error(`${stage}: o gateway retornou JSON inválido.`);
  }
  return payload;
}

function assertResolvedUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("O gateway retornou uma URL GET inválida.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("O gateway retornou uma URL GET que não usa HTTPS seguro.");
  }
  return url.href;
}

function validateCheckResult(result, descriptor) {
  if (!isRecord(result) || result.blobSha256 !== descriptor.blobSha256) {
    throw new Error(`A consulta do gateway não confirmou ${descriptor.blobSha256}.`);
  }
  if (typeof result.exists !== "boolean") {
    throw new Error(`A consulta do gateway não informou se ${descriptor.blobSha256} existe.`);
  }
  return {
    blobSha256: result.blobSha256,
    exists: result.exists,
    url: typeof result.url === "string" && result.url ? assertResolvedUrl(result.url) : null,
  };
}

function createPrivateAssetStorageClient(options = {}) {
  const gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
  const uploadToken = String(options.uploadToken || "");
  const fetchImplementation = options.fetch || globalThis.fetch;
  if (uploadToken.length < 32) {
    throw new Error("Informe a capability temporária de upload fornecida no deploy da POC.");
  }
  if (typeof fetchImplementation !== "function") {
    throw new Error("Este ambiente não oferece fetch para acessar o gateway.");
  }

  const authorizedHeaders = {
    Authorization: `Bearer ${uploadToken}`,
  };

  return {
    gatewayUrl,
    gatewayHostname: new URL(gatewayUrl).hostname,

    async checkBlobs(descriptors) {
      const response = await fetchImplementation(`${gatewayUrl}/v1/blobs/check`, {
        method: "POST",
        credentials: "omit",
        headers: {
          ...authorizedHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          blobs: descriptors.map((descriptor) => ({
            blobSha256: normalizeSha256(descriptor.blobSha256).value,
            size: positiveInteger(descriptor.originalByteLength, "O tamanho do blob"),
            mime: assertProbeMime(descriptor.mime),
          })),
        }),
      });
      const payload = await readJsonResponse(response, "Consulta de blobs");
      if (!Array.isArray(payload.results) || payload.results.length !== descriptors.length) {
        throw new Error("Consulta de blobs: o gateway retornou uma lista incompleta.");
      }
      return payload.results.map((result, index) =>
        validateCheckResult(result, descriptors[index]),
      );
    },

    async uploadBlob(descriptor) {
      const hash = normalizeSha256(descriptor.blobSha256).hex;
      const response = await fetchImplementation(`${gatewayUrl}/v1/blobs/${hash}`, {
        method: "PUT",
        credentials: "omit",
        headers: {
          ...authorizedHeaders,
          "Content-Type": assertProbeMime(descriptor.mime),
          "X-Blob-SHA256": descriptor.blobSha256,
          "X-Blob-Size": String(descriptor.originalByteLength),
        },
        body: descriptor.bytes,
      });
      const payload = await readJsonResponse(response, `Upload de ${descriptor.blobSha256}`);
      if (payload.blobSha256 !== descriptor.blobSha256 || payload.stored !== true) {
        throw new Error(`Upload de ${descriptor.blobSha256}: confirmação inválida do gateway.`);
      }
      return {
        stored: true,
        alreadyExisted: payload.alreadyExisted === true,
        url: assertResolvedUrl(payload.url),
      };
    },

    async verifyGet(descriptor, rawUrl, cryptoImplementation) {
      const url = assertResolvedUrl(rawUrl);
      let response;
      try {
        response = await fetchImplementation(url, {
          method: "GET",
          credentials: "omit",
        });
      } catch (error) {
        throw new Error(
          `GET/CORS de ${descriptor.blobSha256} falhou: ${getErrorMessage$1(error)}`,
        );
      }
      if (!response.ok) {
        throw new Error(`GET de ${descriptor.blobSha256} retornou HTTP ${response.status}.`);
      }

      const receivedMime = normalizeMime(response.headers.get("Content-Type"));
      if (receivedMime !== descriptor.mime) {
        throw new Error(
          `GET de ${descriptor.blobSha256} retornou Content-Type ${receivedMime || "ausente"}; esperado ${descriptor.mime}.`,
        );
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== descriptor.originalByteLength) {
        throw new Error(
          `GET de ${descriptor.blobSha256} retornou ${bytes.byteLength} bytes; esperado ${descriptor.originalByteLength}.`,
        );
      }
      const calculatedHash = await calculateBlobSha256(bytes, cryptoImplementation);
      if (calculatedHash !== descriptor.blobSha256) {
        throw new Error(
          `GET de ${descriptor.blobSha256} falhou na verificação SHA-256: recebido ${calculatedHash}.`,
        );
      }

      const contentLengthHeader = response.headers.get("Content-Length");
      const contentLength = contentLengthHeader == null ? null : Number(contentLengthHeader);
      return {
        status: response.status,
        cors: "sucesso (resposta e bytes legíveis no navegador)",
        contentType: receivedMime,
        contentLength: Number.isFinite(contentLength) ? contentLength : null,
        verifiedBlobSha256: calculatedHash,
      };
    },
  };
}

function buildPrivateAssetStorageBinding(descriptor, rawUrl) {
  return {
    assetId: descriptor.assetId,
    blobSha256: normalizeSha256(descriptor.blobSha256).value,
    url: assertResolvedUrl(rawUrl),
    width: positiveInteger(descriptor.width, "A largura do binding"),
    height: positiveInteger(descriptor.height, "A altura do binding"),
    mime: assertProbeMime(descriptor.mime),
  };
}

function createAssetReport(descriptor) {
  return {
    kind: descriptor.kind,
    assetId: descriptor.assetId,
    blobSha256: descriptor.blobSha256,
    mime: descriptor.mime,
    width: descriptor.width,
    height: descriptor.height,
    originalByteLength: descriptor.originalByteLength,
    alreadyExisted: null,
    uploadPerformed: false,
    uploadCompleted: false,
    urlResolved: false,
    urlHostname: null,
    getUrl: null,
    cors: "não verificado",
    httpGetStatus: null,
    receivedContentType: null,
    receivedContentLength: null,
    addItems: "não executado",
    itemId: null,
  };
}

function attachDiagnosticReport(error, report) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  report.completedAt = new Date().toISOString();
  report.success = false;
  report.error = {
    name: normalized.name || "Error",
    message: getErrorMessage$1(normalized),
  };
  normalized.diagnosticReport = report;
  return normalized;
}

async function runPrivateAssetStorageProbe(options = {}) {
  const report = {
    probe: "private-asset-storage-https",
    startedAt: new Date().toISOString(),
    completedAt: null,
    success: false,
    gatewayHostname: null,
    assets: [],
    doubleSidedCard: {
      addItems: "não executado",
      itemId: null,
    },
    error: null,
  };

  try {
    options.onProgress?.({ stage: "selecting" });
    const descriptors = await selectPrivateAssetStorageProbeAssets(options.selection, {
      crypto: options.crypto,
    });
    report.assets = descriptors.map(createAssetReport);

    const client = createPrivateAssetStorageClient({
      gatewayUrl: options.gatewayUrl,
      uploadToken: options.uploadToken,
      fetch: options.fetch,
    });
    report.gatewayHostname = client.gatewayHostname;

    options.onProgress?.({ stage: "checking", total: descriptors.length });
    const initial = await client.checkBlobs(descriptors);
    for (let index = 0; index < descriptors.length; index += 1) {
      report.assets[index].alreadyExisted = initial[index].exists;
      if (!initial[index].exists) {
        options.onProgress?.({
          stage: "uploading",
          kind: descriptors[index].kind,
          index: index + 1,
          total: descriptors.length,
        });
        report.assets[index].uploadPerformed = true;
        await client.uploadBlob(descriptors[index]);
        report.assets[index].uploadCompleted = true;
      }
    }

    options.onProgress?.({ stage: "confirming", total: descriptors.length });
    const confirmed = await client.checkBlobs(descriptors);
    const assets = [];
    for (let index = 0; index < descriptors.length; index += 1) {
      const descriptor = descriptors[index];
      if (!confirmed[index].exists || !confirmed[index].url) {
        throw new Error(`O gateway não confirmou o blob ${descriptor.blobSha256} após o upload.`);
      }

      const assetReport = report.assets[index];
      assetReport.urlResolved = true;
      assetReport.getUrl = confirmed[index].url;
      assetReport.urlHostname = new URL(confirmed[index].url).hostname;
      options.onProgress?.({
        stage: "verifying-get",
        kind: descriptor.kind,
        index: index + 1,
        total: descriptors.length,
      });
      const getResult = await client.verifyGet(
        descriptor,
        confirmed[index].url,
        options.crypto,
      );
      assetReport.cors = getResult.cors;
      assetReport.httpGetStatus = getResult.status;
      assetReport.receivedContentType = getResult.contentType;
      assetReport.receivedContentLength = getResult.contentLength;

      const binding = buildPrivateAssetStorageBinding(descriptor, confirmed[index].url);
      assets.push({
        assetId: descriptor.assetId,
        blobSha256: descriptor.blobSha256,
        imageContent: {
          width: binding.width,
          height: binding.height,
          mime: binding.mime,
          url: binding.url,
        },
        binding,
      });
    }

    report.completedAt = new Date().toISOString();
    return { assets, report };
  } catch (error) {
    throw attachDiagnosticReport(error, report);
  }
}

function yesNo(value) {
  return value == null ? "não verificado" : value ? "sim" : "não";
}

function valueOrPending(value) {
  return value == null || value === "" ? "não verificado" : String(value);
}

function formatPrivateAssetStorageProbeReport(report) {
  const lines = [
    "Diagnóstico temporário — armazenamento HTTPS",
    `início: ${valueOrPending(report?.startedAt)}`,
    `fim: ${valueOrPending(report?.completedAt)}`,
    `gateway hostname: ${valueOrPending(report?.gatewayHostname)}`,
    `resultado geral: ${report?.success ? "sucesso" : report?.error ? "falha" : "incompleto"}`,
  ];

  for (const asset of report?.assets || []) {
    lines.push(
      "",
      `Asset ${asset.kind}`,
      `assetId: ${valueOrPending(asset.assetId)}`,
      `blobSha256: ${valueOrPending(asset.blobSha256)}`,
      `mime: ${valueOrPending(asset.mime)}`,
      `width: ${valueOrPending(asset.width)}`,
      `height: ${valueOrPending(asset.height)}`,
      `originalByteLength: ${valueOrPending(asset.originalByteLength)}`,
      `já existia no storage: ${yesNo(asset.alreadyExisted)}`,
      `upload realizado: ${yesNo(asset.uploadPerformed)}`,
      `upload concluído: ${yesNo(asset.uploadCompleted)}`,
      `URL resolvida: ${yesNo(asset.urlResolved)}`,
      `hostname da URL: ${valueOrPending(asset.urlHostname)}`,
      `URL GET (capability de acesso ao asset): ${valueOrPending(asset.getUrl)}`,
      `CORS: ${valueOrPending(asset.cors)}`,
      `HTTP GET: ${valueOrPending(asset.httpGetStatus)}`,
      `Content-Type recebido: ${valueOrPending(asset.receivedContentType)}`,
      `Content-Length recebido: ${valueOrPending(asset.receivedContentLength)}`,
      `addItems: ${valueOrPending(asset.addItems)}`,
      `itemId: ${valueOrPending(asset.itemId)}`,
    );
  }

  lines.push(
    "",
    "Carta dupla de diagnóstico",
    `addItems: ${valueOrPending(report?.doubleSidedCard?.addItems)}`,
    `itemId: ${valueOrPending(report?.doubleSidedCard?.itemId)}`,
  );
  if (report?.error) {
    lines.push(
      "",
      `erro: ${valueOrPending(report.error.name)}: ${valueOrPending(report.error.message)}`,
    );
  }
  lines.push(
    "",
    "O relatório não contém a capability de upload nem credenciais Cloudflare/R2.",
    "A URL GET contém uma capability de leitura necessária para os jogadores carregarem o asset.",
  );
  return lines.join("\n");
}

const elements = {
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
  panelFlipButton: document.querySelector("#panelFlipButton"),
  panelDrawButton: document.querySelector("#panelDrawButton"),
  panelShuffleButton: document.querySelector("#panelShuffleButton"),
  panelReturnButton: document.querySelector("#panelReturnButton"),
  panelRepairButton: document.querySelector("#panelRepairButton"),
  returnOriginButton: document.querySelector("#returnOriginButton"),
  colorAssignments: document.querySelector("#colorAssignments"),
  privatePackInput: document.querySelector("#privatePackInput"),
  privatePackChooseButton: document.querySelector("#privatePackChooseButton"),
  privatePackUploadButton: document.querySelector("#privatePackUploadButton"),
  privatePackLinkButton: document.querySelector("#privatePackLinkButton"),
  privatePackClearButton: document.querySelector("#privatePackClearButton"),
  privatePackInfo: document.querySelector("#privatePackInfo"),
  uploadProbeTestButton: document.querySelector("#uploadProbeTestButton"),
  uploadProbeCopyButton: document.querySelector("#uploadProbeCopyButton"),
  uploadProbeStatus: document.querySelector("#uploadProbeStatus"),
  uploadProbeResult: document.querySelector("#uploadProbeResult"),
  uploadProbeOutput: document.querySelector("#uploadProbeOutput"),
  dataUrlProbeTestButton: document.querySelector("#dataUrlProbeTestButton"),
  dataUrlProbeCopyButton: document.querySelector("#dataUrlProbeCopyButton"),
  dataUrlProbeStatus: document.querySelector("#dataUrlProbeStatus"),
  dataUrlProbeResult: document.querySelector("#dataUrlProbeResult"),
  dataUrlProbeOutput: document.querySelector("#dataUrlProbeOutput"),
  httpsStorageGatewayUrl: document.querySelector("#httpsStorageGatewayUrl"),
  httpsStorageUploadToken: document.querySelector("#httpsStorageUploadToken"),
  httpsStorageProbeTestButton: document.querySelector("#httpsStorageProbeTestButton"),
  httpsStorageProbeCopyButton: document.querySelector("#httpsStorageProbeCopyButton"),
  httpsStorageProbeStatus: document.querySelector("#httpsStorageProbeStatus"),
  httpsStorageProbeResult: document.querySelector("#httpsStorageProbeResult"),
  httpsStorageProbeOutput: document.querySelector("#httpsStorageProbeOutput"),
  developmentSaveSceneButtons: [...document.querySelectorAll("[data-save-scene-preset]")],
  createScenePresetButtons: [...document.querySelectorAll("[data-create-scene-preset]")],
  defaultBoardInfo: document.querySelector("#defaultBoardInfo"),
  connectionStatus: document.querySelector("#connectionStatus"),
  message: document.querySelector("#message"),
};

let obr = null;
let buildImage = null;
let buildImageUpload = null;
let buildSceneUpload = null;
let lastCardSelection = [];
let lastDeckSelection = [];
let lastFlipSelection = [];
let presetDecks = [];
let presetCardGroups = [];
let scenePresetEntries = [];
let sceneCreationRunning = false;
let privatePackRunning = false;
let selectedPrivatePack = null;
let colorAssignmentsRefreshTimer = null;
let uploadProbeRunning = false;
let uploadProbeReportText = "";
let dataUrlProbeRunning = false;
let dataUrlProbeReportText = "";
let httpsStorageProbeRunning = false;
let httpsStorageProbeReportText = "";
const customSelects = new Map();

window.addEventListener("error", (event) => {
  if (!obr) {
    setConnectionStatus("Erro no painel", false);
  }
  setMessage(`Erro no painel: ${getErrorMessage(event.error || event.message)}`, "error");
});

window.addEventListener("unhandledrejection", (event) => {
  if (!obr) {
    setConnectionStatus("Erro no painel", false);
  }
  setMessage(`Erro no painel: ${getErrorMessage(event.reason)}`, "error");
});

function getErrorMessage(error, fallback = "Ocorreu um erro inesperado.") {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function setMessage(text, tone = "neutral") {
  elements.message.textContent = text;
  elements.message.dataset.tone = tone;
}

function setUploadProbeStatus(text, tone = "neutral") {
  elements.uploadProbeStatus.textContent = text;
  elements.uploadProbeStatus.dataset.tone = tone;
}

function updateUploadProbeControls(isConnected = Boolean(obr)) {
  elements.uploadProbeTestButton.disabled = uploadProbeRunning || !isConnected;
  elements.uploadProbeCopyButton.disabled =
    uploadProbeRunning || !uploadProbeReportText;
}

async function writeTextToClipboard(text) {
  let clipboardError = null;
  if (globalThis.navigator?.clipboard?.writeText) {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  try {
    textarea.select();
    if (!document.execCommand?.("copy")) {
      throw clipboardError || new Error("O navegador recusou a cópia do relatório.");
    }
  } finally {
    textarea.remove();
  }
}

async function runUploadProbeFromPanel() {
  if (!obr || !buildImageUpload) {
    setUploadProbeStatus("Sonda indisponível: o painel não está conectado ao Owlbear.", "error");
    return;
  }

  uploadProbeRunning = true;
  uploadProbeReportText = "";
  elements.uploadProbeOutput.textContent = "";
  elements.uploadProbeResult.hidden = true;
  setUploadProbeStatus("Selecione exatamente uma imagem pequena…", "neutral");
  updateUploadProbeControls(true);

  let capturedReport = null;
  try {
    await runPrivateAssetUploadResponseConsoleProbe(obr, buildImageUpload, {
      onFileSelected() {
        setUploadProbeStatus(
          "Enviando uma imagem e aguardando a resposta correspondente…",
          "neutral",
        );
      },
      onReport(report) {
        capturedReport = report;
      },
    });
    if (!capturedReport) {
      throw new Error("O upload terminou sem produzir um relatório diagnóstico.");
    }

    uploadProbeReportText = formatPrivateAssetUploadResponseReport(capturedReport);
    elements.uploadProbeOutput.textContent = uploadProbeReportText;
    elements.uploadProbeResult.hidden = false;
    elements.uploadProbeResult.open = true;
    setUploadProbeStatus(
      `Resposta capturada: ${capturedReport.responseMessageId} ` +
        `(payload ${capturedReport.javascriptType}).`,
      "success",
    );
  } catch (error) {
    const message = getErrorMessage(error);
    if (/não chegou|took longer than/i.test(message)) {
      setUploadProbeStatus(
        "Timeout: nenhuma resposta correspondente foi capturada.",
        "error",
      );
    } else if (/cancelad[ao]|selecione exatamente/i.test(message)) {
      setUploadProbeStatus("Seleção cancelada; nenhum upload foi iniciado.", "warning");
    } else {
      setUploadProbeStatus(`Falha na sonda: ${message}`, "error");
    }
  } finally {
    uploadProbeRunning = false;
    updateUploadProbeControls(Boolean(obr));
  }
}

async function copyUploadProbeReport() {
  if (!uploadProbeReportText) {
    setUploadProbeStatus("Execute a sonda antes de copiar o relatório.", "warning");
    return;
  }

  try {
    await writeTextToClipboard(uploadProbeReportText);
    setUploadProbeStatus("Relatório completo copiado para a área de transferência.", "success");
  } catch (error) {
    setUploadProbeStatus(
      `Não foi possível copiar o relatório: ${getErrorMessage(error)}`,
      "error",
    );
  }
}

function setDataUrlProbeStatus(text, tone = "neutral") {
  elements.dataUrlProbeStatus.textContent = text;
  elements.dataUrlProbeStatus.dataset.tone = tone;
}

function updateDataUrlProbeControls(isConnected = Boolean(obr)) {
  elements.dataUrlProbeTestButton.disabled = dataUrlProbeRunning || !isConnected;
  elements.dataUrlProbeCopyButton.disabled =
    dataUrlProbeRunning || !dataUrlProbeReportText;
}

function showDataUrlProbeReport(report) {
  dataUrlProbeReportText = formatDataUrlImageProbeReport(report);
  elements.dataUrlProbeOutput.textContent = dataUrlProbeReportText;
  elements.dataUrlProbeResult.hidden = false;
  elements.dataUrlProbeResult.open = true;
}

async function runDataUrlProbeFromPanel() {
  if (!obr || !buildImage) {
    setDataUrlProbeStatus(
      "Sonda indisponível: o painel não está conectado ao Owlbear.",
      "error",
    );
    return;
  }

  dataUrlProbeRunning = true;
  dataUrlProbeReportText = "";
  elements.dataUrlProbeOutput.textContent = "";
  elements.dataUrlProbeResult.hidden = true;
  setDataUrlProbeStatus("Selecione uma imagem pequena em PNG, JPEG ou WebP…", "neutral");
  updateDataUrlProbeControls(true);

  try {
    const report = await runDataUrlImageProbe(obr, buildImage, {
      getPosition: getViewportCenter,
      onFileSelected() {
        setDataUrlProbeStatus("Lendo o arquivo e obtendo suas dimensões…", "neutral");
      },
      onPrepared() {
        setDataUrlProbeStatus(
          "Criando um Image item com a data URL e aguardando addItems…",
          "neutral",
        );
      },
    });
    showDataUrlProbeReport(report);
    setDataUrlProbeStatus(
      "Item de teste criado. Verifique a imagem agora e novamente após recarregar o Owlbear.",
      "success",
    );
  } catch (error) {
    const report = error?.diagnosticReport;
    if (report) {
      showDataUrlProbeReport(report);
      setDataUrlProbeStatus(
        `${report.error?.name || "Erro"}: ${report.error?.message || getErrorMessage(error)}`,
        "error",
      );
    } else {
      const message = getErrorMessage(error);
      if (/cancelad[ao]|selecione exatamente/i.test(message)) {
        setDataUrlProbeStatus("Seleção cancelada; nenhum item foi criado.", "warning");
      } else {
        setDataUrlProbeStatus(`Falha na sonda de data URL: ${message}`, "error");
      }
    }
  } finally {
    dataUrlProbeRunning = false;
    updateDataUrlProbeControls(Boolean(obr));
  }
}

async function copyDataUrlProbeReport() {
  if (!dataUrlProbeReportText) {
    setDataUrlProbeStatus("Execute a sonda antes de copiar o relatório.", "warning");
    return;
  }

  try {
    await writeTextToClipboard(dataUrlProbeReportText);
    setDataUrlProbeStatus("Relatório de data URL copiado para a área de transferência.", "success");
  } catch (error) {
    setDataUrlProbeStatus(
      `Não foi possível copiar o relatório: ${getErrorMessage(error)}`,
      "error",
    );
  }
}

function setHttpsStorageProbeStatus(text, tone = "neutral") {
  elements.httpsStorageProbeStatus.textContent = text;
  elements.httpsStorageProbeStatus.dataset.tone = tone;
}

function updateHttpsStorageProbeControls(isConnected = Boolean(obr)) {
  const hasGateway = Boolean(elements.httpsStorageGatewayUrl.value.trim());
  const hasUploadToken = elements.httpsStorageUploadToken.value.length >= 32;
  const hasSelectedPack = Boolean(selectedPrivatePack?.assetFiles?.size);
  elements.httpsStorageProbeTestButton.disabled =
    httpsStorageProbeRunning ||
    privatePackRunning ||
    !isConnected ||
    !hasSelectedPack ||
    !hasGateway ||
    !hasUploadToken;
  elements.httpsStorageProbeCopyButton.disabled =
    httpsStorageProbeRunning || !httpsStorageProbeReportText;
}

function showHttpsStorageProbeReport(report) {
  httpsStorageProbeReportText = formatPrivateAssetStorageProbeReport(report);
  elements.httpsStorageProbeOutput.textContent = httpsStorageProbeReportText;
  elements.httpsStorageProbeResult.hidden = false;
  elements.httpsStorageProbeResult.open = true;
}

function setHttpsStorageProgress(event) {
  const messages = {
    selecting: "Escolhendo automaticamente o menor WebP e o menor JPEG e validando SHA-256…",
    checking: "Consultando no gateway quais blobs já existem…",
    uploading: `Enviando somente o ${event.kind || "asset"} que está faltando…`,
    confirming: "Confirmando no gateway os dois objetos armazenados…",
    "verifying-get": `Verificando HTTPS, CORS, MIME, tamanho e SHA-256 do ${event.kind || "asset"}…`,
  };
  setHttpsStorageProbeStatus(messages[event.stage] || "Executando a sonda HTTPS…", "neutral");
}

async function getHttpsStorageProbePositions() {
  const [width, height] = await Promise.all([
    obr.viewport.getWidth(),
    obr.viewport.getHeight(),
  ]);
  return Promise.all([
    obr.viewport.inverseTransformPoint({ x: width * 0.28, y: height * 0.4 }),
    obr.viewport.inverseTransformPoint({ x: width * 0.72, y: height * 0.4 }),
    obr.viewport.inverseTransformPoint({ x: width * 0.5, y: height * 0.72 }),
  ]);
}

async function addHttpsStorageProbeItems(result) {
  const [webpPosition, jpegPosition, cardPosition] =
    await getHttpsStorageProbePositions();
  const positions = [webpPosition, jpegPosition];
  const names = ["[Sonda HTTPS] WebP", "[Sonda HTTPS] JPEG"];

  for (let index = 0; index < result.assets.length; index += 1) {
    const asset = result.assets[index];
    const assetReport = result.report.assets[index];
    try {
      const item = buildImage(
        createImageData(asset.imageContent),
        createGridData(asset.imageContent, 3),
      )
        .name(names[index])
        .description("Sonda temporária de armazenamento HTTPS")
        .layer("PROP")
        .position(positions[index])
        .build();
      await obr.scene.items.addItems([item]);
      assetReport.addItems = "sucesso";
      assetReport.itemId = item.id || null;
    } catch (error) {
      assetReport.addItems = `falha: ${getErrorMessage(error)}`;
      throw error;
    }
  }

  try {
    const card = await addCardToScene({
      name: "[Sonda HTTPS] Carta dupla",
      front: result.assets[0].imageContent,
      back: result.assets[1].imageContent,
      gridWidth: 3,
      layer: "PROP",
      position: cardPosition,
    });
    result.report.doubleSidedCard.addItems = "sucesso";
    result.report.doubleSidedCard.itemId = card.id || null;
  } catch (error) {
    result.report.doubleSidedCard.addItems = `falha: ${getErrorMessage(error)}`;
    throw error;
  }
}

async function runHttpsStorageProbeFromPanel() {
  if (!obr || !buildImage) {
    setHttpsStorageProbeStatus(
      "Sonda indisponível: o painel não está conectado ao Owlbear.",
      "error",
    );
    return;
  }
  if (!selectedPrivatePack?.assetFiles?.size) {
    setHttpsStorageProbeStatus(
      "Selecione novamente o Runtime Private Asset Pack antes do teste.",
      "warning",
    );
    return;
  }

  const gatewayUrl = elements.httpsStorageGatewayUrl.value.trim();
  const uploadToken = elements.httpsStorageUploadToken.value;
  elements.httpsStorageUploadToken.value = "";
  httpsStorageProbeRunning = true;
  httpsStorageProbeReportText = "";
  elements.httpsStorageProbeOutput.textContent = "";
  elements.httpsStorageProbeResult.hidden = true;
  updateHttpsStorageProbeControls(true);
  updatePrivatePackControls(true);

  let result = null;
  try {
    result = await runPrivateAssetStorageProbe({
      selection: selectedPrivatePack,
      gatewayUrl,
      uploadToken,
      onProgress: setHttpsStorageProgress,
    });
    setHttpsStorageProbeStatus(
      "Armazenamento confirmado. Criando dois itens IMAGE e uma carta dupla na cena…",
      "neutral",
    );
    await addHttpsStorageProbeItems(result);
    result.report.success = true;
    result.report.completedAt = new Date().toISOString();
    showHttpsStorageProbeReport(result.report);
    setHttpsStorageProbeStatus(
      "Sonda concluída: dois itens e uma carta dupla foram criados. Copie o relatório.",
      "success",
    );
  } catch (error) {
    const report = error?.diagnosticReport || result?.report;
    if (report) {
      report.success = false;
      report.completedAt = new Date().toISOString();
      report.error ||= {
        name: error?.name || "Error",
        message: getErrorMessage(error),
      };
      showHttpsStorageProbeReport(report);
    }
    setHttpsStorageProbeStatus(`Falha na sonda HTTPS: ${getErrorMessage(error)}`, "error");
  } finally {
    httpsStorageProbeRunning = false;
    updatePrivatePackControls(Boolean(obr));
    updateHttpsStorageProbeControls(Boolean(obr));
  }
}

async function copyHttpsStorageProbeReport() {
  if (!httpsStorageProbeReportText) {
    setHttpsStorageProbeStatus("Execute a sonda HTTPS antes de copiar o relatório.", "warning");
    return;
  }
  try {
    await writeTextToClipboard(httpsStorageProbeReportText);
    setHttpsStorageProbeStatus(
      "Relatório de armazenamento HTTPS copiado para a área de transferência.",
      "success",
    );
  } catch (error) {
    setHttpsStorageProbeStatus(
      `Não foi possível copiar o relatório: ${getErrorMessage(error)}`,
      "error",
    );
  }
}

function setConnectionStatus(text, isConnected) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.dataset.connected = String(isConnected);
  if (!isConnected) {
    renderPlayerColorAssignments([]);
  }
  updatePrivatePackControls(isConnected);
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
  updateUploadProbeControls(isConnected);
  updateDataUrlProbeControls(isConnected);
  updateHttpsStorageProbeControls(isConnected);
}

function updatePrivatePackControls(isConnected = Boolean(obr)) {
  const status = getPrivateAssetPackStatus();
  const assetTaskRunning = privatePackRunning || httpsStorageProbeRunning;
  elements.privatePackChooseButton.disabled = assetTaskRunning;
  elements.privatePackUploadButton.disabled =
    assetTaskRunning || !isConnected || !selectedPrivatePack?.assetFiles?.size;
  elements.privatePackLinkButton.disabled =
    assetTaskRunning || !isConnected || !status.configured;
  elements.privatePackClearButton.disabled = assetTaskRunning || !status.configured;
  updateHttpsStorageProbeControls(isConnected);

  if (!status.configured) {
    elements.privatePackInfo.textContent =
      "Core público ativo. Configure um pack privado para habilitar bibliotecas e mapas pessoais.";
    return;
  }

  elements.privatePackInfo.textContent =
    `${status.name || status.id}: ${status.total} assets disponíveis, ` +
    `${formatRuntimeSize(status.runtimeSize)}; ${status.linked} assets vinculados neste navegador.`;
}

function formatPrivateAssetIds(assetIds) {
  return assetIds.join(", ");
}

function requirePrivateDependencies(value, actionLabel) {
  const resolution = resolveAssetReferences(value);
  if (resolution.unresolved) {
    const count = resolution.unresolved;
    throw new Error(
      `Não é possível ${actionLabel}: ${count} ${count === 1 ? "asset privado necessário não está acessível" : "assets privados necessários não estão acessíveis"} ` +
        `como vínculo no Owlbear. Use “Vincular manualmente” e selecione ${count === 1 ? "este asset" : "estes assets"}: ` +
        formatPrivateAssetIds(resolution.unresolvedIds),
    );
  }

  return resolution;
}

async function showNotification(text, tone) {
  if (!obr?.notification?.show) {
    return;
  }

  try {
    if (tone) {
      await obr.notification.show(text, tone);
    } else {
      await obr.notification.show(text);
    }
  } catch (error) {
    console.warn("Nao consegui exibir a notificacao do Owlbear", error);
  }
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
      item.textContent = "Não consegui ler os jogadores.";
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

function formatRuntimeSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MiB";
  }
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} MiB`;
}

function updateDefaultBoardControls(isConnected = Boolean(obr)) {
  const entriesById = new Map(scenePresetEntries.map((entry) => [entry.definition.id, entry]));

  for (const button of elements.developmentSaveSceneButtons) {
    button.hidden = true;
    button.disabled = true;
  }

  for (const button of elements.createScenePresetButtons) {
    const entry = entriesById.get(button.dataset.createScenePreset);
    button.disabled =
      sceneCreationRunning || !isConnected || !entry?.ready || !(entry?.preset || entry?.summary);
  }

  if (!scenePresetEntries.length) {
    elements.defaultBoardInfo.textContent = "Carregando templates privados...";
    return;
  }

  const loadError = scenePresetEntries.find((entry) => entry.loadError)?.loadError;
  if (loadError) {
    elements.defaultBoardInfo.textContent = loadError;
    return;
  }

  const parts = scenePresetEntries.map(
    ({ definition, preset, ready, summary, unresolvedAssetIds }) => {
      const details = preset || summary;
      const displayName = definition.label || definition.name;
      if (!details) {
        return `${displayName}: não cadastrado`;
      }
      if (!ready) {
        const count = unresolvedAssetIds?.length || 0;
        return (
          `${displayName}: criação automática indisponível; ${count} ` +
          `${count === 1 ? "asset precisa" : "assets precisam"} ser ` +
          `vinculado${count === 1 ? "" : "s"} manualmente no Owlbear`
        );
      }

      const itemLabel = details.itemCount === 1 ? "1 item" : `${details.itemCount} itens`;
      const environment = details.grid || details.fog ? "grid/fog capturados" : "grid/fog legado";
      return `${displayName}: ${itemLabel}, salvo em ${formatPresetDate(details.savedAt)}, ${environment}`;
    },
  );

  elements.defaultBoardInfo.textContent =
    "A criação automática depende de todos os assets da cena estarem acessíveis pelo Owlbear. " +
    parts.join(" | ");
}

async function refreshDefaultBoardInfo() {
  scenePresetEntries = await loadScenePresetEntries();
  updateDefaultBoardControls(Boolean(obr));
}

async function rememberSelection(selection) {
  if (!obr || !selection?.length) {
    return;
  }

  const selectedItems = await obr.scene.items.getItems(selection);
  const cardIds = getDoubleSidedCards(selectedItems).map((item) => item.id);
  const deckIds = getDeckItems(selectedItems).map((item) => item.id);

  if (cardIds.length) {
    lastCardSelection = cardIds;
    lastFlipSelection = cardIds;
  }

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
  await rememberSelection(selection);
}

async function showPanelActionResult(count, singular, plural, warning) {
  if (!count) {
    setMessage(warning, "warning");
    await showNotification(warning, "WARNING");
    return;
  }

  const message = count === 1 ? singular : plural(count);
  setMessage(message, "success");
  await showNotification(message, "SUCCESS");
}

async function runPanelAction(button, action, pendingMessage = "") {
  if (!obr) {
    setMessage("Abra esta extensão dentro do Owlbear para usar os comandos.", "warning");
    return;
  }

  button.disabled = true;
  if (pendingMessage) {
    setMessage(pendingMessage, "neutral");
  }
  try {
    await refreshPanelSelectionMemory();
    await action();
  } catch (error) {
    console.error(error);
    setMessage(getErrorMessage(error, "Não consegui executar a ação."), "error");
  } finally {
    button.disabled = false;
  }
}

function getSelectLabel(select) {
  return select.selectedOptions?.[0]?.textContent || select.options?.[0]?.textContent || "Escolha uma opção";
}

function getSelectFieldLabel(select) {
  return select.closest("label")?.querySelector("span")?.textContent?.trim() || "";
}

function getEnabledCustomSelectOptions(state) {
  return [...state.menu.querySelectorAll(".custom-select__option:not(:disabled)")];
}

function focusCustomSelectOption(select, direction = 1) {
  const state = customSelects.get(select);
  if (!state) {
    return;
  }

  const options = [...state.menu.querySelectorAll(".custom-select__option")];
  const selectedIndex = [...select.options].findIndex((option) => option.selected);
  const selectedItem = options[selectedIndex];
  const enabledOptions = getEnabledCustomSelectOptions(state);
  const target =
    (selectedItem && !selectedItem.disabled && selectedItem) ||
    (direction < 0 ? enabledOptions.at(-1) : enabledOptions[0]);
  target?.focus();
}

function moveCustomSelectFocus(select, currentItem, direction) {
  const state = customSelects.get(select);
  if (!state) {
    return;
  }

  const options = getEnabledCustomSelectOptions(state);
  const currentIndex = options.indexOf(currentItem);
  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), options.length - 1);
  options[nextIndex]?.focus();
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
      state.button.focus();
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        item.click();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeCustomSelect(select);
        state.button.focus();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveCustomSelectFocus(select, item, event.key === "ArrowDown" ? 1 : -1);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const enabledOptions = getEnabledCustomSelectOptions(state);
        (event.key === "Home" ? enabledOptions[0] : enabledOptions.at(-1))?.focus();
      }
    });
    state.menu.append(item);
  }
}

function openCustomSelect(select, focusOption = false, direction = 1) {
  const state = customSelects.get(select);

  if (!state || select.disabled) {
    return;
  }

  closeOtherCustomSelects(select);
  buildCustomSelectMenu(select);
  state.root.dataset.open = "true";
  state.menu.hidden = false;
  state.button.setAttribute("aria-expanded", "true");
  if (focusOption) {
    focusCustomSelectOption(select, direction);
  }
}

function syncCustomSelect(select) {
  const state = customSelects.get(select);

  if (!state) {
    return;
  }

  const selectedLabel = getSelectLabel(select);
  state.button.textContent = selectedLabel;
  state.button.setAttribute(
    "aria-label",
    state.fieldLabel ? `${state.fieldLabel}: ${selectedLabel}` : selectedLabel,
  );
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
  menu.id = `${select.id || `select-${customSelects.size + 1}`}-menu`;
  const fieldLabel = getSelectFieldLabel(select);
  if (fieldLabel) {
    menu.setAttribute("aria-label", fieldLabel);
  }
  button.setAttribute("aria-controls", menu.id);

  root.append(button, menu);
  select.after(root);

  const observer = new MutationObserver(() => syncCustomSelect(select));
  observer.observe(select, {
    attributes: true,
    attributeFilter: ["disabled"],
    childList: true,
    subtree: true,
  });

  customSelects.set(select, { button, fieldLabel, menu, observer, root });

  button.addEventListener("click", (event) => {
    event.stopPropagation();

    if (root.dataset.open === "true") {
      closeCustomSelect(select);
      return;
    }

    openCustomSelect(select, event.detail === 0);
  });

  button.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCustomSelect(select);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (root.dataset.open === "true") {
        closeCustomSelect(select);
      } else {
        openCustomSelect(select, true);
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openCustomSelect(select, true, event.key === "ArrowDown" ? 1 : -1);
    }
  });

  root.addEventListener("focusout", () => {
    window.requestAnimationFrame(() => {
      if (!root.contains(document.activeElement)) {
        closeCustomSelect(select);
      }
    });
  });

  select.addEventListener("change", () => syncCustomSelect(select));
  syncCustomSelect(select);
}

function enhancePanelSelects() {
  for (const select of document.querySelectorAll("select")) {
    enhanceCustomSelect(select);
  }

  document.addEventListener("click", (event) => {
    for (const [select, { root }] of customSelects.entries()) {
      if (!root.contains(event.target)) {
        closeCustomSelect(select);
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

  if (stats.assets) {
    parts.push(
      stats.assets === 1
        ? "1 referência de asset migrada"
        : `${stats.assets} referências de assets migradas`,
    );
  }

  return `Cena sincronizada: ${parts.join(", ")}.`;
}

async function repairSceneMetadata() {
  const items = await obr.scene.items.getItems();
  const repairableItems = [];
  const stats = { cards: 0, decks: 0, assets: 0 };

  for (const item of items) {
    const resolution = resolveAssetReferences(item);
    const resolvedItem = resolution.value;
    const card = normalizeCardMetadata(getCardMetadata(resolvedItem), { item: resolvedItem });

    if (card.ok) {
      repairableItems.push(item);
      stats.cards += 1;
      stats.assets += resolution.resolved;
      continue;
    }

    const deck = normalizeDeckMetadata(getDeckMetadata(resolvedItem), { item: resolvedItem });

    if (deck.ok) {
      repairableItems.push(item);
      stats.decks += 1;
      stats.assets += resolution.resolved;
      continue;
    }

    if (resolution.resolved) {
      repairableItems.push(item);
      stats.assets += resolution.resolved;
    }
  }

  if (repairableItems.length) {
    await obr.scene.items.updateItems(repairableItems, (draftItems) => {
      for (const item of draftItems) {
        const resolution = resolveAssetReferences(item);
        Object.assign(item, resolution.value);
        const cardResult = normalizeCardMetadata(getCardMetadata(item), { item });
        const cardMetadata = cardResult.ok ? cardResult.value : null;

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

        const deckResult = normalizeDeckMetadata(getDeckMetadata(item), { item });
        const deckMetadata = deckResult.ok ? deckResult.value : null;

        if (deckMetadata) {
          applyDeckDisplay(item, deckMetadata);
          setDeckMetadata(item, deckMetadata);
        }
      }
    });
  }

  return stats;
}


function getScenePresetEntry(presetId) {
  return scenePresetEntries.find((entry) => entry.definition.id === presetId) || null;
}

async function createDefaultBoardFromCurrentScene(presetId) {
  if (!obr) {
    setMessage("Abra esta extensão dentro do Owlbear para criar o mapa salvo.", "warning");
    return;
  }

  const definition = SCENE_PRESETS.find((preset) => preset.id === presetId);
  const confirmed = window.confirm(
    `Salvar "${definition?.label || definition?.name || "mapa salvo"}" vai substituir esse backup pelo estado atual da cena. Continuar?`,
  );

  if (!confirmed) {
    return;
  }

  setMessage("Salvando o mapa...", "neutral");
  const result = await saveScenePreset(obr, presetId);
  const entry = getScenePresetEntry(presetId);
  if (entry) {
    entry.summary = {
      itemCount: result.itemCount,
      savedAt: result.savedAt,
    };
    entry.preset = null;
    updateDefaultBoardControls(true);
  }

  const itemLabel = result.itemCount === 1 ? "1 item" : `${result.itemCount} itens`;
  const message = `${definition?.label || definition?.name || "Mapa salvo"} criado com ${itemLabel}.`;
  setMessage(message, "success");
  await showNotification("Mapa salvo criado.", "SUCCESS");
}

async function createSceneFromPrivatePreset(presetId) {
  if (!obr || !buildSceneUpload) {
    setMessage("Abra esta extensão dentro do Owlbear para criar a cena.", "warning");
    return;
  }
  if (sceneCreationRunning) {
    setMessage("Já existe uma criação de cena em andamento neste painel.", "warning");
    return;
  }

  const entry = getScenePresetEntry(presetId);
  if (!entry?.preset) {
    setMessage("Esse template privado não está configurado no pack.", "warning");
    return;
  }

  sceneCreationRunning = true;
  updateDefaultBoardControls(true);
  setMessage("Montando a nova cena com os assets vinculados...", "neutral");
  try {
    const displayName = entry.definition.label || entry.definition.name;
    requirePrivateDependencies(entry.preset, `criar ${displayName}`);
    const result = await createPrivateScene(obr, buildSceneUpload, entry.preset);
    const fallback = result.usedCapturedGrid && result.usedCapturedFog
      ? ""
      : " O template legado usou o fallback do SDK para grid/fog ausentes.";
    setMessage(
      `${displayName} criado com ${result.itemCount} itens e enviado ao Atlas.${fallback}`,
      fallback ? "warning" : "success",
    );
    await showNotification(`${displayName} criado no Atlas.`, "SUCCESS");
  } finally {
    sceneCreationRunning = false;
    updateDefaultBoardControls(Boolean(obr));
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

function updateMissionDeckControls(isConnected = Boolean(obr)) {
  elements.createMissionDeckButton.disabled = !isConnected;
  elements.missionDeckInfo.textContent =
    "Selecione exatamente 5 cartas sacadas para unir em uma pilha temporária.";
}

function updatePresetDeckControls(isConnected = Boolean(obr), syncDefaults = false) {
  const hasDecks = presetDecks.length > 0;
  const deck = hasDecks ? getSelectedPresetDeck() : null;
  const isReady = isPresetDeckConfigured(deck);

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
      "Esta pilha já existe no catálogo, mas ainda precisa de verso e cartas.";
    return;
  }

  const count = deck.cards.length;
  elements.presetDeckInfo.textContent =
    count === 1
      ? `1 carta cadastrada. Padrão: ${deck.gridWidth} no grid.`
      : `${count} cartas cadastradas. Padrão: ${deck.gridWidth} no grid.`;
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
    option.textContent = isPresetDeckConfigured(deck)
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
  const isReady = isPresetCardConfigured(group, card);

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
      "Este grupo já existe no catálogo, mas ainda precisa de verso e cartas.";
    return;
  }

  if (!isReady) {
    elements.presetCardInfo.textContent =
      "Esta carta ainda precisa de frente e verso no catálogo.";
    return;
  }

  const categoryLabel = group.category
    ? " Marca automática para seleção de personagem."
    : "";
  elements.presetCardInfo.textContent =
    `${group.cards.length} cartas cadastradas. Padrão: ${group.gridWidth} no grid.${categoryLabel}`;
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
    option.textContent = isPresetCardConfigured(group, card)
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

async function reloadPrivateContent() {
  await Promise.all([loadPresetLibrary(), refreshDefaultBoardInfo()]);
  updatePrivatePackControls(Boolean(obr));
}

async function configureSelectedPrivatePack(files) {
  privatePackRunning = true;
  updatePrivatePackControls(Boolean(obr));
  setMessage("Lendo o Private Asset Pack...", "neutral");

  try {
    const imported = await readPrivateAssetPackFiles(files);
    configurePrivateAssetPack(imported);
    selectedPrivatePack = imported;
    await reloadPrivateContent();
    const missingFiles = imported.pack
      ? Object.keys(imported.pack.assets).length - imported.assetFiles.size
      : 0;
    setMessage(
      missingFiles
        ? `Pack configurado, mas ${missingFiles} arquivos canônicos não estavam na pasta selecionada.`
        : "Pack configurado. O upload e o vínculo manual no Owlbear são recursos opcionais.",
      missingFiles ? "warning" : "success",
    );
  } finally {
    privatePackRunning = false;
    elements.privatePackInput.value = "";
    updatePrivatePackControls(Boolean(obr));
  }
}

async function uploadSelectedPrivatePack() {
  if (!obr || !buildImageUpload || !selectedPrivatePack) {
    throw new Error("Selecione o Private Asset Pack antes de enviar os assets.");
  }

  const confirmed = window.confirm(
    `Enviar ${selectedPrivatePack.assetFiles.size} assets canônicos para a biblioteca privada do Owlbear?`,
  );
  if (!confirmed) {
    setMessage(
      `Envio cancelado pelo usuário antes de iniciar: 0 de ${selectedPrivatePack.assetFiles.size} assets processados.`,
      "warning",
    );
    return { cancelled: true };
  }

  privatePackRunning = true;
  updatePrivatePackControls(true);
  try {
    const result = await uploadPrivateAssetPack(
      obr,
      buildImageUpload,
      selectedPrivatePack,
      ({ stage, processed, total, groupSize, assetId, assetName }) => {
        if (stage === "preparing") {
          setMessage(
            `Preparando arquivos para o Owlbear: ${processed} de ${total}. ` +
              `${assetName || "Asset sem nome"}${assetId ? ` (${assetId})` : ""}.`,
            "neutral",
          );
          return;
        }
        if (stage === "uploading") {
          setMessage(
            `Enviando à API do Owlbear: ${processed} de ${total} uploads confirmados; ` +
              `aguardando a operação com ${groupSize} assets.`,
            "neutral",
          );
          return;
        }
        setMessage(`Envio confirmado pelo Owlbear: ${processed} de ${total} assets.`, "neutral");
      },
    );
    setMessage(
      `${result.uploaded} assets enviados ao Owlbear. Para usar um asset privado, vincule-o manualmente quando desejar.`,
      result.missingFiles ? "warning" : "success",
    );
  } finally {
    privatePackRunning = false;
    updatePrivatePackControls(Boolean(obr));
  }
}

async function linkConfiguredPrivatePack() {
  if (!obr) {
    throw new Error("Abra a extensão dentro do Owlbear para vincular os assets.");
  }

  privatePackRunning = true;
  updatePrivatePackControls(true);
  setMessage("Selecione no Owlbear os assets do pack que deseja vincular...", "neutral");
  try {
    const result = await linkPrivateAssetPackFromOwlbear(obr);
    await reloadPrivateContent();
    const packStatus = getPrivateAssetPackStatus();
    const stats = await repairSceneMetadata();
    const suffix = stats.assets
      ? ` ${stats.assets} referências da cena atual foram migradas.`
      : "";
    setMessage(
      result.linked
        ? `${result.linked} assets reconhecidos nesta seleção; ${packStatus.linked} vinculados neste navegador. ` +
          `${result.unmatched.length} selecionados não corresponderam ao pack.${suffix}`
        : `Nenhum dos ${result.selected} assets selecionados correspondeu ao manifesto; os ${packStatus.linked} vínculos anteriores foram preservados.`,
      result.linked ? (result.unmatched.length ? "warning" : "success") : "warning",
    );
  } finally {
    privatePackRunning = false;
    updatePrivatePackControls(Boolean(obr));
  }
}

async function removeConfiguredPrivatePack() {
  if (!window.confirm("Remover deste navegador a configuração e os vínculos do pack privado?")) {
    return;
  }

  clearPrivateAssetPack();
  selectedPrivatePack = null;
  await reloadPrivateContent();
  setMessage("Configuração local do Private Asset Pack removida. O Core público continua ativo.", "success");
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

async function createMissionDeck() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensão dentro do Owlbear Rodeo para criar a pilha.", "warning");
    return;
  }

  elements.createMissionDeckButton.disabled = true;
  setMessage("Criando pilha de missão...", "neutral");

  try {
    const deck = await createMissionDeckFromSelection(obr, buildImage);

    if (deck?.id) {
      await obr.player.select([deck.id], true);
      lastDeckSelection = [deck.id];
      lastFlipSelection = [deck.id];
    }
    lastCardSelection = [];
    setMessage("Pilha de missão criada com 5 cartas selecionadas.", "success");
    await showNotification("Pilha de missão criada.", "SUCCESS");
  } catch (error) {
    console.error(error);
    setMessage(getErrorMessage(error, "Não consegui criar a pilha de missão."), "error");
  } finally {
    updateMissionDeckControls(Boolean(obr));
  }
}

async function createPresetDeck() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensão dentro do Owlbear Rodeo para criar uma pilha.", "warning");
    return;
  }

  const deck = getSelectedPresetDeck();
  if (!deck) {
    setMessage("Escolha uma pilha da biblioteca.", "warning");
    return;
  }

  if (!isPresetDeckConfigured(deck)) {
    setMessage("Esta pilha ainda precisa de verso e cartas no catálogo.", "warning");
    return;
  }

  elements.importPresetDeckButton.disabled = true;
  setMessage("Criando pilha da biblioteca...", "neutral");

  try {
    requirePrivateDependencies(deck, `criar a pilha "${deck.name}"`);
    const deckData = await buildPresetDeckData(deck);
    const gridWidth = getPresetDeckGridWidth();
    await addDeckToScene({
      ...deckData,
      gridWidth,
      layer: elements.presetDeckLayer.value || deckData.layer,
    });
    setMessage(`Pilha "${deckData.name}" criada da biblioteca.`, "success");
    await showNotification(`Pilha "${deckData.name}" criada.`);
  } catch (error) {
    console.error(error);
    setMessage(getErrorMessage(error, "Não consegui criar a pilha da biblioteca."), "error");
  } finally {
    updatePresetDeckControls(Boolean(obr));
  }
}

async function createPresetCard() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensão dentro do Owlbear Rodeo para criar uma carta.", "warning");
    return;
  }

  const { group, card } = getSelectedPresetCard();
  if (!group || !card) {
    setMessage("Escolha uma carta da biblioteca.", "warning");
    return;
  }

  if (!isPresetCardConfigured(group, card)) {
    setMessage("Esta carta ainda precisa de frente e verso no catálogo.", "warning");
    return;
  }

  elements.importPresetCardButton.disabled = true;
  setMessage("Criando carta da biblioteca...", "neutral");

  try {
    const back = card.back?.assetId || card.back?.path ? card.back : group.back;
    requirePrivateDependencies(
      { front: card.front, back },
      `criar a carta "${card.name}"`,
    );
    const cardData = await buildPresetCardData(group, card);
    const gridWidth = getPresetCardGridWidth();
    await addCardToScene({
      ...cardData,
      gridWidth,
      layer: elements.presetCardLayer.value || cardData.layer,
      origin: cardData.origin,
    });
    setMessage(`Carta "${cardData.name}" criada da biblioteca.`, "success");
    await showNotification(`Carta "${cardData.name}" criada.`);
  } catch (error) {
    console.error(error);
    setMessage(getErrorMessage(error, "Não consegui criar a carta da biblioteca."), "error");
  } finally {
    updatePresetCardControls(Boolean(obr));
  }
}

async function init() {
  enhancePanelSelects();

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
      setMessage(getErrorMessage(error, "Não consegui criar a pilha da biblioteca."), "error");
    }),
  );
  elements.importPresetCardButton.addEventListener("click", () =>
    createPresetCard().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui criar a carta da biblioteca."), "error");
    }),
  );
  elements.createMissionDeckButton.addEventListener("click", () =>
    createMissionDeck().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui criar a pilha de missão."), "error");
    }),
  );
  loadPresetLibrary().catch((error) => {
    console.warn(error);
    presetDecks = [];
    presetCardGroups = [];
    populatePresetDeckSelect();
    populatePresetCardGroupSelect();
    elements.presetDeckInfo.textContent =
      getErrorMessage(error, "Não consegui carregar a biblioteca de pilhas.");
    elements.presetCardInfo.textContent =
      getErrorMessage(error, "Não consegui carregar a biblioteca de cartas.");
  });
  elements.privatePackChooseButton.addEventListener("click", () =>
    elements.privatePackInput.click(),
  );
  elements.privatePackInput.addEventListener("change", () => {
    configureSelectedPrivatePack(elements.privatePackInput.files).catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui configurar o Private Asset Pack."), "error");
    });
  });
  elements.privatePackUploadButton.addEventListener("click", () => {
    uploadSelectedPrivatePack().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui enviar os assets ao Owlbear."), "error");
    });
  });
  elements.privatePackLinkButton.addEventListener("click", () => {
    linkConfiguredPrivatePack().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui vincular os assets do Owlbear."), "error");
    });
  });
  elements.privatePackClearButton.addEventListener("click", () => {
    removeConfiguredPrivatePack().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui remover a configuração do pack."), "error");
    });
  });
  updatePrivatePackControls(false);
  elements.uploadProbeTestButton.addEventListener("click", () => {
    runUploadProbeFromPanel().catch((error) => {
      setUploadProbeStatus(`Falha na sonda: ${getErrorMessage(error)}`, "error");
    });
  });
  elements.uploadProbeCopyButton.addEventListener("click", () => {
    copyUploadProbeReport().catch((error) => {
      setUploadProbeStatus(
        `Não foi possível copiar o relatório: ${getErrorMessage(error)}`,
        "error",
      );
    });
  });
  updateUploadProbeControls(false);
  elements.dataUrlProbeTestButton.addEventListener("click", () => {
    runDataUrlProbeFromPanel().catch((error) => {
      setDataUrlProbeStatus(
        `Falha na sonda de data URL: ${getErrorMessage(error)}`,
        "error",
      );
    });
  });
  elements.dataUrlProbeCopyButton.addEventListener("click", () => {
    copyDataUrlProbeReport().catch((error) => {
      setDataUrlProbeStatus(
        `Não foi possível copiar o relatório: ${getErrorMessage(error)}`,
        "error",
      );
    });
  });
  updateDataUrlProbeControls(false);
  elements.httpsStorageGatewayUrl.addEventListener("input", () =>
    updateHttpsStorageProbeControls(Boolean(obr)),
  );
  elements.httpsStorageUploadToken.addEventListener("input", () =>
    updateHttpsStorageProbeControls(Boolean(obr)),
  );
  elements.httpsStorageProbeTestButton.addEventListener("click", () => {
    runHttpsStorageProbeFromPanel().catch((error) => {
      setHttpsStorageProbeStatus(
        `Falha na sonda HTTPS: ${getErrorMessage(error)}`,
        "error",
      );
    });
  });
  elements.httpsStorageProbeCopyButton.addEventListener("click", () => {
    copyHttpsStorageProbeReport().catch((error) => {
      setHttpsStorageProbeStatus(
        `Não foi possível copiar o relatório: ${getErrorMessage(error)}`,
        "error",
      );
    });
  });
  updateHttpsStorageProbeControls(false);
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
    }, "Virando a seleção..."),
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
    }, "Comprando uma carta..."),
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
    }, "Embaralhando a pilha..."),
  );
  elements.panelReturnButton.addEventListener("click", () =>
    runPanelAction(elements.panelReturnButton, async () => {
      const count = await returnSelectedCardsToDeck(
        obr,
        lastCardSelection,
        lastDeckSelection,
      );
      await showPanelActionResult(
        count,
        "Carta devolvida para a pilha.",
        (total) => `${total} cartas devolvidas para a pilha.`,
        "Selecione uma carta comprada com pilha de origem.",
      );
      if (!count) return;

      lastCardSelection = [];
      lastFlipSelection = lastDeckSelection;
    }, "Devolvendo a carta para a pilha..."),
  );
  elements.returnOriginButton.addEventListener("click", () =>
    runPanelAction(elements.returnOriginButton, async () => {
      await returnSelectedCardToOrigin(obr, lastCardSelection);
      const message = "Carta devolvida para a posição original.";
      setMessage(message, "success");
      await showNotification(message, "SUCCESS");
    }, "Devolvendo a carta para a origem..."),
  );
  elements.panelRepairButton.addEventListener("click", () =>
    runPanelAction(elements.panelRepairButton, async () => {
      const stats = await repairSceneMetadata();
      const total = stats.cards + stats.decks;

      if (!total) {
        const warning = "Não encontrei cartas ou pilhas para sincronizar.";
        setMessage(warning, "warning");
        await showNotification(warning, "WARNING");
        return;
      }

      const message = getRepairMessage(stats);
      setMessage(message, "success");
      await showNotification(message, "SUCCESS");
    }, "Sincronizando a cena..."),
  );
  for (const button of elements.developmentSaveSceneButtons) {
    button.addEventListener("click", () =>
      runPanelAction(button, () => createDefaultBoardFromCurrentScene(button.dataset.saveScenePreset)),
    );
  }
  for (const button of elements.createScenePresetButtons) {
    button.addEventListener("click", () => {
      createSceneFromPrivatePreset(button.dataset.createScenePreset).catch((error) => {
        console.error(error);
        setMessage(getErrorMessage(error, "Não consegui criar a cena no Atlas."), "error");
      });
    });
  }

  setConnectionStatus("Painel carregado; conectando...", false);
  setMessage("Prévia ativa. Conectando ao Owlbear...", "neutral");

  let loaded;
  try {
    loaded =
      (await window.doubleSidedCardsSdkReady) ||
      (await import("./" + "sdk-client.js?v=103").then((sdkModule) =>
        sdkModule.loadOwlbearSdk(20000),
      ));
  } catch (error) {
    console.warn(error);
    setConnectionStatus("Sem conexão ao SDK", false);
    refreshDefaultBoardInfo().catch((presetError) => {
      console.warn("Nao consegui carregar os templates privados", presetError);
      elements.defaultBoardInfo.textContent =
        "Não consegui carregar os templates privados. Reabra o painel para tentar novamente.";
    });
    setMessage(
      `A tela carregou, mas ainda não conectou ao Owlbear: ${getErrorMessage(error)}`,
      "warning",
    );
    setUploadProbeStatus("Sonda indisponível: o painel não conectou ao Owlbear.", "error");
    setDataUrlProbeStatus("Sonda indisponível: o painel não conectou ao Owlbear.", "error");
    setHttpsStorageProbeStatus(
      "Sonda indisponível: o painel não conectou ao Owlbear.",
      "error",
    );
    return;
  }

  obr = loaded.OBR;
  buildImage = loaded.sdk.buildImage;
  buildImageUpload = loaded.sdk.buildImageUpload;
  buildSceneUpload = loaded.sdk.buildSceneUpload;
  window.cartasDuplasProbeUploadImagesResponse = (options) =>
    runPrivateAssetUploadResponseConsoleProbe(obr, buildImageUpload, options);
  console.info(
    "[Cartas Duplas] Sonda disponível: await window.cartasDuplasProbeUploadImagesResponse()",
  );
  setUploadProbeStatus(
    "Pronto. O teste enviará exatamente uma imagem e exibirá a resposta correspondente.",
    "neutral",
  );
  updateUploadProbeControls(true);
  setDataUrlProbeStatus(
    "Pronto. Escolha uma imagem de aproximadamente 100–300 KiB ou menos.",
    "neutral",
  );
  updateDataUrlProbeControls(true);
  setHttpsStorageProbeStatus(
    "Pronto. Selecione o Runtime Pack e informe a URL e a capability do gateway da POC.",
    "neutral",
  );
  updateHttpsStorageProbeControls(true);
  obr.broadcast
    .sendMessage(COMMANDS_CHANNEL, { type: "register-commands" }, { destination: "LOCAL" })
    .catch((error) => {
      console.warn("Nao consegui pedir o registro dos comandos", error);
    });

  const initialResults = await Promise.allSettled([
    obr.player.getSelection().then((selection) => rememberSelection(selection)),
    refreshDefaultBoardInfo(),
    refreshPlayerColorAssignments(),
  ]);
  const initialFailures = initialResults.filter((result) => result.status === "rejected");
  for (const failure of initialFailures) {
    console.warn("Nao consegui carregar parte do estado inicial do painel", failure.reason);
  }

  obr.player.onChange((player) => {
    rememberSelection(player.selection).catch((error) => {
      console.warn("Nao consegui atualizar a selecao do painel", error);
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
  if (initialFailures.length) {
    setMessage(
      "Conectado ao Owlbear, mas parte do estado inicial não pôde ser carregada. Reabra o painel se alguma seção não atualizar.",
      "warning",
    );
  } else {
    setMessage("", "neutral");
  }
}

init();
