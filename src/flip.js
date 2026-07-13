import {
  applyCardFaceTransform,
  createGridData,
  createImageData,
  faceLabel,
  getCardMetadata,
  getDeckMetadata,
  isCardMetadata,
  nextFace,
  setCardMetadata,
  shouldMirrorBackFace,
} from "./card-data.js";
import { flipDeckItems, getDeckItems } from "./deck.js";
import { applyDivinitySizing } from "./divinity-sizing.js";

export function getDoubleSidedCards(items) {
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

export async function flipItems(OBR, items) {
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

export async function flipSelectedItems(OBR, fallbackSelection = []) {
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

export async function showFlipResult(OBR, count) {
  if (!count) {
    await OBR.notification.show("Selecione uma carta dupla para virar.", "WARNING");
    return;
  }

  await OBR.notification.show(
    count === 1 ? "Carta virada." : `${count} cartas viradas.`,
    "SUCCESS",
  );
}
