import {
  createGridData,
  createImageData,
  faceLabel,
  getCardMetadata,
  isCardMetadata,
  nextFace,
  setCardMetadata,
} from "./card-data.js";
import { applyDivinitySizing } from "./divinity-sizing.js";

export function getDoubleSidedCards(items) {
  return items.filter((item) => isCardMetadata(getCardMetadata(item)));
}

export async function flipItems(OBR, items) {
  const itemsToFlip = getDoubleSidedCards(items);

  if (!itemsToFlip.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(itemsToFlip, (draftItems) => {
    for (const item of draftItems) {
      const metadata = getCardMetadata(item);
      const targetFace = nextFace(metadata.currentFace);
      const face = metadata.faces[targetFace];

      item.image = createImageData(face);
      item.grid = createGridData(face, metadata.gridWidth);
      applyDivinitySizing(item, face);
      item.description = `Carta dupla: ${faceLabel(targetFace)}`;
      setCardMetadata(item, {
        ...metadata,
        currentFace: targetFace,
      });
    }
  });

  return itemsToFlip.length;
}

export async function flipSelectedItems(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();

  const itemIds = selection?.length ? selection : fallbackSelection;

  if (!itemIds.length) {
    return 0;
  }

  const selectedItems = await OBR.scene.items.getItems(itemIds);
  return flipItems(OBR, selectedItems);
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
