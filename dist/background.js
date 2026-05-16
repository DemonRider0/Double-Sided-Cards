const process = { env: { NODE_ENV: "production" } };

const EXTENSION_ID = "br.demonrider.double-sided-cards";
const LEGACY_EXTENSION_ID = ["br", String.fromCharCode(99, 111, 100, 101, 120), "double-sided-cards"].join(".");
const METADATA_KEY = `${EXTENSION_ID}/card`;
const DECK_METADATA_KEY = `${EXTENSION_ID}/deck`;
const LEGACY_METADATA_KEY = `${LEGACY_EXTENSION_ID}/card`;
const LEGACY_DECK_METADATA_KEY = `${LEGACY_EXTENSION_ID}/deck`;

function isCardMetadata(value) {
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

function isDeckMetadata(value) {
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

function getCardMetadata(item) {
  const metadata = item.metadata?.[METADATA_KEY];
  if (isCardMetadata(metadata)) {
    return metadata;
  }

  const legacyMetadata = item.metadata?.[LEGACY_METADATA_KEY];
  return isCardMetadata(legacyMetadata) ? legacyMetadata : null;
}

function getDeckMetadata(item) {
  const metadata = item.metadata?.[DECK_METADATA_KEY];
  if (isDeckMetadata(metadata)) {
    return metadata;
  }

  const legacyMetadata = item.metadata?.[LEGACY_DECK_METADATA_KEY];
  return isDeckMetadata(legacyMetadata) ? legacyMetadata : null;
}

function setCardMetadata(item, metadata) {
  item.metadata ||= {};
  item.metadata[METADATA_KEY] = metadata;
  delete item.metadata[LEGACY_METADATA_KEY];
}

function setDeckMetadata(item, metadata) {
  item.metadata ||= {};
  item.metadata[DECK_METADATA_KEY] = metadata;
  delete item.metadata[LEGACY_DECK_METADATA_KEY];
}

function nextFace(currentFace) {
  return currentFace === "front" ? "back" : "front";
}

function faceLabel(face) {
  return face === "front" ? "frente" : "verso";
}

function createCardMetadata({
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

function deckDescription(count) {
  return count === 1 ? "Pilha: 1 carta" : `Pilha: ${count} cartas`;
}

function createImageData(face) {
  return {
    url: face.url,
    width: face.width,
    height: face.height,
    mime: face.mime,
  };
}

function createGridData(face, gridWidth) {
  const dpi = Math.max(1, face.width / gridWidth);

  return {
    dpi,
    offset: {
      x: face.width / 2,
      y: face.height / 2,
    },
  };
}

function getDeckItems(items) {
  return items.filter((item) => isDeckMetadata(getDeckMetadata(item)));
}

function getCardItems(items) {
  return items.filter((item) => isCardMetadata(getCardMetadata(item)));
}

function createDeckText(count) {
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

async function syncDeckDisplays(OBR, items) {
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

async function drawFromDecks(OBR, buildImage, items) {
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
    const position = {
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
      .metadata({
        [METADATA_KEY]: cardMetadata,
      })
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

async function drawSelectedDecks(OBR, buildImage, fallbackSelection = []) {
  const decks = await getSelectedDeckItems(OBR, fallbackSelection);
  return drawFromDecks(OBR, buildImage, decks);
}

async function shuffleDecks(OBR, items) {
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

async function shuffleSelectedDecks(OBR, fallbackSelection = []) {
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

async function returnCardsToDeck(OBR, cards, fallbackDeckSelection = []) {
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
      cards: [...returnedCards, ...metadata.cards],
    };

    applyDeckDisplay(item, nextMetadata);
    setDeckMetadata(item, nextMetadata);
  });

  await OBR.scene.items.deleteItems(cardsToReturn.map((item) => item.id));

  return cardsToReturn.length;
}

async function returnSelectedCardsToDeck(
  OBR,
  fallbackCardSelection = [],
  fallbackDeckSelection = [],
) {
  const cards = await getSelectedCardItems(OBR, fallbackCardSelection);
  return returnCardsToDeck(OBR, cards, fallbackDeckSelection);
}

async function getViewportCenter(OBR) {
  const [width, height] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);

  return OBR.viewport.inverseTransformPoint({
    x: width / 2,
    y: height / 2,
  });
}

async function getFeedbackPosition(OBR, anchorItems) {
  const itemIds = anchorItems
    .map((item) => item?.id)
    .filter((id) => typeof id === "string" && id.length);

  if (itemIds.length) {
    try {
      const bounds = await OBR.scene.items.getItemBounds(itemIds);

      return {
        x: bounds.center.x,
        y: bounds.min.y - Math.max(48, bounds.height * 0.12),
      };
    } catch {
      // Fall back to the viewport center when a selected item was just removed.
    }
  }

  return getViewportCenter(OBR);
}

function setRichText(label, message) {
  label.text.richText[0].children[0].text = message;
}

async function animateFeedback(OBR, label, startPosition) {
  const durationMs = 820;
  const distance = 72;
  const steps = 14;

  for (let step = 1; step <= steps; step += 1) {
    window.setTimeout(() => {
      const progress = step / steps;
      const eased = 1 - (1 - progress) ** 3;

      OBR.scene.local
        .updateItems(
          [label],
          (items) => {
            const item = items[0];

            if (!item) {
              return;
            }

            item.position = {
              x: startPosition.x,
              y: startPosition.y - distance * eased,
            };
            item.scale = {
              x: 1 + 0.05 * (1 - progress),
              y: 1 + 0.05 * (1 - progress),
            };
            item.style.backgroundOpacity = Math.max(0, 0.9 * (1 - progress));
            item.text.style.fillOpacity = Math.max(0, 1 - progress);
          },
          true,
        )
        .catch(() => {});
    }, Math.round((durationMs / steps) * step));
  }

  window.setTimeout(() => {
    OBR.scene.local.deleteItems([label.id]).catch(() => {});
  }, durationMs + 80);
}

async function showActionFeedback(OBR, buildLabel, message, anchorItems = []) {
  try {
    const position = await getFeedbackPosition(OBR, anchorItems);
    const label = buildLabel()
      .name(`Cartas Duplas: ${message}`)
      .plainText(message)
      .position(position)
      .fontSize(28)
      .fontWeight(800)
      .fillColor("#ffffff")
      .strokeColor("#0a0f14")
      .strokeOpacity(0.55)
      .strokeWidth(2)
      .lineHeight(1.1)
      .padding(10)
      .backgroundColor("#168478")
      .backgroundOpacity(0.9)
      .cornerRadius(10)
      .pointerDirection("DOWN")
      .pointerWidth(12)
      .pointerHeight(10)
      .disableHit(true)
      .build();

    setRichText(label, message);
    await OBR.scene.local.addItems([label]);
    await animateFeedback(OBR, label, position);
  } catch (error) {
    console.warn("Unable to show action feedback", error);
    await OBR.notification.show(message, "SUCCESS").catch(() => {});
  }
}

function getDoubleSidedCards(items) {
  return items.filter((item) => isCardMetadata(getCardMetadata(item)));
}

async function flipItems(OBR, items) {
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
      item.description = `Carta dupla: ${faceLabel(targetFace)}`;
      setCardMetadata(item, {
        ...metadata,
        currentFace: targetFace,
      });
    }
  });

  return itemsToFlip.length;
}

async function flipSelectedItems(OBR, fallbackSelection = []) {
  const selection = await OBR.player.getSelection();

  const itemIds = selection?.length ? selection : fallbackSelection;

  if (!itemIds.length) {
    return 0;
  }

  const selectedItems = await OBR.scene.items.getItems(itemIds);
  return flipItems(OBR, selectedItems);
}

var __awaiter$j = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class PlayerApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    get id() {
        // Get the user id from the message bus which will be populated once OBR_READY is handled
        if (!this.messageBus.userId) {
            throw Error("Unable to get user ID: not ready");
        }
        return this.messageBus.userId;
    }
    getSelection() {
        return __awaiter$j(this, void 0, void 0, function* () {
            const { selection } = yield this.messageBus.sendAsync("OBR_PLAYER_GET_SELECTION", {});
            return selection;
        });
    }
    select(items, replace) {
        return __awaiter$j(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_PLAYER_SELECT", { items, replace });
        });
    }
    deselect(items) {
        return __awaiter$j(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_PLAYER_DESELECT", { items });
        });
    }
    getName() {
        return __awaiter$j(this, void 0, void 0, function* () {
            const { name } = yield this.messageBus.sendAsync("OBR_PLAYER_GET_NAME", {});
            return name;
        });
    }
    setName(name) {
        return __awaiter$j(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_PLAYER_SET_NAME", { name });
        });
    }
    getColor() {
        return __awaiter$j(this, void 0, void 0, function* () {
            const { color } = yield this.messageBus.sendAsync("OBR_PLAYER_GET_COLOR", {});
            return color;
        });
    }
    setColor(color) {
        return __awaiter$j(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_PLAYER_SET_COLOR", { color });
        });
    }
    getSyncView() {
        return __awaiter$j(this, void 0, void 0, function* () {
            const { syncView } = yield this.messageBus.sendAsync("OBR_PLAYER_GET_SYNC_VIEW", {});
            return syncView;
        });
    }
    setSyncView(syncView) {
        return __awaiter$j(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_PLAYER_SET_SYNC_VIEW", { syncView });
        });
    }
    getId() {
        return __awaiter$j(this, void 0, void 0, function* () {
            const { id } = yield this.messageBus.sendAsync("OBR_PLAYER_GET_ID", {});
            return id;
        });
    }
    getRole() {
        return __awaiter$j(this, void 0, void 0, function* () {
            const { role } = yield this.messageBus.sendAsync("OBR_PLAYER_GET_ROLE", {});
            return role;
        });
    }
    getMetadata() {
        return __awaiter$j(this, void 0, void 0, function* () {
            const { metadata } = yield this.messageBus.sendAsync("OBR_PLAYER_GET_METADATA", {});
            return metadata;
        });
    }
    setMetadata(update) {
        return __awaiter$j(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_PLAYER_SET_METADATA", { update });
        });
    }
    hasPermission(permission) {
        return __awaiter$j(this, void 0, void 0, function* () {
            const role = yield this.getRole();
            if (role === "GM") {
                return true;
            }
            const { permissions } = yield this.messageBus.sendAsync("OBR_ROOM_GET_PERMISSIONS", {});
            return permissions.indexOf(permission) > -1;
        });
    }
    getConnectionId() {
        return __awaiter$j(this, void 0, void 0, function* () {
            const { connectionId } = yield this.messageBus.sendAsync("OBR_PLAYER_GET_CONNECTION_ID", {});
            return connectionId;
        });
    }
    onChange(callback) {
        const handleChange = (data) => {
            callback(data.player);
        };
        this.messageBus.send("OBR_PLAYER_SUBSCRIBE", {});
        this.messageBus.on("OBR_PLAYER_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_PLAYER_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_PLAYER_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$i = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class ViewportApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    reset() {
        return __awaiter$i(this, void 0, void 0, function* () {
            const { transform } = yield this.messageBus.sendAsync("OBR_VIEWPORT_RESET", {});
            return transform;
        });
    }
    animateTo(transform) {
        return __awaiter$i(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_VIEWPORT_ANIMATE_TO", { transform });
        });
    }
    animateToBounds(bounds) {
        return __awaiter$i(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_VIEWPORT_ANIMATE_TO_BOUNDS", {
                bounds,
            });
        });
    }
    getPosition() {
        return __awaiter$i(this, void 0, void 0, function* () {
            const { position } = yield this.messageBus.sendAsync("OBR_VIEWPORT_GET_POSITION", {});
            return position;
        });
    }
    setPosition(position) {
        return __awaiter$i(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_VIEWPORT_SET_POSITION", { position });
        });
    }
    getScale() {
        return __awaiter$i(this, void 0, void 0, function* () {
            const { scale } = yield this.messageBus.sendAsync("OBR_VIEWPORT_GET_SCALE", {});
            return scale;
        });
    }
    setScale(scale) {
        return __awaiter$i(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_VIEWPORT_SET_SCALE", { scale });
        });
    }
    getWidth() {
        return __awaiter$i(this, void 0, void 0, function* () {
            const { width } = yield this.messageBus.sendAsync("OBR_VIEWPORT_GET_WIDTH", {});
            return width;
        });
    }
    getHeight() {
        return __awaiter$i(this, void 0, void 0, function* () {
            const { height } = yield this.messageBus.sendAsync("OBR_VIEWPORT_GET_HEIGHT", {});
            return height;
        });
    }
    transformPoint(point) {
        return __awaiter$i(this, void 0, void 0, function* () {
            const { point: transformed } = yield this.messageBus.sendAsync("OBR_VIEWPORT_TRANSFORM_POINT", { point });
            return transformed;
        });
    }
    inverseTransformPoint(point) {
        return __awaiter$i(this, void 0, void 0, function* () {
            const { point: transformed } = yield this.messageBus.sendAsync("OBR_VIEWPORT_INVERSE_TRANSFORM_POINT", { point });
            return transformed;
        });
    }
}

function isMessage(message) {
    return typeof message.id === "string";
}

class EventEmitter {
  constructor() {
    this.events = new Map();
  }

  on(name, listener) {
    const listeners = this.events.get(name) ?? [];
    listeners.push(listener);
    this.events.set(name, listeners);
    return this;
  }

  once(name, listener) {
    const wrapped = (...args) => {
      this.off(name, wrapped);
      listener(...args);
    };

    return this.on(name, wrapped);
  }

  off(name, listener) {
    const listeners = this.events.get(name);
    if (!listeners) {
      return this;
    }

    this.events.set(
      name,
      listeners.filter((candidate) => candidate !== listener),
    );
    return this;
  }

  emit(name, ...args) {
    const listeners = this.events.get(name) ?? [];

    for (const listener of listeners.slice()) {
      listener(...args);
    }

    return listeners.length > 0;
  }

  setMaxListeners() {
    return this;
  }
}

// Unique ID creation requires a high quality random # generator. In the browser we therefore
// require the crypto API and do not support built-in fallback to lower quality random number
// generators (like Math.random()).
let getRandomValues;
const rnds8 = new Uint8Array(16);
function rng() {
  // lazy load so that environments that need to polyfill have a chance to do so
  if (!getRandomValues) {
    // getRandomValues needs to be invoked in a context where "this" is a Crypto implementation.
    getRandomValues = typeof crypto !== 'undefined' && crypto.getRandomValues && crypto.getRandomValues.bind(crypto);

    if (!getRandomValues) {
      throw new Error('crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported');
    }
  }

  return getRandomValues(rnds8);
}

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */

const byteToHex = [];

for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

const randomUUID = typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID.bind(crypto);
var native = {
  randomUUID
};

function v4(options, buf, offset) {
  if (native.randomUUID && true && !options) {
    return native.randomUUID();
  }

  options = options || {};
  const rnds = options.random || (options.rng || rng)(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`

  rnds[6] = rnds[6] & 0x0f | 0x40;
  rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

  return unsafeStringify(rnds);
}

class MessageBus extends EventEmitter {
    constructor(origin, roomId) {
        super();
        this.ready = false;
        /** The user ID of the player using this extension */
        this.userId = null;
        /** A reference ID used to get responses from the target  */
        this.ref = null;
        this.handleMessage = (event) => {
            const message = event.data;
            // Ensure the message is meant for us and check that it is formatted correctly
            if (event.origin === this.targetOrigin && isMessage(message)) {
                // Handle the ready event
                if (message.id === "OBR_READY") {
                    this.ready = true;
                    const data = message.data;
                    this.ref = data.ref;
                    this.userId = data.userId;
                }
                this.emit(message.id, message.data);
            }
        };
        /**
         * @param nonce
         * A nonce that will be appended to the response event ID
         * This allows concurrent calls to the same API endpoint
         * For example a call to `GET_ITEM` will respond with the `GET_ITEM_RESPONSE`
         * event. But if we make two concurrent calls to `GET_ITEM`
         * we cannot differentiate between the two `GET_ITEM_RESPONSE`
         * events. This nonce will be appended to the response so that
         * a `GET_ITEM` event called with the nonce `_123` will respond
         * with `GET_ITEM_RESPONSE_123`.
         */
        this.send = (id, data, nonce) => {
            var _a;
            if (!this.ref) {
                throw Error("Unable to send message: not ready");
            }
            (_a = window.parent) === null || _a === void 0 ? void 0 : _a.postMessage({
                id,
                data,
                ref: this.ref,
                nonce,
            }, this.targetOrigin);
        };
        this.sendAsync = (id, data, timeout = 5000) => {
            const nonce = `_${v4()}`;
            this.send(id, data, nonce);
            return Promise.race([
                new Promise((resolve, reject) => {
                    const self = this;
                    function onResponse(value) {
                        // Remove listeners for this event to avoid memory and data leaks
                        self.off(`${id}_RESPONSE${nonce}`, onResponse);
                        self.off(`${id}_ERROR${nonce}`, onError);
                        resolve(value);
                    }
                    function onError(error) {
                        self.off(`${id}_RESPONSE${nonce}`, onResponse);
                        self.off(`${id}_ERROR${nonce}`, onError);
                        reject(error);
                    }
                    this.on(`${id}_RESPONSE${nonce}`, onResponse);
                    this.on(`${id}_ERROR${nonce}`, onError);
                }),
                ...(timeout > 0
                    ? [
                        new Promise((_, reject) => window.setTimeout(() => reject(new Error(`Message ${id} took longer than ${timeout}ms to get a result`)), timeout)),
                    ]
                    : []),
            ]);
        };
        this.roomId = roomId;
        this.targetOrigin = origin;
        window.addEventListener("message", this.handleMessage);
        // Increase max listeners to prevent warning message from update events
        this.setMaxListeners(100);
    }
    destroy() {
        window.removeEventListener("message", this.handleMessage);
    }
}

var __awaiter$h = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class NotificationApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    show(message, variant) {
        return __awaiter$h(this, void 0, void 0, function* () {
            const { id } = yield this.messageBus.sendAsync("OBR_NOTIFICATION_SHOW", { message, variant });
            return id;
        });
    }
    close(id) {
        return __awaiter$h(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_NOTIFICATION_CLOSE", { id });
        });
    }
}

var __awaiter$g = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class SceneFogApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    getColor() {
        return __awaiter$g(this, void 0, void 0, function* () {
            const { color } = yield this.messageBus.sendAsync("OBR_SCENE_FOG_GET_COLOR", {});
            return color;
        });
    }
    setColor(color) {
        return __awaiter$g(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_FOG_SET_COLOR", { color });
        });
    }
    getStrokeWidth() {
        return __awaiter$g(this, void 0, void 0, function* () {
            const { strokeWidth } = yield this.messageBus.sendAsync("OBR_SCENE_FOG_GET_STROKE_WIDTH", {});
            return strokeWidth;
        });
    }
    setStrokeWidth(strokeWidth) {
        return __awaiter$g(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_FOG_SET_STROKE_WIDTH", {
                strokeWidth,
            });
        });
    }
    getFilled() {
        return __awaiter$g(this, void 0, void 0, function* () {
            const { filled } = yield this.messageBus.sendAsync("OBR_SCENE_FOG_GET_FILLED", {});
            return filled;
        });
    }
    setFilled(filled) {
        return __awaiter$g(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_FOG_SET_FILLED", { filled });
        });
    }
    onChange(callback) {
        const handleChange = (data) => {
            callback(data.fog);
        };
        this.messageBus.send("OBR_SCENE_FOG_SUBSCRIBE", {});
        this.messageBus.on("OBR_SCENE_FOG_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_SCENE_FOG_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_SCENE_FOG_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$f = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class SceneGridApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    getDpi() {
        return __awaiter$f(this, void 0, void 0, function* () {
            const { dpi } = yield this.messageBus.sendAsync("OBR_SCENE_GRID_GET_DPI", {});
            return dpi;
        });
    }
    getScale() {
        return __awaiter$f(this, void 0, void 0, function* () {
            const scale = yield this.messageBus.sendAsync("OBR_SCENE_GRID_GET_SCALE", {});
            return scale;
        });
    }
    setScale(scale) {
        return __awaiter$f(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_GRID_SET_SCALE", { scale });
        });
    }
    getColor() {
        return __awaiter$f(this, void 0, void 0, function* () {
            const { color } = yield this.messageBus.sendAsync("OBR_SCENE_GRID_GET_COLOR", {});
            return color;
        });
    }
    setColor(color) {
        return __awaiter$f(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_GRID_SET_COLOR", { color });
        });
    }
    getOpacity() {
        return __awaiter$f(this, void 0, void 0, function* () {
            const { opacity } = yield this.messageBus.sendAsync("OBR_SCENE_GRID_GET_OPACITY", {});
            return opacity;
        });
    }
    setOpacity(opacity) {
        return __awaiter$f(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_GRID_SET_OPACITY", { opacity });
        });
    }
    getType() {
        return __awaiter$f(this, void 0, void 0, function* () {
            const { type } = yield this.messageBus.sendAsync("OBR_SCENE_GRID_GET_TYPE", {});
            return type;
        });
    }
    setType(type) {
        return __awaiter$f(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_GRID_SET_TYPE", { type });
        });
    }
    getLineType() {
        return __awaiter$f(this, void 0, void 0, function* () {
            const { lineType } = yield this.messageBus.sendAsync("OBR_SCENE_GRID_GET_LINE_TYPE", {});
            return lineType;
        });
    }
    setLineType(lineType) {
        return __awaiter$f(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_GRID_SET_LINE_TYPE", {
                lineType,
            });
        });
    }
    getMeasurement() {
        return __awaiter$f(this, void 0, void 0, function* () {
            const { measurement } = yield this.messageBus.sendAsync("OBR_SCENE_GRID_GET_MEASUREMENT", {});
            return measurement;
        });
    }
    setMeasurement(measurement) {
        return __awaiter$f(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_GRID_SET_MEASUREMENT", {
                measurement,
            });
        });
    }
    getLineWidth() {
        return __awaiter$f(this, void 0, void 0, function* () {
            const { lineWidth } = yield this.messageBus.sendAsync("OBR_SCENE_GRID_GET_LINE_WIDTH", {});
            return lineWidth;
        });
    }
    setLineWidth(lineWidth) {
        return __awaiter$f(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_GRID_SET_LINE_WIDTH", {
                lineWidth,
            });
        });
    }
    snapPosition(position, snappingSensitivity, useCorners, useCenter) {
        return __awaiter$f(this, void 0, void 0, function* () {
            const { position: snapped } = yield this.messageBus.sendAsync("OBR_SCENE_GRID_SNAP_POSITION", {
                position,
                snappingSensitivity,
                useCorners,
                useCenter,
            });
            return snapped;
        });
    }
    getDistance(from, to) {
        return __awaiter$f(this, void 0, void 0, function* () {
            const { distance } = yield this.messageBus.sendAsync("OBR_SCENE_GRID_GET_DISTANCE", { from, to });
            return distance;
        });
    }
    onChange(callback) {
        const handleChange = (data) => {
            callback(data.grid);
        };
        this.messageBus.send("OBR_SCENE_GRID_SUBSCRIBE", {});
        this.messageBus.on("OBR_SCENE_GRID_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_SCENE_GRID_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_SCENE_GRID_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$e = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class SceneHistoryApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    undo() {
        return __awaiter$e(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_HISTORY_UNDO", {});
        });
    }
    redo() {
        return __awaiter$e(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_HISTORY_REDO", {});
        });
    }
    canUndo() {
        return __awaiter$e(this, void 0, void 0, function* () {
            const { canUndo } = yield this.messageBus.sendAsync("OBR_SCENE_HISTORY_CAN_UNDO", {});
            return canUndo;
        });
    }
    canRedo() {
        return __awaiter$e(this, void 0, void 0, function* () {
            const { canRedo } = yield this.messageBus.sendAsync("OBR_SCENE_HISTORY_CAN_REDO", {});
            return canRedo;
        });
    }
}

// src/utils/env.ts
var NOTHING = Symbol.for("immer-nothing");
var DRAFTABLE = Symbol.for("immer-draftable");
var DRAFT_STATE = Symbol.for("immer-state");

// src/utils/errors.ts
var errors = process.env.NODE_ENV !== "production" ? [
  // All error codes, starting by 0:
  function(plugin) {
    return `The plugin for '${plugin}' has not been loaded into Immer. To enable the plugin, import and call \`enable${plugin}()\` when initializing your application.`;
  },
  function(thing) {
    return `produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '${thing}'`;
  },
  "This object has been frozen and should not be mutated",
  function(data) {
    return "Cannot use a proxy that has been revoked. Did you pass an object from inside an immer function to an async process? " + data;
  },
  "An immer producer returned a new value *and* modified its draft. Either return a new value *or* modify the draft.",
  "Immer forbids circular references",
  "The first or second argument to `produce` must be a function",
  "The third argument to `produce` must be a function or undefined",
  "First argument to `createDraft` must be a plain object, an array, or an immerable object",
  "First argument to `finishDraft` must be a draft returned by `createDraft`",
  function(thing) {
    return `'current' expects a draft, got: ${thing}`;
  },
  "Object.defineProperty() cannot be used on an Immer draft",
  "Object.setPrototypeOf() cannot be used on an Immer draft",
  "Immer only supports deleting array indices",
  "Immer only supports setting array indices and the 'length' property",
  function(thing) {
    return `'original' expects a draft, got: ${thing}`;
  }
  // Note: if more errors are added, the errorOffset in Patches.ts should be increased
  // See Patches.ts for additional errors
] : [];
function die(error, ...args) {
  if (process.env.NODE_ENV !== "production") {
    const e = errors[error];
    const msg = typeof e === "function" ? e.apply(null, args) : e;
    throw new Error(`[Immer] ${msg}`);
  }
  throw new Error(
    `[Immer] minified error nr: ${error}. Full error at: https://bit.ly/3cXEKWf`
  );
}

// src/utils/common.ts
var getPrototypeOf = Object.getPrototypeOf;
function isDraft(value) {
  return !!value && !!value[DRAFT_STATE];
}
function isDraftable(value) {
  if (!value)
    return false;
  return isPlainObject(value) || Array.isArray(value) || !!value[DRAFTABLE] || !!value.constructor?.[DRAFTABLE] || isMap(value) || isSet(value);
}
var objectCtorString = Object.prototype.constructor.toString();
var cachedCtorStrings = /* @__PURE__ */ new WeakMap();
function isPlainObject(value) {
  if (!value || typeof value !== "object")
    return false;
  const proto = Object.getPrototypeOf(value);
  if (proto === null || proto === Object.prototype)
    return true;
  const Ctor = Object.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  if (Ctor === Object)
    return true;
  if (typeof Ctor !== "function")
    return false;
  let ctorString = cachedCtorStrings.get(Ctor);
  if (ctorString === void 0) {
    ctorString = Function.toString.call(Ctor);
    cachedCtorStrings.set(Ctor, ctorString);
  }
  return ctorString === objectCtorString;
}
function each(obj, iter, strict = true) {
  if (getArchtype(obj) === 0 /* Object */) {
    const keys = strict ? Reflect.ownKeys(obj) : Object.keys(obj);
    keys.forEach((key) => {
      iter(key, obj[key], obj);
    });
  } else {
    obj.forEach((entry, index) => iter(index, entry, obj));
  }
}
function getArchtype(thing) {
  const state = thing[DRAFT_STATE];
  return state ? state.type_ : Array.isArray(thing) ? 1 /* Array */ : isMap(thing) ? 2 /* Map */ : isSet(thing) ? 3 /* Set */ : 0 /* Object */;
}
function has(thing, prop) {
  return getArchtype(thing) === 2 /* Map */ ? thing.has(prop) : Object.prototype.hasOwnProperty.call(thing, prop);
}
function get(thing, prop) {
  return getArchtype(thing) === 2 /* Map */ ? thing.get(prop) : thing[prop];
}
function set(thing, propOrOldValue, value) {
  const t = getArchtype(thing);
  if (t === 2 /* Map */)
    thing.set(propOrOldValue, value);
  else if (t === 3 /* Set */) {
    thing.add(value);
  } else
    thing[propOrOldValue] = value;
}
function is(x, y) {
  if (x === y) {
    return x !== 0 || 1 / x === 1 / y;
  } else {
    return x !== x && y !== y;
  }
}
function isMap(target) {
  return target instanceof Map;
}
function isSet(target) {
  return target instanceof Set;
}
function latest(state) {
  return state.copy_ || state.base_;
}
function shallowCopy(base, strict) {
  if (isMap(base)) {
    return new Map(base);
  }
  if (isSet(base)) {
    return new Set(base);
  }
  if (Array.isArray(base))
    return Array.prototype.slice.call(base);
  const isPlain = isPlainObject(base);
  if (strict === true || strict === "class_only" && !isPlain) {
    const descriptors = Object.getOwnPropertyDescriptors(base);
    delete descriptors[DRAFT_STATE];
    let keys = Reflect.ownKeys(descriptors);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const desc = descriptors[key];
      if (desc.writable === false) {
        desc.writable = true;
        desc.configurable = true;
      }
      if (desc.get || desc.set)
        descriptors[key] = {
          configurable: true,
          writable: true,
          // could live with !!desc.set as well here...
          enumerable: desc.enumerable,
          value: base[key]
        };
    }
    return Object.create(getPrototypeOf(base), descriptors);
  } else {
    const proto = getPrototypeOf(base);
    if (proto !== null && isPlain) {
      return { ...base };
    }
    const obj = Object.create(proto);
    return Object.assign(obj, base);
  }
}
function freeze(obj, deep = false) {
  if (isFrozen(obj) || isDraft(obj) || !isDraftable(obj))
    return obj;
  if (getArchtype(obj) > 1) {
    Object.defineProperties(obj, {
      set: dontMutateMethodOverride,
      add: dontMutateMethodOverride,
      clear: dontMutateMethodOverride,
      delete: dontMutateMethodOverride
    });
  }
  Object.freeze(obj);
  if (deep)
    Object.values(obj).forEach((value) => freeze(value, true));
  return obj;
}
function dontMutateFrozenCollections() {
  die(2);
}
var dontMutateMethodOverride = {
  value: dontMutateFrozenCollections
};
function isFrozen(obj) {
  if (obj === null || typeof obj !== "object")
    return true;
  return Object.isFrozen(obj);
}

// src/utils/plugins.ts
var plugins = {};
function getPlugin(pluginKey) {
  const plugin = plugins[pluginKey];
  if (!plugin) {
    die(0, pluginKey);
  }
  return plugin;
}
function loadPlugin(pluginKey, implementation) {
  if (!plugins[pluginKey])
    plugins[pluginKey] = implementation;
}

// src/core/scope.ts
var currentScope;
function getCurrentScope() {
  return currentScope;
}
function createScope(parent_, immer_) {
  return {
    drafts_: [],
    parent_,
    immer_,
    // Whenever the modified draft contains a draft from another scope, we
    // need to prevent auto-freezing so the unowned draft can be finalized.
    canAutoFreeze_: true,
    unfinalizedDrafts_: 0
  };
}
function usePatchesInScope(scope, patchListener) {
  if (patchListener) {
    getPlugin("Patches");
    scope.patches_ = [];
    scope.inversePatches_ = [];
    scope.patchListener_ = patchListener;
  }
}
function revokeScope(scope) {
  leaveScope(scope);
  scope.drafts_.forEach(revokeDraft);
  scope.drafts_ = null;
}
function leaveScope(scope) {
  if (scope === currentScope) {
    currentScope = scope.parent_;
  }
}
function enterScope(immer2) {
  return currentScope = createScope(currentScope, immer2);
}
function revokeDraft(draft) {
  const state = draft[DRAFT_STATE];
  if (state.type_ === 0 /* Object */ || state.type_ === 1 /* Array */)
    state.revoke_();
  else
    state.revoked_ = true;
}

// src/core/finalize.ts
function processResult(result, scope) {
  scope.unfinalizedDrafts_ = scope.drafts_.length;
  const baseDraft = scope.drafts_[0];
  const isReplaced = result !== void 0 && result !== baseDraft;
  if (isReplaced) {
    if (baseDraft[DRAFT_STATE].modified_) {
      revokeScope(scope);
      die(4);
    }
    if (isDraftable(result)) {
      result = finalize(scope, result);
      if (!scope.parent_)
        maybeFreeze(scope, result);
    }
    if (scope.patches_) {
      getPlugin("Patches").generateReplacementPatches_(
        baseDraft[DRAFT_STATE].base_,
        result,
        scope.patches_,
        scope.inversePatches_
      );
    }
  } else {
    result = finalize(scope, baseDraft, []);
  }
  revokeScope(scope);
  if (scope.patches_) {
    scope.patchListener_(scope.patches_, scope.inversePatches_);
  }
  return result !== NOTHING ? result : void 0;
}
function finalize(rootScope, value, path) {
  if (isFrozen(value))
    return value;
  const useStrictIteration = rootScope.immer_.shouldUseStrictIteration();
  const state = value[DRAFT_STATE];
  if (!state) {
    each(
      value,
      (key, childValue) => finalizeProperty(rootScope, state, value, key, childValue, path),
      useStrictIteration
    );
    return value;
  }
  if (state.scope_ !== rootScope)
    return value;
  if (!state.modified_) {
    maybeFreeze(rootScope, state.base_, true);
    return state.base_;
  }
  if (!state.finalized_) {
    state.finalized_ = true;
    state.scope_.unfinalizedDrafts_--;
    const result = state.copy_;
    let resultEach = result;
    let isSet2 = false;
    if (state.type_ === 3 /* Set */) {
      resultEach = new Set(result);
      result.clear();
      isSet2 = true;
    }
    each(
      resultEach,
      (key, childValue) => finalizeProperty(
        rootScope,
        state,
        result,
        key,
        childValue,
        path,
        isSet2
      ),
      useStrictIteration
    );
    maybeFreeze(rootScope, result, false);
    if (path && rootScope.patches_) {
      getPlugin("Patches").generatePatches_(
        state,
        path,
        rootScope.patches_,
        rootScope.inversePatches_
      );
    }
  }
  return state.copy_;
}
function finalizeProperty(rootScope, parentState, targetObject, prop, childValue, rootPath, targetIsSet) {
  if (childValue == null) {
    return;
  }
  if (typeof childValue !== "object" && !targetIsSet) {
    return;
  }
  const childIsFrozen = isFrozen(childValue);
  if (childIsFrozen && !targetIsSet) {
    return;
  }
  if (process.env.NODE_ENV !== "production" && childValue === targetObject)
    die(5);
  if (isDraft(childValue)) {
    const path = rootPath && parentState && parentState.type_ !== 3 /* Set */ && // Set objects are atomic since they have no keys.
    !has(parentState.assigned_, prop) ? rootPath.concat(prop) : void 0;
    const res = finalize(rootScope, childValue, path);
    set(targetObject, prop, res);
    if (isDraft(res)) {
      rootScope.canAutoFreeze_ = false;
    } else
      return;
  } else if (targetIsSet) {
    targetObject.add(childValue);
  }
  if (isDraftable(childValue) && !childIsFrozen) {
    if (!rootScope.immer_.autoFreeze_ && rootScope.unfinalizedDrafts_ < 1) {
      return;
    }
    if (parentState && parentState.base_ && parentState.base_[prop] === childValue && childIsFrozen) {
      return;
    }
    finalize(rootScope, childValue);
    if ((!parentState || !parentState.scope_.parent_) && typeof prop !== "symbol" && (isMap(targetObject) ? targetObject.has(prop) : Object.prototype.propertyIsEnumerable.call(targetObject, prop)))
      maybeFreeze(rootScope, childValue);
  }
}
function maybeFreeze(scope, value, deep = false) {
  if (!scope.parent_ && scope.immer_.autoFreeze_ && scope.canAutoFreeze_) {
    freeze(value, deep);
  }
}

// src/core/proxy.ts
function createProxyProxy(base, parent) {
  const isArray = Array.isArray(base);
  const state = {
    type_: isArray ? 1 /* Array */ : 0 /* Object */,
    // Track which produce call this is associated with.
    scope_: parent ? parent.scope_ : getCurrentScope(),
    // True for both shallow and deep changes.
    modified_: false,
    // Used during finalization.
    finalized_: false,
    // Track which properties have been assigned (true) or deleted (false).
    assigned_: {},
    // The parent draft state.
    parent_: parent,
    // The base state.
    base_: base,
    // The base proxy.
    draft_: null,
    // set below
    // The base copy with any updated values.
    copy_: null,
    // Called by the `produce` function.
    revoke_: null,
    isManual_: false
  };
  let target = state;
  let traps = objectTraps;
  if (isArray) {
    target = [state];
    traps = arrayTraps;
  }
  const { revoke, proxy } = Proxy.revocable(target, traps);
  state.draft_ = proxy;
  state.revoke_ = revoke;
  return proxy;
}
var objectTraps = {
  get(state, prop) {
    if (prop === DRAFT_STATE)
      return state;
    const source = latest(state);
    if (!has(source, prop)) {
      return readPropFromProto(state, source, prop);
    }
    const value = source[prop];
    if (state.finalized_ || !isDraftable(value)) {
      return value;
    }
    if (value === peek(state.base_, prop)) {
      prepareCopy(state);
      return state.copy_[prop] = createProxy(value, state);
    }
    return value;
  },
  has(state, prop) {
    return prop in latest(state);
  },
  ownKeys(state) {
    return Reflect.ownKeys(latest(state));
  },
  set(state, prop, value) {
    const desc = getDescriptorFromProto(latest(state), prop);
    if (desc?.set) {
      desc.set.call(state.draft_, value);
      return true;
    }
    if (!state.modified_) {
      const current2 = peek(latest(state), prop);
      const currentState = current2?.[DRAFT_STATE];
      if (currentState && currentState.base_ === value) {
        state.copy_[prop] = value;
        state.assigned_[prop] = false;
        return true;
      }
      if (is(value, current2) && (value !== void 0 || has(state.base_, prop)))
        return true;
      prepareCopy(state);
      markChanged(state);
    }
    if (state.copy_[prop] === value && // special case: handle new props with value 'undefined'
    (value !== void 0 || prop in state.copy_) || // special case: NaN
    Number.isNaN(value) && Number.isNaN(state.copy_[prop]))
      return true;
    state.copy_[prop] = value;
    state.assigned_[prop] = true;
    return true;
  },
  deleteProperty(state, prop) {
    if (peek(state.base_, prop) !== void 0 || prop in state.base_) {
      state.assigned_[prop] = false;
      prepareCopy(state);
      markChanged(state);
    } else {
      delete state.assigned_[prop];
    }
    if (state.copy_) {
      delete state.copy_[prop];
    }
    return true;
  },
  // Note: We never coerce `desc.value` into an Immer draft, because we can't make
  // the same guarantee in ES5 mode.
  getOwnPropertyDescriptor(state, prop) {
    const owner = latest(state);
    const desc = Reflect.getOwnPropertyDescriptor(owner, prop);
    if (!desc)
      return desc;
    return {
      writable: true,
      configurable: state.type_ !== 1 /* Array */ || prop !== "length",
      enumerable: desc.enumerable,
      value: owner[prop]
    };
  },
  defineProperty() {
    die(11);
  },
  getPrototypeOf(state) {
    return getPrototypeOf(state.base_);
  },
  setPrototypeOf() {
    die(12);
  }
};
var arrayTraps = {};
each(objectTraps, (key, fn) => {
  arrayTraps[key] = function() {
    arguments[0] = arguments[0][0];
    return fn.apply(this, arguments);
  };
});
arrayTraps.deleteProperty = function(state, prop) {
  if (process.env.NODE_ENV !== "production" && isNaN(parseInt(prop)))
    die(13);
  return arrayTraps.set.call(this, state, prop, void 0);
};
arrayTraps.set = function(state, prop, value) {
  if (process.env.NODE_ENV !== "production" && prop !== "length" && isNaN(parseInt(prop)))
    die(14);
  return objectTraps.set.call(this, state[0], prop, value, state[0]);
};
function peek(draft, prop) {
  const state = draft[DRAFT_STATE];
  const source = state ? latest(state) : draft;
  return source[prop];
}
function readPropFromProto(state, source, prop) {
  const desc = getDescriptorFromProto(source, prop);
  return desc ? `value` in desc ? desc.value : (
    // This is a very special case, if the prop is a getter defined by the
    // prototype, we should invoke it with the draft as context!
    desc.get?.call(state.draft_)
  ) : void 0;
}
function getDescriptorFromProto(source, prop) {
  if (!(prop in source))
    return void 0;
  let proto = getPrototypeOf(source);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc)
      return desc;
    proto = getPrototypeOf(proto);
  }
  return void 0;
}
function markChanged(state) {
  if (!state.modified_) {
    state.modified_ = true;
    if (state.parent_) {
      markChanged(state.parent_);
    }
  }
}
function prepareCopy(state) {
  if (!state.copy_) {
    state.copy_ = shallowCopy(
      state.base_,
      state.scope_.immer_.useStrictShallowCopy_
    );
  }
}

// src/core/immerClass.ts
var Immer2 = class {
  constructor(config) {
    this.autoFreeze_ = true;
    this.useStrictShallowCopy_ = false;
    this.useStrictIteration_ = true;
    /**
     * The `produce` function takes a value and a "recipe function" (whose
     * return value often depends on the base state). The recipe function is
     * free to mutate its first argument however it wants. All mutations are
     * only ever applied to a __copy__ of the base state.
     *
     * Pass only a function to create a "curried producer" which relieves you
     * from passing the recipe function every time.
     *
     * Only plain objects and arrays are made mutable. All other objects are
     * considered uncopyable.
     *
     * Note: This function is __bound__ to its `Immer` instance.
     *
     * @param {any} base - the initial state
     * @param {Function} recipe - function that receives a proxy of the base state as first argument and which can be freely modified
     * @param {Function} patchListener - optional function that will be called with all the patches produced here
     * @returns {any} a new state, or the initial state if nothing was modified
     */
    this.produce = (base, recipe, patchListener) => {
      if (typeof base === "function" && typeof recipe !== "function") {
        const defaultBase = recipe;
        recipe = base;
        const self = this;
        return function curriedProduce(base2 = defaultBase, ...args) {
          return self.produce(base2, (draft) => recipe.call(this, draft, ...args));
        };
      }
      if (typeof recipe !== "function")
        die(6);
      if (patchListener !== void 0 && typeof patchListener !== "function")
        die(7);
      let result;
      if (isDraftable(base)) {
        const scope = enterScope(this);
        const proxy = createProxy(base, void 0);
        let hasError = true;
        try {
          result = recipe(proxy);
          hasError = false;
        } finally {
          if (hasError)
            revokeScope(scope);
          else
            leaveScope(scope);
        }
        usePatchesInScope(scope, patchListener);
        return processResult(result, scope);
      } else if (!base || typeof base !== "object") {
        result = recipe(base);
        if (result === void 0)
          result = base;
        if (result === NOTHING)
          result = void 0;
        if (this.autoFreeze_)
          freeze(result, true);
        if (patchListener) {
          const p = [];
          const ip = [];
          getPlugin("Patches").generateReplacementPatches_(base, result, p, ip);
          patchListener(p, ip);
        }
        return result;
      } else
        die(1, base);
    };
    this.produceWithPatches = (base, recipe) => {
      if (typeof base === "function") {
        return (state, ...args) => this.produceWithPatches(state, (draft) => base(draft, ...args));
      }
      let patches, inversePatches;
      const result = this.produce(base, recipe, (p, ip) => {
        patches = p;
        inversePatches = ip;
      });
      return [result, patches, inversePatches];
    };
    if (typeof config?.autoFreeze === "boolean")
      this.setAutoFreeze(config.autoFreeze);
    if (typeof config?.useStrictShallowCopy === "boolean")
      this.setUseStrictShallowCopy(config.useStrictShallowCopy);
    if (typeof config?.useStrictIteration === "boolean")
      this.setUseStrictIteration(config.useStrictIteration);
  }
  createDraft(base) {
    if (!isDraftable(base))
      die(8);
    if (isDraft(base))
      base = current(base);
    const scope = enterScope(this);
    const proxy = createProxy(base, void 0);
    proxy[DRAFT_STATE].isManual_ = true;
    leaveScope(scope);
    return proxy;
  }
  finishDraft(draft, patchListener) {
    const state = draft && draft[DRAFT_STATE];
    if (!state || !state.isManual_)
      die(9);
    const { scope_: scope } = state;
    usePatchesInScope(scope, patchListener);
    return processResult(void 0, scope);
  }
  /**
   * Pass true to automatically freeze all copies created by Immer.
   *
   * By default, auto-freezing is enabled.
   */
  setAutoFreeze(value) {
    this.autoFreeze_ = value;
  }
  /**
   * Pass true to enable strict shallow copy.
   *
   * By default, immer does not copy the object descriptors such as getter, setter and non-enumrable properties.
   */
  setUseStrictShallowCopy(value) {
    this.useStrictShallowCopy_ = value;
  }
  /**
   * Pass false to use faster iteration that skips non-enumerable properties
   * but still handles symbols for compatibility.
   *
   * By default, strict iteration is enabled (includes all own properties).
   */
  setUseStrictIteration(value) {
    this.useStrictIteration_ = value;
  }
  shouldUseStrictIteration() {
    return this.useStrictIteration_;
  }
  applyPatches(base, patches) {
    let i;
    for (i = patches.length - 1; i >= 0; i--) {
      const patch = patches[i];
      if (patch.path.length === 0 && patch.op === "replace") {
        base = patch.value;
        break;
      }
    }
    if (i > -1) {
      patches = patches.slice(i + 1);
    }
    const applyPatchesImpl = getPlugin("Patches").applyPatches_;
    if (isDraft(base)) {
      return applyPatchesImpl(base, patches);
    }
    return this.produce(
      base,
      (draft) => applyPatchesImpl(draft, patches)
    );
  }
};
function createProxy(value, parent) {
  const draft = isMap(value) ? getPlugin("MapSet").proxyMap_(value, parent) : isSet(value) ? getPlugin("MapSet").proxySet_(value, parent) : createProxyProxy(value, parent);
  const scope = parent ? parent.scope_ : getCurrentScope();
  scope.drafts_.push(draft);
  return draft;
}

// src/core/current.ts
function current(value) {
  if (!isDraft(value))
    die(10, value);
  return currentImpl(value);
}
function currentImpl(value) {
  if (!isDraftable(value) || isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  let copy;
  let strict = true;
  if (state) {
    if (!state.modified_)
      return state.base_;
    state.finalized_ = true;
    copy = shallowCopy(value, state.scope_.immer_.useStrictShallowCopy_);
    strict = state.scope_.immer_.shouldUseStrictIteration();
  } else {
    copy = shallowCopy(value, true);
  }
  each(
    copy,
    (key, childValue) => {
      set(copy, key, currentImpl(childValue));
    },
    strict
  );
  if (state) {
    state.finalized_ = false;
  }
  return copy;
}

// src/plugins/patches.ts
function enablePatches() {
  const errorOffset = 16;
  if (process.env.NODE_ENV !== "production") {
    errors.push(
      'Sets cannot have "replace" patches.',
      function(op) {
        return "Unsupported patch operation: " + op;
      },
      function(path) {
        return "Cannot apply patch, path doesn't resolve: " + path;
      },
      "Patching reserved attributes like __proto__, prototype and constructor is not allowed"
    );
  }
  const REPLACE = "replace";
  const ADD = "add";
  const REMOVE = "remove";
  function generatePatches_(state, basePath, patches, inversePatches) {
    switch (state.type_) {
      case 0 /* Object */:
      case 2 /* Map */:
        return generatePatchesFromAssigned(
          state,
          basePath,
          patches,
          inversePatches
        );
      case 1 /* Array */:
        return generateArrayPatches(state, basePath, patches, inversePatches);
      case 3 /* Set */:
        return generateSetPatches(
          state,
          basePath,
          patches,
          inversePatches
        );
    }
  }
  function generateArrayPatches(state, basePath, patches, inversePatches) {
    let { base_, assigned_ } = state;
    let copy_ = state.copy_;
    if (copy_.length < base_.length) {
      [base_, copy_] = [copy_, base_];
      [patches, inversePatches] = [inversePatches, patches];
    }
    for (let i = 0; i < base_.length; i++) {
      if (assigned_[i] && copy_[i] !== base_[i]) {
        const path = basePath.concat([i]);
        patches.push({
          op: REPLACE,
          path,
          // Need to maybe clone it, as it can in fact be the original value
          // due to the base/copy inversion at the start of this function
          value: clonePatchValueIfNeeded(copy_[i])
        });
        inversePatches.push({
          op: REPLACE,
          path,
          value: clonePatchValueIfNeeded(base_[i])
        });
      }
    }
    for (let i = base_.length; i < copy_.length; i++) {
      const path = basePath.concat([i]);
      patches.push({
        op: ADD,
        path,
        // Need to maybe clone it, as it can in fact be the original value
        // due to the base/copy inversion at the start of this function
        value: clonePatchValueIfNeeded(copy_[i])
      });
    }
    for (let i = copy_.length - 1; base_.length <= i; --i) {
      const path = basePath.concat([i]);
      inversePatches.push({
        op: REMOVE,
        path
      });
    }
  }
  function generatePatchesFromAssigned(state, basePath, patches, inversePatches) {
    const { base_, copy_ } = state;
    each(state.assigned_, (key, assignedValue) => {
      const origValue = get(base_, key);
      const value = get(copy_, key);
      const op = !assignedValue ? REMOVE : has(base_, key) ? REPLACE : ADD;
      if (origValue === value && op === REPLACE)
        return;
      const path = basePath.concat(key);
      patches.push(op === REMOVE ? { op, path } : { op, path, value });
      inversePatches.push(
        op === ADD ? { op: REMOVE, path } : op === REMOVE ? { op: ADD, path, value: clonePatchValueIfNeeded(origValue) } : { op: REPLACE, path, value: clonePatchValueIfNeeded(origValue) }
      );
    });
  }
  function generateSetPatches(state, basePath, patches, inversePatches) {
    let { base_, copy_ } = state;
    let i = 0;
    base_.forEach((value) => {
      if (!copy_.has(value)) {
        const path = basePath.concat([i]);
        patches.push({
          op: REMOVE,
          path,
          value
        });
        inversePatches.unshift({
          op: ADD,
          path,
          value
        });
      }
      i++;
    });
    i = 0;
    copy_.forEach((value) => {
      if (!base_.has(value)) {
        const path = basePath.concat([i]);
        patches.push({
          op: ADD,
          path,
          value
        });
        inversePatches.unshift({
          op: REMOVE,
          path,
          value
        });
      }
      i++;
    });
  }
  function generateReplacementPatches_(baseValue, replacement, patches, inversePatches) {
    patches.push({
      op: REPLACE,
      path: [],
      value: replacement === NOTHING ? void 0 : replacement
    });
    inversePatches.push({
      op: REPLACE,
      path: [],
      value: baseValue
    });
  }
  function applyPatches_(draft, patches) {
    patches.forEach((patch) => {
      const { path, op } = patch;
      let base = draft;
      for (let i = 0; i < path.length - 1; i++) {
        const parentType = getArchtype(base);
        let p = path[i];
        if (typeof p !== "string" && typeof p !== "number") {
          p = "" + p;
        }
        if ((parentType === 0 /* Object */ || parentType === 1 /* Array */) && (p === "__proto__" || p === "constructor"))
          die(errorOffset + 3);
        if (typeof base === "function" && p === "prototype")
          die(errorOffset + 3);
        base = get(base, p);
        if (typeof base !== "object")
          die(errorOffset + 2, path.join("/"));
      }
      const type = getArchtype(base);
      const value = deepClonePatchValue(patch.value);
      const key = path[path.length - 1];
      switch (op) {
        case REPLACE:
          switch (type) {
            case 2 /* Map */:
              return base.set(key, value);
            case 3 /* Set */:
              die(errorOffset);
            default:
              return base[key] = value;
          }
        case ADD:
          switch (type) {
            case 1 /* Array */:
              return key === "-" ? base.push(value) : base.splice(key, 0, value);
            case 2 /* Map */:
              return base.set(key, value);
            case 3 /* Set */:
              return base.add(value);
            default:
              return base[key] = value;
          }
        case REMOVE:
          switch (type) {
            case 1 /* Array */:
              return base.splice(key, 1);
            case 2 /* Map */:
              return base.delete(key);
            case 3 /* Set */:
              return base.delete(patch.value);
            default:
              return delete base[key];
          }
        default:
          die(errorOffset + 1, op);
      }
    });
    return draft;
  }
  function deepClonePatchValue(obj) {
    if (!isDraftable(obj))
      return obj;
    if (Array.isArray(obj))
      return obj.map(deepClonePatchValue);
    if (isMap(obj))
      return new Map(
        Array.from(obj.entries()).map(([k, v]) => [k, deepClonePatchValue(v)])
      );
    if (isSet(obj))
      return new Set(Array.from(obj).map(deepClonePatchValue));
    const cloned = Object.create(getPrototypeOf(obj));
    for (const key in obj)
      cloned[key] = deepClonePatchValue(obj[key]);
    if (has(obj, DRAFTABLE))
      cloned[DRAFTABLE] = obj[DRAFTABLE];
    return cloned;
  }
  function clonePatchValueIfNeeded(obj) {
    if (isDraft(obj)) {
      return deepClonePatchValue(obj);
    } else
      return obj;
  }
  loadPlugin("Patches", {
    applyPatches_,
    generatePatches_,
    generateReplacementPatches_
  });
}

// src/immer.ts
var immer = new Immer2();
immer.produce;
var produceWithPatches = /* @__PURE__ */ immer.produceWithPatches.bind(
  immer
);

var __awaiter$d = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
enablePatches();
class SceneItemsApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    getItems(filter) {
        return __awaiter$d(this, void 0, void 0, function* () {
            if (Array.isArray(filter)) {
                const { items } = yield this.messageBus.sendAsync("OBR_SCENE_ITEMS_GET_ITEMS", { ids: filter });
                return items;
            }
            else if (filter) {
                const { items } = yield this.messageBus.sendAsync("OBR_SCENE_ITEMS_GET_ALL_ITEMS", {});
                return items.filter(filter);
            }
            else {
                const { items } = yield this.messageBus.sendAsync("OBR_SCENE_ITEMS_GET_ALL_ITEMS", {});
                return items;
            }
        });
    }
    isItemArray(value) {
        return (Array.isArray(value) && value.every((item) => typeof item !== "string"));
    }
    updateItems(filterOrItems, update) {
        return __awaiter$d(this, void 0, void 0, function* () {
            let items;
            if (this.isItemArray(filterOrItems)) {
                items = filterOrItems;
            }
            else {
                items = yield this.getItems(filterOrItems);
            }
            const [nextState, patches] = produceWithPatches(items, update);
            const nextUpdates = nextState.map((item) => ({
                id: item.id,
                type: item.type,
            }));
            // Use patches to get the partial update keys
            for (const patch of patches) {
                const [index, key] = patch.path;
                if (typeof index === "number" && typeof key === "string") {
                    nextUpdates[index][key] = nextState[index][key];
                }
            }
            // Filter out any update without changes
            const updates = nextUpdates.filter(
            // Ensure that there are updates besides the default ID and type
            (update) => Object.keys(update).length > 2);
            if (updates.length === 0) {
                return;
            }
            yield this.messageBus.sendAsync("OBR_SCENE_ITEMS_UPDATE_ITEMS", {
                updates,
            });
        });
    }
    addItems(items) {
        return __awaiter$d(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_ITEMS_ADD_ITEMS", {
                items,
            });
        });
    }
    deleteItems(ids) {
        return __awaiter$d(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_ITEMS_DELETE_ITEMS", {
                ids,
            });
        });
    }
    getItemAttachments(ids) {
        return __awaiter$d(this, void 0, void 0, function* () {
            const { items } = yield this.messageBus.sendAsync("OBR_SCENE_ITEMS_GET_ITEM_ATTACHMENTS", { ids });
            return items;
        });
    }
    getItemBounds(ids) {
        return __awaiter$d(this, void 0, void 0, function* () {
            const { bounds } = yield this.messageBus.sendAsync("OBR_SCENE_ITEMS_GET_ITEM_BOUNDS", { ids });
            return bounds;
        });
    }
    onChange(callback) {
        const handleChange = (data) => {
            callback(data.items);
        };
        this.messageBus.send("OBR_SCENE_ITEMS_SUBSCRIBE", {});
        this.messageBus.on("OBR_SCENE_ITEMS_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_SCENE_ITEMS_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_SCENE_ITEMS_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$c = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
enablePatches();
class SceneLocalApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    getItems(filter) {
        return __awaiter$c(this, void 0, void 0, function* () {
            if (Array.isArray(filter)) {
                const { items } = yield this.messageBus.sendAsync("OBR_SCENE_LOCAL_GET_ITEMS", { ids: filter });
                return items;
            }
            else if (filter) {
                const { items } = yield this.messageBus.sendAsync("OBR_SCENE_LOCAL_GET_ALL_ITEMS", {});
                return items.filter(filter);
            }
            else {
                const { items } = yield this.messageBus.sendAsync("OBR_SCENE_LOCAL_GET_ALL_ITEMS", {});
                return items;
            }
        });
    }
    isItemArray(value) {
        return (Array.isArray(value) && value.every((item) => typeof item !== "string"));
    }
    updateItems(filterOrItems, update, fastUpdate) {
        return __awaiter$c(this, void 0, void 0, function* () {
            let items;
            if (this.isItemArray(filterOrItems)) {
                items = filterOrItems;
            }
            else {
                items = yield this.getItems(filterOrItems);
            }
            const [nextState, patches] = produceWithPatches(items, update);
            const nextUpdates = nextState.map((item) => ({
                id: item.id,
                type: item.type,
            }));
            // Use patches to get the partial update keys
            for (const patch of patches) {
                const [index, key] = patch.path;
                if (typeof index === "number" && typeof key === "string") {
                    nextUpdates[index][key] = nextState[index][key];
                }
            }
            // Filter out any update without changes
            const updates = nextUpdates.filter(
            // Ensure that there are updates besides the default ID and type
            (update) => Object.keys(update).length > 2);
            if (updates.length === 0) {
                return;
            }
            yield this.messageBus.sendAsync("OBR_SCENE_LOCAL_UPDATE_ITEMS", {
                updates,
                fastUpdate,
            });
        });
    }
    addItems(items) {
        return __awaiter$c(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_LOCAL_ADD_ITEMS", {
                items,
            });
        });
    }
    deleteItems(ids) {
        return __awaiter$c(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_LOCAL_DELETE_ITEMS", {
                ids,
            });
        });
    }
    getItemAttachments(ids) {
        return __awaiter$c(this, void 0, void 0, function* () {
            const { items } = yield this.messageBus.sendAsync("OBR_SCENE_LOCAL_GET_ITEM_ATTACHMENTS", { ids });
            return items;
        });
    }
    getItemBounds(ids) {
        return __awaiter$c(this, void 0, void 0, function* () {
            const { bounds } = yield this.messageBus.sendAsync("OBR_SCENE_LOCAL_GET_ITEM_BOUNDS", { ids });
            return bounds;
        });
    }
    onChange(callback) {
        const handleChange = (data) => {
            callback(data.items);
        };
        this.messageBus.send("OBR_SCENE_LOCAL_SUBSCRIBE", {});
        this.messageBus.on("OBR_SCENE_LOCAL_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_SCENE_LOCAL_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_SCENE_LOCAL_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$b = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class SceneApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
        this.grid = new SceneGridApi(messageBus);
        this.fog = new SceneFogApi(messageBus);
        this.history = new SceneHistoryApi(messageBus);
        this.items = new SceneItemsApi(messageBus);
        this.local = new SceneLocalApi(messageBus);
    }
    isReady() {
        return __awaiter$b(this, void 0, void 0, function* () {
            const { ready } = yield this.messageBus.sendAsync("OBR_SCENE_IS_READY", {});
            return ready;
        });
    }
    onReadyChange(callback) {
        const handleChange = (data) => {
            callback(data.ready);
        };
        this.messageBus.send("OBR_SCENE_READY_SUBSCRIBE", {});
        this.messageBus.on("OBR_SCENE_EVENT_READY_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_SCENE_READY_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_SCENE_EVENT_READY_CHANGE", handleChange);
        };
    }
    getMetadata() {
        return __awaiter$b(this, void 0, void 0, function* () {
            const { metadata } = yield this.messageBus.sendAsync("OBR_SCENE_GET_METADATA", {});
            return metadata;
        });
    }
    setMetadata(update) {
        return __awaiter$b(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_SCENE_SET_METADATA", { update });
        });
    }
    onMetadataChange(callback) {
        const handleChange = (data) => {
            callback(data.metadata);
        };
        this.messageBus.send("OBR_SCENE_METADATA_SUBSCRIBE", {});
        this.messageBus.on("OBR_SCENE_METADATA_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_SCENE_METADATA_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_SCENE_METADATA_EVENT_CHANGE", handleChange);
        };
    }
}

function normalizeUrl(url) {
    return url.startsWith("http") ? url : `${window.location.origin}${url}`;
}
/**
 * Normalize icon paths so that relative paths are transformed into absolute paths
 */
function normalizeIconPaths(icons) {
    return icons.map((base) => (Object.assign(Object.assign({}, base), { icon: normalizeUrl(base.icon) })));
}
/**
 * Normalize an object with a url property so that relative paths are transformed into absolute paths
 */
function normalizeUrlObject(urlObject) {
    return Object.assign(Object.assign({}, urlObject), { url: normalizeUrl(urlObject.url) });
}

var __awaiter$a = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class ContextMenuApi {
    constructor(messageBus) {
        this.contextMenus = {};
        this.handleClick = (event) => {
            var _a;
            const menu = this.contextMenus[event.id];
            if (menu) {
                (_a = menu.onClick) === null || _a === void 0 ? void 0 : _a.call(menu, event.context, event.elementId);
            }
        };
        this.messageBus = messageBus;
        messageBus.on("OBR_CONTEXT_MENU_EVENT_CLICK", this.handleClick);
    }
    create(contextMenu) {
        return __awaiter$a(this, void 0, void 0, function* () {
            this.messageBus.sendAsync("OBR_CONTEXT_MENU_CREATE", {
                id: contextMenu.id,
                shortcut: contextMenu.shortcut,
                icons: normalizeIconPaths(contextMenu.icons),
                embed: contextMenu.embed && normalizeUrlObject(contextMenu.embed),
            });
            this.contextMenus[contextMenu.id] = contextMenu;
        });
    }
    remove(id) {
        return __awaiter$a(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_CONTEXT_MENU_REMOVE", { id });
            delete this.contextMenus[id];
        });
    }
}

var __awaiter$9 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class ToolApi {
    constructor(messageBus) {
        this.tools = {};
        this.toolActions = {};
        this.toolModes = {};
        this.handleToolClick = (event) => {
            const tool = this.tools[event.id];
            if (tool) {
                if (tool.onClick) {
                    const result = tool.onClick(event.context, event.elementId);
                    Promise.resolve(result).then((activate) => {
                        if (activate) {
                            this.messageBus.send("OBR_TOOL_ACTIVATE", {
                                id: event.id,
                            });
                        }
                    });
                }
                else {
                    this.messageBus.send("OBR_TOOL_ACTIVATE", {
                        id: event.id,
                    });
                }
            }
        };
        this.handleToolActionClick = (event) => {
            var _a;
            const action = this.toolActions[event.id];
            if (action) {
                (_a = action.onClick) === null || _a === void 0 ? void 0 : _a.call(action, event.context, event.elementId);
            }
        };
        this.handleToolModeClick = (event) => {
            const mode = this.toolModes[event.id];
            if (mode) {
                if (mode.onClick) {
                    const result = mode.onClick(event.context, event.elementId);
                    Promise.resolve(result).then((activate) => {
                        if (activate) {
                            this.messageBus.send("OBR_TOOL_MODE_ACTIVATE", {
                                toolId: event.context.activeTool,
                                modeId: event.id,
                            });
                        }
                    });
                }
                else {
                    this.messageBus.send("OBR_TOOL_MODE_ACTIVATE", {
                        toolId: event.context.activeTool,
                        modeId: event.id,
                    });
                }
            }
        };
        this.handleToolModeToolClick = (event) => {
            const mode = this.toolModes[event.id];
            if (mode) {
                if (mode.onToolClick) {
                    const result = mode.onToolClick(event.context, event.event);
                    Promise.resolve(result).then((select) => {
                        if (select && event.event.target && !event.event.target.locked) {
                            this.messageBus.sendAsync("OBR_PLAYER_SELECT", {
                                items: [event.event.target.id],
                            });
                        }
                    });
                }
                else {
                    if (event.event.target && !event.event.target.locked) {
                        this.messageBus.sendAsync("OBR_PLAYER_SELECT", {
                            items: [event.event.target.id],
                        });
                    }
                }
            }
        };
        this.handleToolModeToolDoubleClick = (event) => {
            const mode = this.toolModes[event.id];
            if (mode) {
                if (mode.onToolDoubleClick) {
                    const result = mode.onToolDoubleClick(event.context, event.event);
                    Promise.resolve(result).then((select) => {
                        if (select && event.event.target) {
                            this.messageBus.sendAsync("OBR_PLAYER_SELECT", {
                                items: [event.event.target.id],
                            });
                        }
                    });
                }
                else {
                    if (event.event.target) {
                        this.messageBus.sendAsync("OBR_PLAYER_SELECT", {
                            items: [event.event.target.id],
                        });
                    }
                }
            }
        };
        this.handleToolModeToolDown = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onToolDown) === null || _a === void 0 ? void 0 : _a.call(mode, event.context, event.event);
            }
        };
        this.handleToolModeToolMove = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onToolMove) === null || _a === void 0 ? void 0 : _a.call(mode, event.context, event.event);
            }
        };
        this.handleToolModeToolUp = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onToolUp) === null || _a === void 0 ? void 0 : _a.call(mode, event.context, event.event);
            }
        };
        this.handleToolModeToolDragStart = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onToolDragStart) === null || _a === void 0 ? void 0 : _a.call(mode, event.context, event.event);
            }
        };
        this.handleToolModeToolDragMove = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onToolDragMove) === null || _a === void 0 ? void 0 : _a.call(mode, event.context, event.event);
            }
        };
        this.handleToolModeToolDragEnd = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onToolDragEnd) === null || _a === void 0 ? void 0 : _a.call(mode, event.context, event.event);
            }
        };
        this.handleToolModeToolDragCancel = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onToolDragCancel) === null || _a === void 0 ? void 0 : _a.call(mode, event.context, event.event);
            }
        };
        this.handleToolModeKeyDown = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onKeyDown) === null || _a === void 0 ? void 0 : _a.call(mode, event.context, event.event);
            }
        };
        this.handleToolModeKeyUp = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onKeyUp) === null || _a === void 0 ? void 0 : _a.call(mode, event.context, event.event);
            }
        };
        this.handleToolModeActivate = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onActivate) === null || _a === void 0 ? void 0 : _a.call(mode, event.context);
            }
        };
        this.handleToolModeDeactivate = (event) => {
            var _a;
            const mode = this.toolModes[event.id];
            if (mode) {
                (_a = mode.onDeactivate) === null || _a === void 0 ? void 0 : _a.call(mode, event.context);
            }
        };
        this.messageBus = messageBus;
        messageBus.on("OBR_TOOL_EVENT_CLICK", this.handleToolClick);
        messageBus.on("OBR_TOOL_ACTION_EVENT_CLICK", this.handleToolActionClick);
        messageBus.on("OBR_TOOL_MODE_EVENT_CLICK", this.handleToolModeClick);
        messageBus.on("OBR_TOOL_MODE_EVENT_TOOL_CLICK", this.handleToolModeToolClick);
        messageBus.on("OBR_TOOL_MODE_EVENT_TOOL_DOUBLE_CLICK", this.handleToolModeToolDoubleClick);
        messageBus.on("OBR_TOOL_MODE_EVENT_TOOL_DOWN", this.handleToolModeToolDown);
        messageBus.on("OBR_TOOL_MODE_EVENT_TOOL_MOVE", this.handleToolModeToolMove);
        messageBus.on("OBR_TOOL_MODE_EVENT_TOOL_UP", this.handleToolModeToolUp);
        messageBus.on("OBR_TOOL_MODE_EVENT_TOOL_DRAG_START", this.handleToolModeToolDragStart);
        messageBus.on("OBR_TOOL_MODE_EVENT_TOOL_DRAG_MOVE", this.handleToolModeToolDragMove);
        messageBus.on("OBR_TOOL_MODE_EVENT_TOOL_DRAG_END", this.handleToolModeToolDragEnd);
        messageBus.on("OBR_TOOL_MODE_EVENT_TOOL_DRAG_CANCEL", this.handleToolModeToolDragCancel);
        messageBus.on("OBR_TOOL_MODE_EVENT_KEY_DOWN", this.handleToolModeKeyDown);
        messageBus.on("OBR_TOOL_MODE_EVENT_KEY_UP", this.handleToolModeKeyUp);
        messageBus.on("OBR_TOOL_MODE_EVENT_ACTIVATE", this.handleToolModeActivate);
        messageBus.on("OBR_TOOL_MODE_EVENT_DEACTIVATE", this.handleToolModeDeactivate);
    }
    create(tool) {
        return __awaiter$9(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_TOOL_CREATE", {
                id: tool.id,
                shortcut: tool.shortcut,
                defaultMode: tool.defaultMode,
                defaultMetadata: tool.defaultMetadata,
                icons: normalizeIconPaths(tool.icons),
                disabled: tool.disabled,
            });
            this.tools[tool.id] = tool;
        });
    }
    remove(id) {
        return __awaiter$9(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_TOOL_REMOVE", { id });
            delete this.tools[id];
        });
    }
    activateTool(id) {
        return __awaiter$9(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_TOOL_ACTIVATE", { id });
        });
    }
    getActiveTool() {
        return __awaiter$9(this, void 0, void 0, function* () {
            const { id } = yield this.messageBus.sendAsync("OBR_TOOL_GET_ACTIVE", {});
            return id;
        });
    }
    onToolChange(callback) {
        const handleChange = (data) => {
            callback(data.id);
        };
        this.messageBus.send("OBR_TOOL_ACTIVE_SUBSCRIBE", {});
        this.messageBus.on("OBR_TOOL_ACTIVE_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_TOOL_ACTIVE_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_TOOL_ACTIVE_EVENT_CHANGE", handleChange);
        };
    }
    getMetadata(id) {
        return __awaiter$9(this, void 0, void 0, function* () {
            const { metadata } = yield this.messageBus.sendAsync("OBR_TOOL_GET_METADATA", { id });
            return metadata;
        });
    }
    setMetadata(toolId, update) {
        return __awaiter$9(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_TOOL_SET_METADATA", {
                toolId,
                update,
            });
        });
    }
    createAction(action) {
        return __awaiter$9(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_TOOL_ACTION_CREATE", {
                id: action.id,
                shortcut: action.shortcut,
                icons: normalizeIconPaths(action.icons),
                disabled: action.disabled,
            });
            this.toolActions[action.id] = action;
        });
    }
    removeAction(id) {
        return __awaiter$9(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_TOOL_ACTION_REMOVE", { id });
            delete this.tools[id];
        });
    }
    createMode(mode) {
        return __awaiter$9(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_TOOL_MODE_CREATE", {
                id: mode.id,
                shortcut: mode.shortcut,
                icons: normalizeIconPaths(mode.icons),
                preventDrag: mode.preventDrag,
                disabled: mode.disabled,
                cursors: mode.cursors,
            });
            this.toolModes[mode.id] = mode;
        });
    }
    removeMode(id) {
        return __awaiter$9(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_TOOL_MODE_REMOVE", { id });
            delete this.tools[id];
        });
    }
    activateMode(toolId, modeId) {
        return __awaiter$9(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_TOOL_MODE_ACTIVATE", {
                toolId,
                modeId,
            });
        });
    }
    getActiveToolMode() {
        return __awaiter$9(this, void 0, void 0, function* () {
            const { id } = yield this.messageBus.sendAsync("OBR_TOOL_MODE_GET_ACTIVE", {});
            return id;
        });
    }
    onToolModeChange(callback) {
        const handleChange = (data) => {
            callback(data.id);
        };
        this.messageBus.send("OBR_TOOL_MODE_ACTIVE_SUBSCRIBE", {});
        this.messageBus.on("OBR_TOOL_MODE_ACTIVE_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_TOOL_MODE_ACTIVE_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_TOOL_MODE_ACTIVE_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$8 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class PopoverApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    open(popover) {
        return __awaiter$8(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_POPOVER_OPEN", Object.assign({}, normalizeUrlObject(popover)));
        });
    }
    close(id) {
        return __awaiter$8(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_POPOVER_CLOSE", { id });
        });
    }
    getWidth(id) {
        return __awaiter$8(this, void 0, void 0, function* () {
            const { width } = yield this.messageBus.sendAsync("OBR_POPOVER_GET_WIDTH", { id });
            return width;
        });
    }
    setWidth(id, width) {
        return __awaiter$8(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_POPOVER_SET_WIDTH", { id, width });
        });
    }
    getHeight(id) {
        return __awaiter$8(this, void 0, void 0, function* () {
            const { height } = yield this.messageBus.sendAsync("OBR_POPOVER_GET_HEIGHT", { id });
            return height;
        });
    }
    setHeight(id, height) {
        return __awaiter$8(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_POPOVER_SET_HEIGHT", { id, height });
        });
    }
}

var __awaiter$7 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class ModalApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    open(modal) {
        return __awaiter$7(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_MODAL_OPEN", Object.assign({}, normalizeUrlObject(modal)));
        });
    }
    close(id) {
        return __awaiter$7(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_MODAL_CLOSE", { id });
        });
    }
}

var __awaiter$6 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class ActionApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    getWidth() {
        return __awaiter$6(this, void 0, void 0, function* () {
            const { width } = yield this.messageBus.sendAsync("OBR_ACTION_GET_WIDTH", {});
            return width;
        });
    }
    setWidth(width) {
        return __awaiter$6(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ACTION_SET_WIDTH", { width });
        });
    }
    getHeight() {
        return __awaiter$6(this, void 0, void 0, function* () {
            const { height } = yield this.messageBus.sendAsync("OBR_ACTION_GET_HEIGHT", {});
            return height;
        });
    }
    setHeight(height) {
        return __awaiter$6(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ACTION_SET_HEIGHT", { height });
        });
    }
    getBadgeText() {
        return __awaiter$6(this, void 0, void 0, function* () {
            const { badgeText } = yield this.messageBus.sendAsync("OBR_ACTION_GET_BADGE_TEXT", {});
            return badgeText;
        });
    }
    setBadgeText(badgeText) {
        return __awaiter$6(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ACTION_SET_BADGE_TEXT", { badgeText });
        });
    }
    getBadgeBackgroundColor() {
        return __awaiter$6(this, void 0, void 0, function* () {
            const { badgeBackgroundColor } = yield this.messageBus.sendAsync("OBR_ACTION_GET_BADGE_BACKGROUND_COLOR", {});
            return badgeBackgroundColor;
        });
    }
    setBadgeBackgroundColor(badgeBackgroundColor) {
        return __awaiter$6(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ACTION_SET_BADGE_BACKGROUND_COLOR", {
                badgeBackgroundColor,
            });
        });
    }
    getIcon() {
        return __awaiter$6(this, void 0, void 0, function* () {
            const { icon } = yield this.messageBus.sendAsync("OBR_ACTION_GET_ICON", {});
            return icon;
        });
    }
    setIcon(icon) {
        return __awaiter$6(this, void 0, void 0, function* () {
            const data = normalizeIconPaths([{ icon }]);
            yield this.messageBus.sendAsync("OBR_ACTION_SET_ICON", {
                icon: data[0].icon,
            });
        });
    }
    getTitle() {
        return __awaiter$6(this, void 0, void 0, function* () {
            const { title } = yield this.messageBus.sendAsync("OBR_ACTION_GET_TITLE", {});
            return title;
        });
    }
    setTitle(title) {
        return __awaiter$6(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ACTION_SET_TITLE", { title });
        });
    }
    isOpen() {
        return __awaiter$6(this, void 0, void 0, function* () {
            const { isOpen } = yield this.messageBus.sendAsync("OBR_ACTION_GET_IS_OPEN", {});
            return isOpen;
        });
    }
    open() {
        return __awaiter$6(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ACTION_OPEN", {});
        });
    }
    close() {
        return __awaiter$6(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ACTION_CLOSE", {});
        });
    }
    onOpenChange(callback) {
        const handleChange = (data) => {
            callback(data.isOpen);
        };
        this.messageBus.send("OBR_ACTION_IS_OPEN_SUBSCRIBE", {});
        this.messageBus.on("OBR_ACTION_IS_OPEN_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_IS_OPEN_ACTION_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_ACTION_IS_OPEN_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$5 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
enablePatches();
class InteractionApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    startItemInteraction(baseState) {
        return __awaiter$5(this, void 0, void 0, function* () {
            const { id } = yield this.messageBus.sendAsync("OBR_INTERACTION_START_ITEM_INTERACTION", { baseState });
            let prev = baseState;
            const dispatcher = (update) => {
                const [next, patches] = produceWithPatches(prev, update);
                prev = next;
                this.messageBus.send("OBR_INTERACTION_UPDATE_ITEM_INTERACTION", {
                    id,
                    patches,
                });
                return next;
            };
            const stop = () => {
                this.messageBus.send("OBR_INTERACTION_STOP_ITEM_INTERACTION", { id });
            };
            return [dispatcher, stop];
        });
    }
}

var __awaiter$4 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class PartyApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    getPlayers() {
        return __awaiter$4(this, void 0, void 0, function* () {
            const { players } = yield this.messageBus.sendAsync("OBR_PARTY_GET_PLAYERS", {});
            return players;
        });
    }
    onChange(callback) {
        const handleChange = (data) => {
            callback(data.players);
        };
        this.messageBus.send("OBR_PARTY_SUBSCRIBE", {});
        this.messageBus.on("OBR_PARTY_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_PARTY_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_PARTY_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$3 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class RoomApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    get id() {
        return this.messageBus.roomId;
    }
    getPermissions() {
        return __awaiter$3(this, void 0, void 0, function* () {
            const { permissions } = yield this.messageBus.sendAsync("OBR_ROOM_GET_PERMISSIONS", {});
            return permissions;
        });
    }
    getMetadata() {
        return __awaiter$3(this, void 0, void 0, function* () {
            const { metadata } = yield this.messageBus.sendAsync("OBR_ROOM_GET_METADATA", {});
            return metadata;
        });
    }
    setMetadata(update) {
        return __awaiter$3(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ROOM_SET_METADATA", { update });
        });
    }
    onMetadataChange(callback) {
        const handleChange = (data) => {
            callback(data.metadata);
        };
        this.messageBus.send("OBR_ROOM_METADATA_SUBSCRIBE", {});
        this.messageBus.on("OBR_ROOM_METADATA_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_METADATA_ROOM_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_ROOM_METADATA_EVENT_CHANGE", handleChange);
        };
    }
    onPermissionsChange(callback) {
        const handleChange = (data) => {
            callback(data.permissions);
        };
        this.messageBus.send("OBR_ROOM_PERMISSIONS_SUBSCRIBE", {});
        this.messageBus.on("OBR_ROOM_PERMISSIONS_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_PERMISSIONS_ROOM_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_ROOM_PERMISSIONS_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$2 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class ThemeApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    getTheme() {
        return __awaiter$2(this, void 0, void 0, function* () {
            const { theme } = yield this.messageBus.sendAsync("OBR_THEME_GET_THEME", {});
            return theme;
        });
    }
    onChange(callback) {
        const handleChange = (data) => {
            callback(data.theme);
        };
        this.messageBus.send("OBR_THEME_SUBSCRIBE", {});
        this.messageBus.on("OBR_THEME_EVENT_CHANGE", handleChange);
        return () => {
            this.messageBus.send("OBR_THEME_UNSUBSCRIBE", {});
            this.messageBus.off("OBR_THEME_EVENT_CHANGE", handleChange);
        };
    }
}

var __awaiter$1 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class AssetsApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    uploadImages(images, typeHint) {
        return __awaiter$1(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ASSETS_UPLOAD_IMAGES", {
                images,
                typeHint,
            });
        });
    }
    uploadScenes(scenes, disableShowScenes) {
        return __awaiter$1(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_ASSETS_UPLOAD_SCENES", {
                scenes,
                disableShowScenes,
            });
        });
    }
    downloadImages(multiple, defaultSearch, typeHint) {
        return __awaiter$1(this, void 0, void 0, function* () {
            const { images } = yield this.messageBus.sendAsync("OBR_ASSETS_DOWNLOAD_IMAGES", { multiple, defaultSearch, typeHint }, -1);
            return images;
        });
    }
    downloadScenes(multiple, defaultSearch) {
        return __awaiter$1(this, void 0, void 0, function* () {
            const { scenes } = yield this.messageBus.sendAsync("OBR_ASSETS_DOWNLOAD_SCENES", { multiple, defaultSearch }, -1);
            return scenes;
        });
    }
}

var __awaiter = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class BroadcastApi {
    constructor(messageBus) {
        this.messageBus = messageBus;
    }
    sendMessage(channel, data, options) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.messageBus.sendAsync("OBR_BROADCAST_SEND_MESSAGE", {
                channel,
                data,
                options,
            });
        });
    }
    onMessage(channel, callback) {
        this.messageBus.send("OBR_BROADCAST_SUBSCRIBE", { channel });
        this.messageBus.on(`OBR_BROADCAST_MESSAGE_${channel}`, callback);
        return () => {
            this.messageBus.send("OBR_BROADCAST_UNSUBSCRIBE", { channel });
            this.messageBus.off(`OBR_BROADCAST_MESSAGE_${channel}`, callback);
        };
    }
}

class GenericItemBuilder {
    constructor(player) {
        this._item = {
            createdUserId: player.id,
            id: v4(),
            name: "Item",
            zIndex: Date.now(),
            lastModified: new Date().toISOString(),
            lastModifiedUserId: player.id,
            locked: false,
            metadata: {},
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
            type: "ITEM",
            visible: true,
            layer: "POPOVER",
        };
    }
    createdUserId(createdUserId) {
        this._item.createdUserId = createdUserId;
        return this.self();
    }
    id(id) {
        this._item.id = id;
        return this.self();
    }
    name(name) {
        this._item.name = name;
        return this.self();
    }
    description(description) {
        this._item.description = description;
        return this.self();
    }
    lastModified(lastModified) {
        this._item.lastModified = lastModified;
        return this.self();
    }
    zIndex(zIndex) {
        this._item.zIndex = zIndex;
        return this.self();
    }
    lastModifiedUserId(lastModifiedUserId) {
        this._item.lastModifiedUserId = lastModifiedUserId;
        return this.self();
    }
    locked(locked) {
        this._item.locked = locked;
        return this.self();
    }
    metadata(metadata) {
        this._item.metadata = metadata;
        return this.self();
    }
    position(position) {
        this._item.position = position;
        return this.self();
    }
    rotation(rotation) {
        this._item.rotation = rotation;
        return this.self();
    }
    scale(scale) {
        this._item.scale = scale;
        return this.self();
    }
    visible(visible) {
        this._item.visible = visible;
        return this.self();
    }
    attachedTo(attachedTo) {
        this._item.attachedTo = attachedTo;
        return this.self();
    }
    layer(layer) {
        this._item.layer = layer;
        return this.self();
    }
    disableHit(disable) {
        this._item.disableHit = disable;
        return this.self();
    }
    disableAutoZIndex(disable) {
        this._item.disableAutoZIndex = disable;
        return this.self();
    }
    disableAttachmentBehavior(disable) {
        this._item.disableAttachmentBehavior = disable;
        return this.self();
    }
    self() {
        // @ts-ignore
        return this;
    }
}

class ImageBuilder extends GenericItemBuilder {
    constructor(player, image, grid) {
        super(player);
        this._image = image;
        this._grid = grid;
        this._item.name = "Image";
        this._text = {
            richText: [
                {
                    type: "paragraph",
                    children: [{ text: "" }],
                },
            ],
            plainText: "",
            style: {
                padding: 8,
                fontFamily: "Roboto",
                fontSize: 24,
                fontWeight: 400,
                textAlign: "CENTER",
                textAlignVertical: "BOTTOM",
                fillColor: "white",
                fillOpacity: 1,
                strokeColor: "white",
                strokeOpacity: 1,
                strokeWidth: 0,
                lineHeight: 1.5,
            },
            type: "PLAIN",
            width: "AUTO",
            height: "AUTO",
        };
        this._textItemType = "LABEL";
    }
    text(text) {
        this._text = text;
        return this.self();
    }
    textItemType(textItemType) {
        this._textItemType = textItemType;
        return this.self();
    }
    textWidth(width) {
        this._text.width = width;
        return this.self();
    }
    textHeight(height) {
        this._text.height = height;
        return this.self();
    }
    richText(richText) {
        this._text.richText = richText;
        return this.self();
    }
    plainText(plainText) {
        this._text.plainText = plainText;
        return this.self();
    }
    textType(textType) {
        this._text.type = textType;
        return this.self();
    }
    textPadding(padding) {
        this._text.style.padding = padding;
        return this.self();
    }
    fontFamily(fontFamily) {
        this._text.style.fontFamily = fontFamily;
        return this.self();
    }
    fontSize(fontSize) {
        this._text.style.fontSize = fontSize;
        return this.self();
    }
    fontWeight(fontWeight) {
        this._text.style.fontWeight = fontWeight;
        return this.self();
    }
    textAlign(textAlign) {
        this._text.style.textAlign = textAlign;
        return this.self();
    }
    textAlignVertical(textAlignVertical) {
        this._text.style.textAlignVertical = textAlignVertical;
        return this.self();
    }
    textFillColor(fillColor) {
        this._text.style.fillColor = fillColor;
        return this.self();
    }
    textFillOpacity(fillOpacity) {
        this._text.style.fillOpacity = fillOpacity;
        return this.self();
    }
    textStrokeColor(strokeColor) {
        this._text.style.strokeColor = strokeColor;
        return this.self();
    }
    textStrokeOpacity(strokeOpacity) {
        this._text.style.strokeOpacity = strokeOpacity;
        return this.self();
    }
    textStrokeWidth(strokeWidth) {
        this._text.style.strokeWidth = strokeWidth;
        return this.self();
    }
    textLineHeight(lineHeight) {
        this._text.style.lineHeight = lineHeight;
        return this.self();
    }
    build() {
        return Object.assign(Object.assign({}, this._item), { type: "IMAGE", image: this._image, grid: this._grid, text: this._text, textItemType: this._textItemType });
    }
}

class LabelBuilder extends GenericItemBuilder {
    constructor(player) {
        super(player);
        this._text = {
            richText: [
                {
                    type: "paragraph",
                    children: [{ text: "" }],
                },
            ],
            plainText: "",
            style: {
                padding: 8,
                fontFamily: "Roboto",
                fontSize: 16,
                fontWeight: 400,
                textAlign: "CENTER",
                textAlignVertical: "MIDDLE",
                fillColor: "white",
                fillOpacity: 1,
                strokeColor: "white",
                strokeOpacity: 1,
                strokeWidth: 0,
                lineHeight: 1.5,
            },
            type: "PLAIN",
            width: "AUTO",
            height: "AUTO",
        };
        this._style = {
            backgroundColor: "#3D4051",
            backgroundOpacity: 1,
            cornerRadius: 8,
            pointerDirection: "DOWN",
            pointerWidth: 4,
            pointerHeight: 4,
        };
        this._item.layer = "TEXT";
        this._item.name = "Label";
    }
    text(text) {
        this._text = text;
        return this.self();
    }
    width(width) {
        this._text.width = width;
        return this.self();
    }
    height(height) {
        this._text.height = height;
        return this.self();
    }
    plainText(plainText) {
        this._text.plainText = plainText;
        return this.self();
    }
    padding(padding) {
        this._text.style.padding = padding;
        return this.self();
    }
    fontFamily(fontFamily) {
        this._text.style.fontFamily = fontFamily;
        return this.self();
    }
    fontSize(fontSize) {
        this._text.style.fontSize = fontSize;
        return this.self();
    }
    fontWeight(fontWeight) {
        this._text.style.fontWeight = fontWeight;
        return this.self();
    }
    textAlign(textAlign) {
        this._text.style.textAlign = textAlign;
        return this.self();
    }
    textAlignVertical(textAlignVertical) {
        this._text.style.textAlignVertical = textAlignVertical;
        return this.self();
    }
    fillColor(fillColor) {
        this._text.style.fillColor = fillColor;
        return this.self();
    }
    fillOpacity(fillOpacity) {
        this._text.style.fillOpacity = fillOpacity;
        return this.self();
    }
    strokeColor(strokeColor) {
        this._text.style.strokeColor = strokeColor;
        return this.self();
    }
    strokeOpacity(strokeOpacity) {
        this._text.style.strokeOpacity = strokeOpacity;
        return this.self();
    }
    strokeWidth(strokeWidth) {
        this._text.style.strokeWidth = strokeWidth;
        return this.self();
    }
    lineHeight(lineHeight) {
        this._text.style.lineHeight = lineHeight;
        return this.self();
    }
    style(style) {
        this._style = style;
        return this.self();
    }
    backgroundColor(backgroundColor) {
        this._style.backgroundColor = backgroundColor;
        return this.self();
    }
    backgroundOpacity(backgroundOpacity) {
        this._style.backgroundOpacity = backgroundOpacity;
        return this.self();
    }
    cornerRadius(cornerRadius) {
        this._style.cornerRadius = cornerRadius;
        return this.self();
    }
    pointerWidth(pointerWidth) {
        this._style.pointerWidth = pointerWidth;
        return this.self();
    }
    pointerHeight(pointerHeight) {
        this._style.pointerHeight = pointerHeight;
        return this.self();
    }
    pointerDirection(pointerDirection) {
        this._style.pointerDirection = pointerDirection;
        return this.self();
    }
    maxViewScale(maxViewScale) {
        this._style.maxViewScale = maxViewScale;
        return this.self();
    }
    minViewScale(minViewScale) {
        this._style.minViewScale = minViewScale;
        return this.self();
    }
    build() {
        return Object.assign(Object.assign({}, this._item), { type: "LABEL", text: this._text, style: this._style });
    }
}

/**
 *  base64.ts
 *
 *  Licensed under the BSD 3-Clause License.
 *    http://opensource.org/licenses/BSD-3-Clause
 *
 *  References:
 *    http://en.wikipedia.org/wiki/Base64
 *
 * @author Dan Kogai (https://github.com/dankogai)
 */
const _hasBuffer = typeof Buffer === 'function';
const _TD = typeof TextDecoder === 'function' ? new TextDecoder() : undefined;
typeof TextEncoder === 'function' ? new TextEncoder() : undefined;
const b64ch = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const b64chs = Array.prototype.slice.call(b64ch);
const b64tab = ((a) => {
    let tab = {};
    a.forEach((c, i) => tab[c] = i);
    return tab;
})(b64chs);
const b64re = /^(?:[A-Za-z\d+\/]{4})*?(?:[A-Za-z\d+\/]{2}(?:==)?|[A-Za-z\d+\/]{3}=?)?$/;
const _fromCC = String.fromCharCode.bind(String);
const _U8Afrom = typeof Uint8Array.from === 'function'
    ? Uint8Array.from.bind(Uint8Array)
    : (it) => new Uint8Array(Array.prototype.slice.call(it, 0));
const _tidyB64 = (s) => s.replace(/[^A-Za-z0-9\+\/]/g, '');
// This trick is found broken https://github.com/dankogai/js-base64/issues/130
// const btou = (src: string) => decodeURIComponent(escape(src));
// reverting good old fationed regexp
const re_btou = /[\xC0-\xDF][\x80-\xBF]|[\xE0-\xEF][\x80-\xBF]{2}|[\xF0-\xF7][\x80-\xBF]{3}/g;
const cb_btou = (cccc) => {
    switch (cccc.length) {
        case 4:
            var cp = ((0x07 & cccc.charCodeAt(0)) << 18)
                | ((0x3f & cccc.charCodeAt(1)) << 12)
                | ((0x3f & cccc.charCodeAt(2)) << 6)
                | (0x3f & cccc.charCodeAt(3)), offset = cp - 0x10000;
            return (_fromCC((offset >>> 10) + 0xD800)
                + _fromCC((offset & 0x3FF) + 0xDC00));
        case 3:
            return _fromCC(((0x0f & cccc.charCodeAt(0)) << 12)
                | ((0x3f & cccc.charCodeAt(1)) << 6)
                | (0x3f & cccc.charCodeAt(2)));
        default:
            return _fromCC(((0x1f & cccc.charCodeAt(0)) << 6)
                | (0x3f & cccc.charCodeAt(1)));
    }
};
/**
 * @deprecated should have been internal use only.
 * @param {string} src UTF-16 string
 * @returns {string} UTF-8 string
 */
const btou = (b) => b.replace(re_btou, cb_btou);
/**
 * polyfill version of `atob`
 */
const atobPolyfill = (asc) => {
    // console.log('polyfilled');
    asc = asc.replace(/\s+/g, '');
    if (!b64re.test(asc))
        throw new TypeError('malformed base64.');
    asc += '=='.slice(2 - (asc.length & 3));
    let u24, r1, r2;
    let binArray = []; // use array to avoid minor gc in loop
    for (let i = 0; i < asc.length;) {
        u24 = b64tab[asc.charAt(i++)] << 18
            | b64tab[asc.charAt(i++)] << 12
            | (r1 = b64tab[asc.charAt(i++)]) << 6
            | (r2 = b64tab[asc.charAt(i++)]);
        if (r1 === 64) {
            binArray.push(_fromCC(u24 >> 16 & 255));
        }
        else if (r2 === 64) {
            binArray.push(_fromCC(u24 >> 16 & 255, u24 >> 8 & 255));
        }
        else {
            binArray.push(_fromCC(u24 >> 16 & 255, u24 >> 8 & 255, u24 & 255));
        }
    }
    return binArray.join('');
};
/**
 * does what `window.atob` of web browsers do.
 * @param {String} asc Base64-encoded string
 * @returns {string} binary string
 */
const _atob = typeof atob === 'function' ? (asc) => atob(_tidyB64(asc))
    : _hasBuffer ? (asc) => Buffer.from(asc, 'base64').toString('binary')
        : atobPolyfill;
//
const _toUint8Array = _hasBuffer
    ? (a) => _U8Afrom(Buffer.from(a, 'base64'))
    : (a) => _U8Afrom(_atob(a).split('').map(c => c.charCodeAt(0)));
//
const _decode = _hasBuffer
    ? (a) => Buffer.from(a, 'base64').toString('utf8')
    : _TD
        ? (a) => _TD.decode(_toUint8Array(a))
        : (a) => btou(_atob(a));
const _unURI = (a) => _tidyB64(a.replace(/[-_]/g, (m0) => m0 == '-' ? '+' : '/'));
/**
 * converts a Base64 string to a UTF-8 string.
 * @param {String} src Base64 string.  Both normal and URL-safe are supported
 * @returns {string} UTF-8 string
 */
const decode = (src) => _decode(_unURI(src));

function getDetails() {
    const urlSearchParams = new URLSearchParams(window.location.search);
    const ref = urlSearchParams.get("obrref");
    let origin = "";
    let roomId = "";
    if (ref) {
        const decodedRef = decode(ref);
        const parts = decodedRef.split(" ");
        if (parts.length === 2) {
            origin = parts[0];
            roomId = parts[1];
        }
    }
    return { origin, roomId };
}

var Command;
(function (Command) {
    Command[Command["MOVE"] = 0] = "MOVE";
    Command[Command["LINE"] = 1] = "LINE";
    Command[Command["QUAD"] = 2] = "QUAD";
    Command[Command["CONIC"] = 3] = "CONIC";
    Command[Command["CUBIC"] = 4] = "CUBIC";
    Command[Command["CLOSE"] = 5] = "CLOSE";
})(Command || (Command = {}));

const details = getDetails();
const messageBus = new MessageBus(details.origin, details.roomId);
const viewportApi = new ViewportApi(messageBus);
const playerApi = new PlayerApi(messageBus);
const partyApi = new PartyApi(messageBus);
const notificationApi = new NotificationApi(messageBus);
const sceneApi = new SceneApi(messageBus);
const contextMenuApi = new ContextMenuApi(messageBus);
const toolApi = new ToolApi(messageBus);
const popoverApi = new PopoverApi(messageBus);
const modalApi = new ModalApi(messageBus);
const actionApi = new ActionApi(messageBus);
const interactionApi = new InteractionApi(messageBus);
const roomApi = new RoomApi(messageBus);
const themeApi = new ThemeApi(messageBus);
const assetsApi = new AssetsApi(messageBus);
const broadcastApi = new BroadcastApi(messageBus);
const OBR = {
    onReady: (callback) => {
        // If we're already ready then callback immediately
        if (messageBus.ready) {
            callback();
        }
        else {
            messageBus.once("OBR_READY", () => callback());
        }
    },
    get isReady() {
        return messageBus.ready;
    },
    viewport: viewportApi,
    player: playerApi,
    party: partyApi,
    notification: notificationApi,
    scene: sceneApi,
    contextMenu: contextMenuApi,
    tool: toolApi,
    popover: popoverApi,
    modal: modalApi,
    action: actionApi,
    interaction: interactionApi,
    room: roomApi,
    theme: themeApi,
    assets: assetsApi,
    broadcast: broadcastApi,
    /** True if the current site is embedded in an instance of Owlbear Rodeo */
    isAvailable: Boolean(details.origin),
};
function buildImage(image, grid) {
    return new ImageBuilder(playerApi, image, grid);
}
function buildLabel() {
    return new LabelBuilder(playerApi);
}

function isInOwlbearFrame() {
  return window.parent !== window;
}

async function loadOwlbearSdk(timeoutMs = 5000) {
  if (!isInOwlbearFrame() || !OBR.isAvailable) {
    throw new Error("Esta página precisa estar aberta dentro do Owlbear Rodeo.");
  }

  if (OBR.isReady) {
    return { OBR, sdk: { buildImage, buildLabel } };
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("O Owlbear não respondeu a tempo."));
      }
    }, timeoutMs);

    OBR.onReady(() => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve();
      }
    });
  });

  return { OBR, sdk: { buildImage, buildLabel } };
}

async function setupContextMenu() {
  const { OBR, sdk } = await loadOwlbearSdk(20000);
  let lastCardSelection = [];
  let lastDeckSelection = [];

  async function rememberCardSelection(selection) {
    if (!selection?.length) {
      return;
    }

    const selectedItems = await OBR.scene.items.getItems(selection);
    const cardIds = getDoubleSidedCards(selectedItems).map((item) => item.id);

    if (cardIds.length) {
      lastCardSelection = cardIds;
    }
  }

  async function rememberDeckSelection(selection) {
    if (!selection?.length) {
      return;
    }

    const selectedItems = await OBR.scene.items.getItems(selection);
    const deckIds = getDeckItems(selectedItems).map((item) => item.id);

    if (deckIds.length) {
      lastDeckSelection = deckIds;
    }
  }

  async function getAnchorItems(fallbackSelection = []) {
    const selection = await OBR.player.getSelection();
    const itemIds = selection?.length ? selection : fallbackSelection;

    if (!itemIds.length) {
      return [];
    }

    try {
      return await OBR.scene.items.getItems(itemIds);
    } catch {
      return [];
    }
  }

  async function showActionResult(count, singular, plural, warning, anchorItems = []) {
    if (!count) {
      await OBR.notification.show(warning, "WARNING");
      return;
    }

    const message = count === 1 ? singular : plural(count);
    await showActionFeedback(OBR, sdk.buildLabel, message, anchorItems);
  }

  function cardMetadataFilter() {
    return [
      { key: ["metadata", METADATA_KEY], value: undefined, operator: "!=" },
      { key: ["metadata", LEGACY_METADATA_KEY], value: undefined, operator: "!=" },
    ];
  }

  function deckMetadataFilter() {
    return [
      { key: ["metadata", DECK_METADATA_KEY], value: undefined, operator: "!=" },
      { key: ["metadata", LEGACY_DECK_METADATA_KEY], value: undefined, operator: "!=" },
    ];
  }

  rememberCardSelection(await OBR.player.getSelection()).catch((error) => {
    console.warn("Unable to read initial card selection", error);
  });
  rememberDeckSelection(await OBR.player.getSelection()).catch((error) => {
    console.warn("Unable to read initial deck selection", error);
  });

  OBR.player.onChange((player) => {
    rememberCardSelection(player.selection).catch((error) => {
      console.warn("Unable to update card selection", error);
    });
    rememberDeckSelection(player.selection).catch((error) => {
      console.warn("Unable to update deck selection", error);
    });
  });
  syncDeckDisplays(OBR, await OBR.scene.items.getItems()).catch((error) => {
    console.warn("Unable to sync deck counters", error);
  });
  OBR.scene.items.onChange((items) => {
    syncDeckDisplays(OBR, items).catch((error) => {
      console.warn("Unable to sync changed deck counters", error);
    });
  });

  await OBR.contextMenu.create({
    id: `${EXTENSION_ID}/flip`,
    icons: [
      {
        icon: "icons/flip.svg",
        label: "Virar carta",
        filter: {
          permissions: ["UPDATE"],
          every: [{ key: "type", value: "IMAGE" }],
          some: cardMetadataFilter(),
        },
      },
    ],
    async onClick(context) {
      const count = await flipItems(OBR, context.items);
      await showActionResult(
        count,
        "Carta virada.",
        (total) => `${total} cartas viradas.`,
        "Selecione uma carta dupla para virar.",
        context.items,
      );
    },
  });

  await OBR.contextMenu.create({
    id: `${EXTENSION_ID}/draw-from-deck`,
    icons: [
      {
        icon: "icons/draw.svg",
        label: "Comprar carta",
        filter: {
          permissions: ["UPDATE"],
          every: [{ key: "type", value: "IMAGE" }],
          some: deckMetadataFilter(),
        },
      },
    ],
    async onClick(context) {
      const count = await drawFromDecks(OBR, sdk.buildImage, context.items);
      await showActionResult(
        count,
        "Carta comprada.",
        (total) => `${total} cartas compradas.`,
        "A pilha esta vazia.",
        context.items,
      );
    },
  });

  await OBR.contextMenu.create({
    id: `${EXTENSION_ID}/shuffle-deck`,
    icons: [
      {
        icon: "icons/shuffle.svg",
        label: "Embaralhar pilha",
        filter: {
          permissions: ["UPDATE"],
          every: [{ key: "type", value: "IMAGE" }],
          some: deckMetadataFilter(),
        },
      },
    ],
    async onClick(context) {
      const count = await shuffleDecks(OBR, context.items);
      await showActionResult(
        count,
        "Pilha embaralhada.",
        (total) => `${total} pilhas embaralhadas.`,
        "A pilha precisa ter pelo menos duas cartas.",
        context.items,
      );
    },
  });

  await OBR.contextMenu.create({
    id: `${EXTENSION_ID}/return-to-deck`,
    icons: [
      {
        icon: "icons/return.svg",
        label: "Devolver para pilha",
        filter: {
          permissions: ["UPDATE", "DELETE"],
          every: [{ key: "type", value: "IMAGE" }],
          some: cardMetadataFilter(),
        },
      },
    ],
    async onClick(context) {
      const count = await returnCardsToDeck(OBR, context.items, lastDeckSelection);
      await showActionResult(
        count,
        "Carta devolvida para a pilha.",
        (total) => `${total} cartas devolvidas para a pilha.`,
        "Selecione uma carta e tenha uma pilha alvo selecionada recentemente.",
        context.items,
      );
    },
  });

  await OBR.tool.remove(`${EXTENSION_ID}/flip-tool`).catch(() => {});

  await OBR.tool.createAction({
    id: `${EXTENSION_ID}/flip-action`,
    icons: [
      {
        icon: "icons/flip.svg",
        label: "Virar carta",
      },
    ],
    shortcut: "V",
    async onClick() {
      const anchors = await getAnchorItems(lastCardSelection);
      const count = await flipSelectedItems(OBR, lastCardSelection);
      await showActionResult(
        count,
        "Carta virada.",
        (total) => `${total} cartas viradas.`,
        "Selecione uma carta dupla para virar.",
        anchors,
      );
    },
  });

  await OBR.tool.createAction({
    id: `${EXTENSION_ID}/draw-action`,
    icons: [
      {
        icon: "icons/draw.svg",
        label: "Comprar carta",
      },
    ],
    async onClick() {
      const anchors = await getAnchorItems(lastDeckSelection);
      const count = await drawSelectedDecks(OBR, sdk.buildImage, lastDeckSelection);
      await showActionResult(
        count,
        "Carta comprada.",
        (total) => `${total} cartas compradas.`,
        "Selecione uma pilha com cartas para comprar.",
        anchors,
      );
    },
  });

  await OBR.tool.createAction({
    id: `${EXTENSION_ID}/shuffle-action`,
    icons: [
      {
        icon: "icons/shuffle.svg",
        label: "Embaralhar pilha",
      },
    ],
    async onClick() {
      const anchors = await getAnchorItems(lastDeckSelection);
      const count = await shuffleSelectedDecks(OBR, lastDeckSelection);
      await showActionResult(
        count,
        "Pilha embaralhada.",
        (total) => `${total} pilhas embaralhadas.`,
        "Selecione uma pilha com pelo menos duas cartas.",
        anchors,
      );
    },
  });

  await OBR.tool.createAction({
    id: `${EXTENSION_ID}/return-action`,
    icons: [
      {
        icon: "icons/return.svg",
        label: "Devolver para pilha",
      },
    ],
    async onClick() {
      const anchors = await getAnchorItems(lastCardSelection);
      const count = await returnSelectedCardsToDeck(
        OBR,
        lastCardSelection,
        lastDeckSelection,
      );
      await showActionResult(
        count,
        "Carta devolvida para a pilha.",
        (total) => `${total} cartas devolvidas para a pilha.`,
        "Selecione uma carta comprada e uma pilha alvo.",
        anchors,
      );
    },
  });
}

setupContextMenu().catch((error) => {
  console.error("Double-Sided Cards background error", error);
});
