import {
  buildPresetFace,
  getPresetNameFromPath,
  normalizePresetAsset,
  normalizePresetLayer,
} from "./preset-assets.js";

const PRESET_DECKS_URL = new URL("../assets/preset-decks/decks.json", import.meta.url);

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

async function buildFace(asset) {
  return buildPresetFace(asset, "A pilha padrao ainda nao tem verso configurado.");
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
