import { getMimeFromUrl } from "./card-data.js";

const PRESET_DECKS_URL = new URL("../assets/preset-decks/decks.json", import.meta.url);
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

function normalizePresetDeck(value, index) {
  const name = value?.name || `Pilha ${index + 1}`;
  const layer = ITEM_LAYERS.has(value?.layer) ? value.layer : "PROP";

  return {
    id: value?.id || `deck-${index + 1}`,
    name,
    gridWidth: Number.isFinite(value?.gridWidth) && value.gridWidth > 0 ? value.gridWidth : 2,
    layer,
    back: normalizeAsset(value?.back, `${name} verso`),
    cards: Array.isArray(value?.cards)
      ? value.cards.map((card, cardIndex) => {
          if (typeof card === "string") {
            return {
              name: getNameFromPath(card, `Carta ${cardIndex + 1}`),
              front: normalizeAsset(card, `Carta ${cardIndex + 1}`),
            };
          }

          return {
            name: card?.name || `Carta ${cardIndex + 1}`,
            front: normalizeAsset(card?.front || card?.path || card?.url, `Carta ${cardIndex + 1}`),
          };
        })
      : [],
  };
}

export async function loadPresetDecks() {
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

export function isPresetDeckReady(deck) {
  return Boolean(deck?.back?.path && deck.cards?.length);
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

async function buildFace(asset) {
  const url = resolveAssetUrl(asset.path);

  if (!url) {
    throw new Error("A pilha padrao ainda nao tem verso configurado.");
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

export async function buildPresetDeckData(deck) {
  if (!isPresetDeckReady(deck)) {
    throw new Error(`A pilha "${deck?.name || "padrao"}" ainda nao tem cartas configuradas.`);
  }

  const [back, cards] = await Promise.all([
    buildFace(deck.back),
    Promise.all(
      deck.cards.map(async (card, index) => ({
        name: card.name || `Carta ${index + 1}`,
        front: await buildFace(card.front),
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
