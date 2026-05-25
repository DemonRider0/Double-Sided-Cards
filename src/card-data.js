export const EXTENSION_ID = "br.demonrider.double-sided-cards";
export const METADATA_KEY = `${EXTENSION_ID}/card`;
export const DECK_METADATA_KEY = `${EXTENSION_ID}/deck`;
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
  return isCardMetadata(metadata) ? metadata : null;
}

export function getDeckMetadata(item) {
  const metadata = item.metadata?.[DECK_METADATA_KEY];
  return isDeckMetadata(metadata) ? metadata : null;
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
    currentFace: "back",
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
