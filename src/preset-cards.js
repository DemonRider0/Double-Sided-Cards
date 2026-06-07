import { getMimeFromUrl } from "./card-data.js";
import { normalizeCategory } from "./selection-board.js";

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

export async function loadPresetCardGroups() {
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

export function isPresetCardReady(group, card) {
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

export async function buildPresetCardData(group, card) {
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
