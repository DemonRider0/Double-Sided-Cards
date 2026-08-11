import { normalizeCategory } from "./selection-board.js";
import {
  buildPresetFace,
  getPresetNameFromPath,
  normalizePresetAsset,
  normalizePresetLayer,
  isPresetAssetReady,
} from "./preset-assets.js";
import { getConfiguredPrivateAssetPack } from "./asset-resolver.js";

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

export async function loadPresetCardGroups(pack = getConfiguredPrivateAssetPack()) {
  const data = pack?.presets?.cards;
  const groups = Array.isArray(data?.groups) ? data.groups : [];

  return groups.map(normalizePresetCardGroup);
}

export function isPresetCardReady(group, card) {
  const back = card?.back?.assetId || card?.back?.path ? card.back : group?.back;
  return Boolean(isPresetAssetReady(back) && isPresetAssetReady(card?.front));
}

async function buildFace(asset, label) {
  return buildPresetFace(asset, `A biblioteca ainda não tem ${label} configurado.`);
}

export async function buildPresetCardData(group, card) {
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
