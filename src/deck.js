import {
  createCardMetadata,
  createCardMetadataMap,
  createGridData,
  createImageData,
  deckDescription,
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

function applyDeckDisplay(item, metadata) {
  const count = metadata.cards.length;

  item.name = `${metadata.name} (${count})`;
  item.description = deckDescription(count);
  item.text = createDeckText(count);
}

function isDeckDisplayCurrent(item, metadata) {
  const count = metadata.cards.length;

  return (
    item.name === `${metadata.name} (${count})` &&
    item.description === deckDescription(count) &&
    item.text?.plainText === String(count)
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
    const cardMetadata = createCardMetadata({
      name: card.name,
      front: card.front,
      back: metadata.back,
      gridWidth: metadata.gridWidth,
      currentFace: "back",
      sourceDeckId: deck.id,
      sourceDeckName: metadata.name,
    });
    const drawOffset = offset * (index + 1);
    const position = options.drawPositionsByDeckId?.get(deck.id) || {
      x: deck.position.x + drawOffset,
      y: deck.position.y + drawOffset,
    };
    const item = buildImage(
      createImageData(metadata.back),
      createGridData(metadata.back, metadata.gridWidth),
    )
      .name(card.name)
      .description("Carta dupla: verso")
      .layer(deck.layer)
      .position(position)
      .metadata(createCardMetadataMap(cardMetadata))
      .build();

    drawnItems.push(item);
    nextMetadataById.set(deck.id, {
      ...metadata,
      cards: remainingCards,
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
      setDeckMetadata(item, {
        ...metadata,
        cards: shuffleCards(metadata.cards),
      });
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

  await OBR.scene.items.updateItems([targetDeck], (items) => {
    const item = items[0];
    const metadata = getDeckMetadata(item);
    const nextMetadata = {
      ...metadata,
      cards: [...metadata.cards, ...returnedCards],
    };

    applyDeckDisplay(item, nextMetadata);
    setDeckMetadata(item, nextMetadata);
  });

  await OBR.scene.items.deleteItems(cardsToReturn.map((item) => item.id));

  return cardsToReturn.length;
}

export async function returnSelectedCardsToDeck(
  OBR,
  fallbackCardSelection = [],
  fallbackDeckSelection = [],
) {
  const cards = await getSelectedCardItems(OBR, fallbackCardSelection);
  return returnCardsToDeck(OBR, cards, fallbackDeckSelection);
}
