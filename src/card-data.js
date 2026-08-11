export const EXTENSION_ID = "br.demonrider.double-sided-cards";
export const REGISTRATION_ID = EXTENSION_ID;
export const METADATA_KEY = `${EXTENSION_ID}/card`;
export const DECK_METADATA_KEY = `${EXTENSION_ID}/deck`;
export const COMMANDS_CHANNEL = `${REGISTRATION_ID}/commands`;

const CARD_CATEGORY_METADATA_KEY = `${EXTENSION_ID}/card-category`;
const CARD_CATEGORY_GRID_WIDTHS = new Map([
  ["class", 3],
  ["race", 3],
  ["divinity", 2],
]);
const VALID_FACES = new Set(["front", "back"]);

function isObject(value) {
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

export function cloneMetadataValue(value) {
  return cloneSerializableValue(value, new WeakSet());
}

export function metadataValuesEqual(left, right) {
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

export function imageUrlsMatch(left, right) {
  const leftUrl = comparableUrl(left);
  const rightUrl = comparableUrl(right);
  return Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
}

function positiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}

export function isCardMetadata(value) {
  return Boolean(isObject(value) && value.version === 1);
}

export function isDeckMetadata(value) {
  return Boolean(isObject(value) && value.version === 1);
}

export function getCardMetadata(item) {
  const metadata = item.metadata?.[METADATA_KEY];
  return isCardMetadata(metadata) ? metadata : null;
}

export function getDeckMetadata(item) {
  const metadata = item.metadata?.[DECK_METADATA_KEY];
  return isDeckMetadata(metadata) ? metadata : null;
}

export function normalizeImageData(value, options = {}) {
  if (!isObject(value) || typeof value.url !== "string" || !value.url.trim()) {
    return validationFailure("invalid-image-url", "A imagem nao possui uma URL valida.");
  }

  let image;

  try {
    image = cloneMetadataValue(value);
  } catch (error) {
    return validationFailure("invalid-image-data", error.message);
  }

  const fallbackImage =
    isObject(options.fallbackImage) &&
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

export function resolveGridWidth(value, options = {}) {
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

export function normalizeOrigin(value) {
  if (value == null) {
    return validationSuccess(null, { present: false });
  }

  if (!isObject(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
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

export function normalizeCardMetadata(value, options = {}) {
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

  const origin = normalizeOrigin(metadata.origin);

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

export function normalizeDeckCardEntry(value, options = {}) {
  if (!isObject(value)) {
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

  const origin = normalizeOrigin(card.origin);

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

export function normalizeDeckMetadata(value, options = {}) {
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

export function setCardMetadata(item, metadata) {
  item.metadata ||= {};
  item.metadata[METADATA_KEY] = metadata;
}

export function setDeckMetadata(item, metadata) {
  item.metadata ||= {};
  item.metadata[DECK_METADATA_KEY] = metadata;
}

export function createCardMetadataMap(metadata) {
  return {
    [METADATA_KEY]: metadata,
  };
}

export function createDeckMetadataMap(metadata) {
  return {
    [DECK_METADATA_KEY]: metadata,
  };
}

export function nextFace(currentFace) {
  return currentFace === "front" ? "back" : "front";
}

export function faceLabel(face) {
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

export function shouldMirrorBackFace(front, back) {
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

export function shouldMirrorCardBack(metadata) {
  if (!metadata?.faces) {
    return false;
  }

  return typeof metadata.mirrorBack === "boolean"
    ? metadata.mirrorBack
    : shouldMirrorBackFace(metadata.faces.front, metadata.faces.back);
}

export function applyCardFaceTransform(item, metadata, faceId = metadata?.currentFace) {
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

export function createCardMetadata({
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

export function createDeckMetadata({ name, back, cards, gridWidth, deleteWhenEmpty = false }) {
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

export function deckDescription(count) {
  return count === 1 ? "Pilha: 1 carta" : `Pilha: ${count} cartas`;
}

export function createImageData(face) {
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

export function createGridData(face, gridWidth, origin) {
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

export function getMimeFromUrl(rawUrl) {
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
