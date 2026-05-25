import {
  applyCardFaceTransform,
  createCardMetadata,
  createCardMetadataMap,
  createGridData,
  createImageData,
  deckDescription,
  faceLabel,
  getCardMetadata,
  getDeckMetadata,
  isCardMetadata,
  isDeckMetadata,
  setCardMetadata,
  setDeckMetadata,
} from "./card-data.js";

export function getDeckItems(items) {
  return items.filter((item) => isDeckMetadata(getDeckMetadata(item)));
}

export function getCardItems(items) {
  return items.filter((item) => isCardMetadata(getCardMetadata(item)));
}

export function createDeckText(count) {
  const text = String(count);

  return {
    richText: [
      {
        type: "paragraph",
        children: [{ text }],
      },
    ],
    plainText: text,
    style: {
      padding: 8,
      fontFamily: "Roboto",
      fontSize: 36,
      fontWeight: 800,
      textAlign: "CENTER",
      textAlignVertical: "MIDDLE",
      fillColor: "white",
      fillOpacity: 1,
      strokeColor: "black",
      strokeOpacity: 0.85,
      strokeWidth: 3,
      lineHeight: 1,
    },
    type: "PLAIN",
    width: "AUTO",
    height: "AUTO",
  };
}

function getDeckFace(metadata) {
  if (metadata.currentFace === "front" && metadata.cards[0]?.front) {
    return metadata.cards[0].front;
  }

  return metadata.back;
}

export function applyDeckDisplay(item, metadata) {
  const count = metadata.cards.length;
  const face = getDeckFace(metadata);

  item.name = `${metadata.name} (${count})`;
  item.description = deckDescription(count);
  item.text = createDeckText(count);
  item.image = createImageData(face);
  item.grid = createGridData(face, metadata.gridWidth);
}

function isDeckDisplayCurrent(item, metadata) {
  const count = metadata.cards.length;
  const face = getDeckFace(metadata);

  return (
    item.name === `${metadata.name} (${count})` &&
    item.description === deckDescription(count) &&
    item.text?.plainText === String(count) &&
    item.image?.url === face.url
  );
}

export async function syncDeckDisplays(OBR, items) {
  const decks = getDeckItems(items).filter(
    (item) => !isDeckDisplayCurrent(item, getDeckMetadata(item)),
  );

  if (!decks.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const item of draftItems) {
      const metadata = getDeckMetadata(item);
      applyDeckDisplay(item, metadata);
      setDeckMetadata(item, metadata);
    }
  });

  return decks.length;
}

function shuffleCards(cards) {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

async function getDrawOffset(OBR) {
  try {
    return Math.max(48, (await OBR.scene.grid.getDpi()) * 0.6);
  } catch {
    return 80;
  }
}

async function selectDecks(OBR, deckIds) {
  if (!deckIds.length) {
    return;
  }

  await OBR.player.select(deckIds, true).catch(() => {});
}

export async function drawFromDecks(OBR, buildImage, items, options = {}) {
  const decks = getDeckItems(items).filter(
    (item) => getDeckMetadata(item).cards.length > 0,
  );

  if (!decks.length) {
    return 0;
  }

  const offset = await getDrawOffset(OBR);
  const nextMetadataById = new Map();
  const drawnItems = [];

  for (const [index, deck] of decks.entries()) {
    const metadata = getDeckMetadata(deck);
    const [card, ...remainingCards] = metadata.cards;
    const drawnFace = metadata.currentFace === "front" ? "front" : "back";
    const face = drawnFace === "front" ? card.front : metadata.back;
    const cardMetadata = createCardMetadata({
      name: card.name,
      front: card.front,
      back: metadata.back,
      gridWidth: metadata.gridWidth,
      currentFace: drawnFace,
      sourceDeckId: deck.id,
      sourceDeckName: metadata.name,
    });
    const drawOffset = offset * (index + 1);
    const position = options.drawPositionsByDeckId?.get(deck.id) || {
      x: deck.position.x + drawOffset,
      y: deck.position.y + drawOffset,
    };
    const item = buildImage(
      createImageData(face),
      createGridData(face, metadata.gridWidth),
    )
      .name(card.name)
      .description(`Carta dupla: ${faceLabel(drawnFace)}`)
      .layer(deck.layer)
      .position(position)
      .metadata(createCardMetadataMap(cardMetadata))
      .build();
    applyCardFaceTransform(item, cardMetadata, drawnFace);

    drawnItems.push(item);
    nextMetadataById.set(deck.id, {
      ...metadata,
      cards: remainingCards,
      currentFace: metadata.currentFace === "front" ? "front" : "back",
    });
  }

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const item of draftItems) {
      const metadata = nextMetadataById.get(item.id);
      if (!metadata) {
        continue;
      }

      applyDeckDisplay(item, metadata);
      setDeckMetadata(item, metadata);

      const restoredPosition = options.deckPositionsById?.get(item.id);
      if (restoredPosition) {
        item.position = restoredPosition;
      }
    }
  });

  await OBR.scene.items.addItems(drawnItems);
  await selectDecks(OBR, decks.map((deck) => deck.id));
  return drawnItems.length;
}

async function getSelectedDeckItems(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();
  const itemIds = selection?.length ? selection : fallbackSelection;

  if (!itemIds.length) {
    return [];
  }

  return getDeckItems(await OBR.scene.items.getItems(itemIds));
}

export async function drawSelectedDecks(OBR, buildImage, fallbackSelection = []) {
  const decks = await getSelectedDeckItems(OBR, fallbackSelection);
  return drawFromDecks(OBR, buildImage, decks);
}

export async function shuffleDecks(OBR, items) {
  const decks = getDeckItems(items).filter(
    (item) => getDeckMetadata(item).cards.length > 1,
  );

  if (!decks.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const item of draftItems) {
      const metadata = getDeckMetadata(item);
      const nextMetadata = {
        ...metadata,
        cards: shuffleCards(metadata.cards),
      };

      applyDeckDisplay(item, nextMetadata);
      setDeckMetadata(item, nextMetadata);
    }
  });

  return decks.length;
}

export async function flipDeckItems(OBR, items) {
  const decks = getDeckItems(items).filter(
    (item) => getDeckMetadata(item).cards.length > 0,
  );

  if (!decks.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(decks, (draftItems) => {
    for (const item of draftItems) {
      const metadata = getDeckMetadata(item);
      const nextMetadata = {
        ...metadata,
        currentFace: metadata.currentFace === "front" ? "back" : "front",
      };

      applyDeckDisplay(item, nextMetadata);
      setDeckMetadata(item, nextMetadata);
    }
  });

  return decks.length;
}

export async function shuffleSelectedDecks(OBR, fallbackSelection = []) {
  const decks = await getSelectedDeckItems(OBR, fallbackSelection);
  return shuffleDecks(OBR, decks);
}

async function getSelectedCardItems(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();
  const itemIds = selection?.length ? selection : fallbackSelection;

  if (!itemIds.length) {
    return [];
  }

  return getCardItems(await OBR.scene.items.getItems(itemIds));
}

async function getTargetDeck(OBR, cards, fallbackDeckSelection = []) {
  const sourceDeckIds = [
    ...new Set(
      cards
        .map((item) => getCardMetadata(item)?.sourceDeckId)
        .filter((deckId) => typeof deckId === "string" && deckId.length),
    ),
  ];

  if (sourceDeckIds.length) {
    const sourceDecks = getDeckItems(await OBR.scene.items.getItems(sourceDeckIds));
    if (sourceDecks.length) {
      return sourceDecks[0];
    }
  }

  if (fallbackDeckSelection.length) {
    const fallbackDecks = getDeckItems(await OBR.scene.items.getItems(fallbackDeckSelection));
    if (fallbackDecks.length) {
      return fallbackDecks[0];
    }
  }

  return null;
}

export async function returnCardsToDeck(OBR, cards, fallbackDeckSelection = []) {
  const cardsToReturn = getCardItems(cards);

  if (!cardsToReturn.length) {
    return 0;
  }

  const targetDeck = await getTargetDeck(OBR, cardsToReturn, fallbackDeckSelection);

  if (!targetDeck) {
    return 0;
  }

  const returnedCards = cardsToReturn.map((item) => {
    const metadata = getCardMetadata(item);

    return {
      name: metadata.name || item.name || "Carta",
      front: metadata.faces.front,
    };
  });
  const returnedCardIds = cardsToReturn.map((item) => item.id);

  await OBR.scene.items.updateItems([targetDeck], (items) => {
    const item = items[0];
    const metadata = getDeckMetadata(item);
    const nextMetadata = {
      ...metadata,
      cards: [...metadata.cards, ...returnedCards],
      currentFace: metadata.currentFace === "front" ? "front" : "back",
    };

    applyDeckDisplay(item, nextMetadata);
    setDeckMetadata(item, nextMetadata);
  });

  await OBR.scene.items.deleteItems(returnedCardIds);
  await selectDecks(OBR, [targetDeck.id]);

  return returnedCardIds.length;
}

export async function returnSelectedCardsToDeck(
  OBR,
  fallbackCardSelection = [],
  fallbackDeckSelection = [],
) {
  const cards = await getSelectedCardItems(OBR, fallbackCardSelection);
  return returnCardsToDeck(OBR, cards, fallbackDeckSelection);
}
