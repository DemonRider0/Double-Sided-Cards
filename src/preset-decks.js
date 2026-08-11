import {
  buildPresetFace,
  getPresetNameFromPath,
  normalizePresetAsset,
  normalizePresetLayer,
  isPresetAssetReady,
} from "./preset-assets.js";
import { getConfiguredPrivateAssetPack } from "./asset-resolver.js";

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

export async function loadPresetDecks(pack = getConfiguredPrivateAssetPack()) {
  const data = pack?.presets?.decks;
  const decks = Array.isArray(data?.decks) ? data.decks : [];

  return decks.map(normalizePresetDeck);
}

export function isPresetDeckReady(deck) {
  return Boolean(
    deck?.cards?.length &&
      isPresetAssetReady(deck.back) &&
      deck.cards.every((card) => isPresetAssetReady(card.front)),
  );
}

async function buildFace(asset) {
  return buildPresetFace(asset, "A pilha padrão ainda não tem verso configurado.");
}

export async function buildPresetDeckData(deck) {
  if (!isPresetDeckReady(deck)) {
    throw new Error(`A pilha "${deck?.name || "padrão"}" ainda não tem cartas configuradas.`);
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
