export const EXTENSION_ID = "br.demonrider.double-sided-cards";
export const LEGACY_EXTENSION_ID = [
  "br",
  String.fromCharCode(99, 111, 100, 101, 120),
  "double-sided-cards",
].join(".");
export const METADATA_KEY = `${EXTENSION_ID}/card`;
export const DECK_METADATA_KEY = `${EXTENSION_ID}/deck`;
export const LEGACY_METADATA_KEY = `${LEGACY_EXTENSION_ID}/card`;
export const LEGACY_DECK_METADATA_KEY = `${LEGACY_EXTENSION_ID}/deck`;
export const COMMANDS_CHANNEL = `${EXTENSION_ID}/commands`;

export function isCardMetadata(value) {
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

export function isDeckMetadata(value) {
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

export function getCardMetadata(item) {
  const metadata = item.metadata?.[METADATA_KEY];
  if (isCardMetadata(metadata)) {
    return metadata;
  }

  const legacyMetadata = item.metadata?.[LEGACY_METADATA_KEY];
  return isCardMetadata(legacyMetadata) ? legacyMetadata : null;
}

export function getDeckMetadata(item) {
  const metadata = item.metadata?.[DECK_METADATA_KEY];
  if (isDeckMetadata(metadata)) {
    return metadata;
  }

  const legacyMetadata = item.metadata?.[LEGACY_DECK_METADATA_KEY];
  return isDeckMetadata(legacyMetadata) ? legacyMetadata : null;
}

export function setCardMetadata(item, metadata) {
  item.metadata ||= {};
  item.metadata[METADATA_KEY] = metadata;
  item.metadata[LEGACY_METADATA_KEY] = metadata;
}

export function setDeckMetadata(item, metadata) {
  item.metadata ||= {};
  item.metadata[DECK_METADATA_KEY] = metadata;
  item.metadata[LEGACY_DECK_METADATA_KEY] = metadata;
}

export function createCardMetadataMap(metadata) {
  return {
    [METADATA_KEY]: metadata,
    [LEGACY_METADATA_KEY]: metadata,
  };
}

export function createDeckMetadataMap(metadata) {
  return {
    [DECK_METADATA_KEY]: metadata,
    [LEGACY_DECK_METADATA_KEY]: metadata,
  };
}

export function nextFace(currentFace) {
  return currentFace === "front" ? "back" : "front";
}

export function faceLabel(face) {
  return face === "front" ? "frente" : "verso";
}

export function createCardMetadata({
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

export function createDeckMetadata({ name, back, cards, gridWidth }) {
  return {
    version: 1,
    name,
    back,
    cards,
    gridWidth,
  };
}

export function deckDescription(count) {
  return count === 1 ? "Pilha: 1 carta" : `Pilha: ${count} cartas`;
}

export function createImageData(face) {
  return {
    url: face.url,
    width: face.width,
    height: face.height,
    mime: face.mime,
  };
}

export function createGridData(face, gridWidth) {
  const dpi = Math.max(1, face.width / gridWidth);

  return {
    dpi,
    offset: {
      x: face.width / 2,
      y: face.height / 2,
    },
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
