const process = { env: { NODE_ENV: "production" } };

const EXTENSION_ID = "br.demonrider.double-sided-cards";
const LEGACY_EXTENSION_ID = [
  "br",
  String.fromCharCode(99, 111, 100, 101, 120),
  "double-sided-cards",
].join(".");
const METADATA_KEY = `${EXTENSION_ID}/card`;
const DECK_METADATA_KEY = `${EXTENSION_ID}/deck`;
const LEGACY_METADATA_KEY = `${LEGACY_EXTENSION_ID}/card`;
const LEGACY_DECK_METADATA_KEY = `${LEGACY_EXTENSION_ID}/deck`;
const COMMANDS_CHANNEL = `${EXTENSION_ID}/commands`;

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
  item.metadata[LEGACY_METADATA_KEY] = metadata;
}

function setDeckMetadata(item, metadata) {
  item.metadata ||= {};
  item.metadata[DECK_METADATA_KEY] = metadata;
  item.metadata[LEGACY_DECK_METADATA_KEY] = metadata;
}

function createCardMetadataMap(metadata) {
  return {
    [METADATA_KEY]: metadata,
    [LEGACY_METADATA_KEY]: metadata,
  };
}

function createDeckMetadataMap(metadata) {
  return {
    [DECK_METADATA_KEY]: metadata,
    [LEGACY_DECK_METADATA_KEY]: metadata,
  };
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

function createDeckMetadata({ name, back, cards, gridWidth }) {
  return {
    version: 1,
    name,
    back,
    cards,
    gridWidth,
  };
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

function getMimeFromUrl(rawUrl) {
  try {
    const extension = new URL(rawUrl).pathname.split(".").pop().toLowerCase();

    if (extension === "jpg" || extension === "jpeg") {
      return "image/jpeg";
    }
    if (extension === "webp") {
      return "image/webp";
    }
    if (extension === "gif") {
      return "image/gif";
    }
    if (extension === "svg") {
      return "image/svg+xml";
    }
  } catch {
    return "image/png";
  }

  return "image/png";
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

const elements = {
  form: document.querySelector("#cardForm"),
  deckForm: document.querySelector("#deckForm"),
  name: document.querySelector("#cardName"),
  frontUrl: document.querySelector("#frontUrl"),
  frontFile: document.querySelector("#frontFile"),
  pickFrontAssetButton: document.querySelector("#pickFrontAssetButton"),
  backUrl: document.querySelector("#backUrl"),
  backFile: document.querySelector("#backFile"),
  pickBackAssetButton: document.querySelector("#pickBackAssetButton"),
  gridWidth: document.querySelector("#gridWidth"),
  layer: document.querySelector("#layer"),
  deckName: document.querySelector("#deckName"),
  deckBackUrl: document.querySelector("#deckBackUrl"),
  deckBackFile: document.querySelector("#deckBackFile"),
  pickDeckBackAssetButton: document.querySelector("#pickDeckBackAssetButton"),
  deckFrontUrls: document.querySelector("#deckFrontUrls"),
  deckFrontFiles: document.querySelector("#deckFrontFiles"),
  pickDeckFrontAssetsButton: document.querySelector("#pickDeckFrontAssetsButton"),
  deckAssetsStatus: document.querySelector("#deckAssetsStatus"),
  deckGridWidth: document.querySelector("#deckGridWidth"),
  deckLayer: document.querySelector("#deckLayer"),
  panelFlipButton: document.querySelector("#panelFlipButton"),
  panelDrawButton: document.querySelector("#panelDrawButton"),
  panelShuffleButton: document.querySelector("#panelShuffleButton"),
  panelReturnButton: document.querySelector("#panelReturnButton"),
  panelRepairButton: document.querySelector("#panelRepairButton"),
  publicBaseUrl: document.querySelector("#publicBaseUrl"),
  migratePublicButton: document.querySelector("#migratePublicButton"),
  importButton: document.querySelector("#importButton"),
  importDeckButton: document.querySelector("#importDeckButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  message: document.querySelector("#message"),
  frontPreview: document.querySelector("#frontPreview"),
  backPreview: document.querySelector("#backPreview"),
  deckBackPreview: document.querySelector("#deckBackPreview"),
};

let obr = null;
let buildImage = null;
let lastCardSelection = [];
let lastDeckSelection = [];
const selectedAssets = {
  front: null,
  back: null,
  deckBack: null,
  deckFronts: [],
};

window.addEventListener("error", (event) => {
  setConnectionStatus("Erro no painel", false);
  setMessage(`Erro no painel: ${event.message}`, "error");
});

window.addEventListener("unhandledrejection", (event) => {
  setConnectionStatus("Erro no painel", false);
  setMessage(`Erro no painel: ${event.reason?.message || event.reason}`, "error");
});

function setMessage(text, tone = "neutral") {
  elements.message.textContent = text;
  elements.message.dataset.tone = tone;
}

function setConnectionStatus(text, isConnected) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.dataset.connected = String(isConnected);
  elements.importButton.disabled = !isConnected;
  elements.importDeckButton.disabled = !isConnected;
  elements.pickFrontAssetButton.disabled = !isConnected;
  elements.pickBackAssetButton.disabled = !isConnected;
  elements.pickDeckBackAssetButton.disabled = !isConnected;
  elements.pickDeckFrontAssetsButton.disabled = !isConnected;
  elements.migratePublicButton.disabled = !isConnected;
  elements.panelFlipButton.disabled = !isConnected;
  elements.panelDrawButton.disabled = !isConnected;
  elements.panelShuffleButton.disabled = !isConnected;
  elements.panelReturnButton.disabled = !isConnected;
  elements.panelRepairButton.disabled = !isConnected;
}

async function rememberCardSelection(selection) {
  if (!obr || !selection?.length) {
    return;
  }

  const selectedItems = await obr.scene.items.getItems(selection);
  const cardIds = getDoubleSidedCards(selectedItems).map((item) => item.id);

  if (cardIds.length) {
    lastCardSelection = cardIds;
  }
}

async function rememberDeckSelection(selection) {
  if (!obr || !selection?.length) {
    return;
  }

  const selectedItems = await obr.scene.items.getItems(selection);
  const deckIds = getDeckItems(selectedItems).map((item) => item.id);

  if (deckIds.length) {
    lastDeckSelection = deckIds;
  }
}

async function refreshPanelSelectionMemory() {
  if (!obr) {
    return;
  }

  const selection = await obr.player.getSelection();
  await Promise.all([rememberCardSelection(selection), rememberDeckSelection(selection)]);
}

async function showPanelActionResult(count, singular, plural, warning) {
  if (!count) {
    setMessage(warning, "warning");
    await obr.notification.show(warning, "WARNING");
    return;
  }

  const message = count === 1 ? singular : plural(count);
  setMessage(message, "success");
  await obr.notification.show(message, "SUCCESS");
}

async function runPanelAction(button, action) {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para usar os comandos.", "warning");
    return;
  }

  button.disabled = true;
  try {
    await refreshPanelSelectionMemory();
    await action();
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui executar a acao.", "error");
  } finally {
    button.disabled = false;
  }
}

function getRepairMessage(stats) {
  const parts = [];

  if (stats.cards) {
    parts.push(stats.cards === 1 ? "1 carta" : `${stats.cards} cartas`);
  }

  if (stats.decks) {
    parts.push(stats.decks === 1 ? "1 pilha" : `${stats.decks} pilhas`);
  }

  return `Cena sincronizada: ${parts.join(" e ")}.`;
}

async function repairSceneMetadata() {
  const items = await obr.scene.items.getItems();
  const repairableItems = items.filter((item) => getCardMetadata(item) || getDeckMetadata(item));
  const stats = repairableItems.reduce(
    (result, item) => {
      if (getCardMetadata(item)) {
        result.cards += 1;
      } else if (getDeckMetadata(item)) {
        result.decks += 1;
      }

      return result;
    },
    { cards: 0, decks: 0 },
  );

  if (!repairableItems.length) {
    return stats;
  }

  await obr.scene.items.updateItems(repairableItems, (draftItems) => {
    for (const item of draftItems) {
      const cardMetadata = getCardMetadata(item);

      if (cardMetadata) {
        const currentFace = cardMetadata.currentFace === "back" ? "back" : "front";
        const face = cardMetadata.faces[currentFace];

        item.image = createImageData(face);
        item.grid = createGridData(face, cardMetadata.gridWidth);
        item.description = currentFace === "back" ? "Carta dupla: verso" : "Carta dupla: frente";
        setCardMetadata(item, {
          ...cardMetadata,
          currentFace,
        });
        continue;
      }

      const deckMetadata = getDeckMetadata(item);

      if (deckMetadata) {
        item.image = createImageData(deckMetadata.back);
        item.grid = createGridData(deckMetadata.back, deckMetadata.gridWidth);
        item.name = `${deckMetadata.name} (${deckMetadata.cards.length})`;
        item.description = deckDescription(deckMetadata.cards.length);
        item.text = createDeckText(deckMetadata.cards.length);
        setDeckMetadata(item, deckMetadata);
      }
    }
  });

  return stats;
}

function normalizeUrl(value) {
  const url = value.trim();
  if (!url) {
    throw new Error("Informe uma URL valida.");
  }

  return new URL(url).toString();
}

function getGoogleDriveFileId(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (!url.hostname.endsWith("drive.google.com")) {
      return null;
    }

    const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
    if (fileMatch?.[1]) {
      return fileMatch[1];
    }

    return url.searchParams.get("id");
  } catch {
    return null;
  }
}

function getCurrentExtensionBaseUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";

  if (url.pathname.endsWith("/index.html")) {
    url.pathname = url.pathname.slice(0, -"index.html".length);
  }

  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

function getDefaultPublicBaseUrl() {
  const { hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "";
  }

  return getCurrentExtensionBaseUrl();
}

function getImageUrlCandidates(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const driveId = getGoogleDriveFileId(url);

  if (!driveId) {
    return [url];
  }

  const encodedId = encodeURIComponent(driveId);
  return [
    `https://drive.google.com/thumbnail?id=${encodedId}&sz=w2400`,
    `https://lh3.googleusercontent.com/d/${encodedId}=w2400`,
    `https://drive.google.com/uc?export=view&id=${encodedId}`,
    url,
  ];
}

function normalizePublicBaseUrl(value) {
  const url = new URL(value.trim());

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Informe uma URL publica iniciando com http ou https.");
  }

  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function encodeAssetFilename(filename) {
  return filename
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function getMigratableAssetFilename(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const markers = ["/.local-assets/", "/assets/local-assets/"];

    for (const marker of markers) {
      const markerIndex = url.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
      }
    }

    return null;
  } catch {
    return null;
  }
}

function migrateFaceUrl(face, publicBaseUrl, stats) {
  const filename = getMigratableAssetFilename(face.url);

  if (!filename) {
    return face;
  }

  stats.urls += 1;
  return {
    ...face,
    url: `${publicBaseUrl}/assets/local-assets/${encodeAssetFilename(filename)}`,
  };
}

function migrateCardItem(item, publicBaseUrl, stats) {
  const metadata = getCardMetadata(item);

  if (!metadata) {
    return false;
  }

  const urlCountBefore = stats.urls;
  const nextMetadata = {
    ...metadata,
    faces: {
      front: migrateFaceUrl(metadata.faces.front, publicBaseUrl, stats),
      back: migrateFaceUrl(metadata.faces.back, publicBaseUrl, stats),
    },
  };

  if (stats.urls === urlCountBefore) {
    return false;
  }

  const currentFace = nextMetadata.faces[nextMetadata.currentFace] || nextMetadata.faces.front;
  item.image = createImageData(currentFace);
  item.grid = createGridData(currentFace, nextMetadata.gridWidth);
  setCardMetadata(item, nextMetadata);
  return true;
}

function migrateDeckItem(item, publicBaseUrl, stats) {
  const metadata = getDeckMetadata(item);

  if (!metadata) {
    return false;
  }

  const urlCountBefore = stats.urls;
  const nextCards = metadata.cards.map((card) => ({
    ...card,
    front: migrateFaceUrl(card.front, publicBaseUrl, stats),
  }));
  const nextMetadata = {
    ...metadata,
    back: migrateFaceUrl(metadata.back, publicBaseUrl, stats),
    cards: nextCards,
  };

  if (stats.urls === urlCountBefore) {
    return false;
  }

  const count = nextMetadata.cards.length;
  item.image = createImageData(nextMetadata.back);
  item.grid = createGridData(nextMetadata.back, nextMetadata.gridWidth);
  item.name = `${nextMetadata.name} (${count})`;
  item.description = deckDescription(count);
  item.text = createDeckText(count);
  setDeckMetadata(item, nextMetadata);
  return true;
}

async function migrateSceneLocalAssets() {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para migrar os links.", "warning");
    return;
  }

  const rawBaseUrl = elements.publicBaseUrl.value.trim();
  if (!rawBaseUrl) {
    throw new Error("Informe a URL publica do GitHub Pages antes de migrar.");
  }

  const publicBaseUrl = normalizePublicBaseUrl(rawBaseUrl);
  const items = await obr.scene.items.getItems();
  const stats = {
    items: 0,
    urls: 0,
  };

  await obr.scene.items.updateItems(items, (draftItems) => {
    for (const item of draftItems) {
      const changed =
        migrateCardItem(item, publicBaseUrl, stats) ||
        migrateDeckItem(item, publicBaseUrl, stats);

      if (changed) {
        stats.items += 1;
      }
    }
  });

  if (!stats.items) {
    setMessage("Nao encontrei cartas ou pilhas com links locais nesta cena.", "warning");
    return;
  }

  const itemLabel = stats.items === 1 ? "1 item" : `${stats.items} itens`;
  const urlLabel = stats.urls === 1 ? "1 imagem" : `${stats.urls} imagens`;
  setMessage(`Migrei ${itemLabel} da cena para usar ${urlLabel} publicas.`, "success");
  await obr.notification.show("Links locais migrados para o GitHub Pages.", "SUCCESS");
}

async function loadImageInfo(rawUrl) {
  const candidates = getImageUrlCandidates(rawUrl);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const info = await loadImageFromUrl(candidate);
      return await cacheRemoteImage(info, rawUrl);
    } catch (error) {
      lastError = error;
    }
  }

  const driveHint = getGoogleDriveFileId(rawUrl)
    ? " Confira se o arquivo do Drive esta compartilhado com qualquer pessoa com o link."
    : "";

  throw new Error(`Nao consegui carregar esta imagem: ${rawUrl}.${driveHint}`, {
    cause: lastError,
  });
}

function isLocalAssetUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function cacheRemoteImage(info, originalUrl) {
  if (info.url.startsWith("blob:") || info.url.startsWith("data:") || isLocalAssetUrl(info.url)) {
    return info;
  }

  const isDriveUrl = Boolean(getGoogleDriveFileId(originalUrl));

  try {
    const response = await fetch(
      `./__remote_asset?url=${encodeURIComponent(info.url)}&name=${encodeURIComponent(
        getNameFromUrl(originalUrl, "image"),
      )}`,
    );

    if (!response.ok) {
      throw new Error("O servidor local nao conseguiu baixar a imagem remota.");
    }

    const payload = await response.json();
    if (!payload.url) {
      throw new Error("O servidor local nao retornou a imagem cacheada.");
    }

    return {
      ...info,
      url: payload.url,
    };
  } catch (error) {
    if (isDriveUrl) {
      throw new Error(
        "O Drive carregou no navegador, mas o servidor local nao conseguiu baixar a imagem. " +
          "Compartilhe o arquivo como qualquer pessoa com o link ou use os arquivos locais.",
        { cause: error },
      );
    }

    return info;
  }
}

function loadImageFromUrl(url, mimeOverride) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.onload = async () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error("A imagem carregou sem dimensoes validas."));
        return;
      }

      resolve({
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
        mime: mimeOverride || (await detectMime(url)),
      });
    };
    image.onerror = () => {
      reject(new Error(`Nao consegui carregar esta imagem: ${url}`));
    };
    image.src = url;
  });
}

async function detectMime(url) {
  if (url.startsWith("data:")) {
    return url.match(/^data:([^;,]+)/)?.[1] || "image/png";
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      mode: "cors",
    });
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();

    if (contentType?.startsWith("image/")) {
      return contentType;
    }
  } catch {
    return getMimeFromUrl(url);
  }

  return getMimeFromUrl(url);
}

function getSelectedFile(input) {
  return input.files?.[0] || null;
}

function getSelectedFiles(input) {
  return Array.from(input.files || []);
}

function imageInfoFromAsset(asset) {
  return {
    ...asset.image,
    name: asset.name || getNameFromUrl(asset.image.url, "Carta"),
  };
}

function setPreviewImage(image, url) {
  image.src = url;
  image.hidden = false;
}

function clearAsset(key) {
  if (key === "deckFronts") {
    selectedAssets.deckFronts = [];
    elements.deckAssetsStatus.textContent = "";
    return;
  }

  selectedAssets[key] = null;
}

async function pickSingleAsset(key, image, layerInput) {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para escolher assets.", "warning");
    return;
  }

  const [asset] = await obr.assets.downloadImages(false, "", layerInput.value);
  if (!asset) {
    return;
  }

  selectedAssets[key] = asset;
  setPreviewImage(image, asset.image.url);
  setMessage(`Asset "${asset.name}" selecionado.`, "success");
}

async function pickDeckFrontAssets() {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para escolher assets.", "warning");
    return;
  }

  const assets = await obr.assets.downloadImages(true, "", elements.deckLayer.value);
  if (!assets.length) {
    return;
  }

  selectedAssets.deckFronts = assets;
  elements.deckAssetsStatus.textContent =
    assets.length === 1 ? "1 frente selecionada dos assets." : `${assets.length} frentes selecionadas dos assets.`;
  setMessage(elements.deckAssetsStatus.textContent, "success");
}

async function loadFileImageInfo(file) {
  const previewUrl = URL.createObjectURL(file);

  try {
    const [info, uploadedUrl] = await Promise.all([
      loadImageFromUrl(previewUrl, file.type || getMimeFromUrl(file.name)),
      uploadLocalFile(file),
    ]);

    return {
      ...info,
      url: uploadedUrl,
      name: getNameFromFilename(file.name, "Carta"),
    };
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

async function uploadLocalFile(file) {
  const response = await fetch(`./__local_asset?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error("Nao consegui enviar o arquivo local para o servidor de teste.");
  }

  const payload = await response.json();
  if (!payload.url) {
    throw new Error("O servidor de teste nao retornou a URL do arquivo local.");
  }

  return payload.url;
}

async function loadImageInput(urlInput, fileInput, label, asset) {
  if (asset) {
    return imageInfoFromAsset(asset);
  }

  const file = getSelectedFile(fileInput);

  if (file) {
    return loadFileImageInfo(file);
  }

  const rawUrl = urlInput.value.trim();
  if (!rawUrl) {
    throw new Error(`Informe uma URL ou arquivo para ${label}.`);
  }

  const info = await loadImageInfo(rawUrl);
  return {
    ...info,
    name: getNameFromUrl(rawUrl, "Carta"),
  };
}

function updatePreview(urlInput, fileInput, image, asset) {
  if (asset) {
    setPreviewImage(image, asset.image.url);
    return;
  }

  const file = getSelectedFile(fileInput);

  if (file) {
    const previewUrl = URL.createObjectURL(file);
    image.onload = () => URL.revokeObjectURL(previewUrl);
    image.src = previewUrl;
    image.hidden = false;
    return;
  }

  const value = urlInput.value.trim();

  if (!value) {
    image.hidden = true;
    image.removeAttribute("src");
    return;
  }

  try {
    image.src = getImageUrlCandidates(value)[0];
    image.hidden = false;
  } catch {
    image.hidden = true;
    image.removeAttribute("src");
  }
}

async function getViewportCenter() {
  const [width, height] = await Promise.all([
    obr.viewport.getWidth(),
    obr.viewport.getHeight(),
  ]);

  return obr.viewport.inverseTransformPoint({
    x: width / 2,
    y: height / 2,
  });
}

function getNameFromFilename(filename, fallback) {
  return filename ? filename.replace(/\.[^.]+$/, "") : fallback;
}

function getNameFromUrl(rawUrl, fallback) {
  try {
    const path = new URL(rawUrl).pathname;
    const filename = path.split("/").filter(Boolean).pop();
    return filename ? decodeURIComponent(filename.replace(/\.[^.]+$/, "")) : fallback;
  } catch {
    return fallback;
  }
}

function getCardName(front) {
  const typedName = elements.name.value.trim();
  return typedName || front.name || getNameFromUrl(front.url, "Carta");
}

function getDeckName() {
  const typedName = elements.deckName.value.trim();
  return typedName || "Pilha";
}

function parseDeckLines() {
  const lines = elements.deckFrontUrls.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("Informe pelo menos uma frente por URL ou arquivo para a pilha.");
  }

  return lines.map((line, index) => {
    const separatorIndex = line.indexOf("|");
    const rawName = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : "";
    const rawUrl = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : line;
    const url = normalizeUrl(rawUrl);
    const name = rawName || getNameFromUrl(url, `Carta ${index + 1}`);

    return { name, url };
  });
}

async function loadDeckFronts() {
  if (selectedAssets.deckFronts.length) {
    return selectedAssets.deckFronts.map((asset) => ({
      name: asset.name || "Carta",
      front: imageInfoFromAsset(asset),
    }));
  }

  const files = getSelectedFiles(elements.deckFrontFiles);

  if (files.length) {
    return Promise.all(
      files.map(async (file) => ({
        name: getNameFromFilename(file.name, "Carta"),
        front: await loadFileImageInfo(file),
      })),
    );
  }

  const cardLines = parseDeckLines();
  const fronts = await Promise.all(cardLines.map((card) => loadImageInfo(card.url)));

  return fronts.map((front, index) => ({
    name: cardLines[index].name,
    front,
  }));
}

async function createCard(event) {
  event.preventDefault();

  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para importar.", "warning");
    return;
  }

  setMessage("Carregando imagens...", "neutral");
  elements.importButton.disabled = true;

  try {
    const [front, back] = await Promise.all([
      loadImageInput(elements.frontUrl, elements.frontFile, "a frente", selectedAssets.front),
      loadImageInput(elements.backUrl, elements.backFile, "o verso", selectedAssets.back),
    ]);

    const gridWidth = Number.parseFloat(elements.gridWidth.value);
    if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
      throw new Error("A largura no grid precisa ser maior que zero.");
    }

    const name = getCardName(front);
    const position = await getViewportCenter();
    const metadata = createCardMetadata({ name, front, back, gridWidth });
    const item = buildImage(createImageData(front), createGridData(front, gridWidth))
      .name(name)
      .description("Carta dupla: frente")
      .layer(elements.layer.value)
      .position(position)
      .metadata(createCardMetadataMap(metadata))
      .build();

    await obr.scene.items.addItems([item]);
    await obr.notification.show(`Carta "${name}" importada.`);

    setMessage("Carta importada.", "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui importar a carta.", "error");
  } finally {
    elements.importButton.disabled = false;
  }
}

async function createDeck(event) {
  event.preventDefault();

  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para importar.", "warning");
    return;
  }

  setMessage("Carregando pilha...", "neutral");
  elements.importDeckButton.disabled = true;

  try {
    const [back, cards] = await Promise.all([
      loadImageInput(
        elements.deckBackUrl,
        elements.deckBackFile,
        "o verso da pilha",
        selectedAssets.deckBack,
      ),
      loadDeckFronts(),
    ]);
    const gridWidth = Number.parseFloat(elements.deckGridWidth.value);

    if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
      throw new Error("A largura no grid precisa ser maior que zero.");
    }

    const name = getDeckName();
    const position = await getViewportCenter();
    const metadata = createDeckMetadata({ name, back, cards, gridWidth });
    const item = buildImage(createImageData(back), createGridData(back, gridWidth))
      .name(`${name} (${cards.length})`)
      .description(deckDescription(cards.length))
      .text(createDeckText(cards.length))
      .layer(elements.deckLayer.value)
      .position(position)
      .metadata(createDeckMetadataMap(metadata))
      .build();

    await obr.scene.items.addItems([item]);
    await obr.notification.show(`Pilha "${name}" importada.`);

    setMessage("Pilha importada.", "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui importar a pilha.", "error");
  } finally {
    elements.importDeckButton.disabled = false;
  }
}

async function init() {
  elements.form.addEventListener("submit", createCard);
  elements.deckForm.addEventListener("submit", createDeck);
  elements.publicBaseUrl.value = getDefaultPublicBaseUrl();
  elements.panelFlipButton.addEventListener("click", () =>
    runPanelAction(elements.panelFlipButton, async () => {
      const count = await flipSelectedItems(obr, lastCardSelection);
      await showPanelActionResult(
        count,
        "Carta virada.",
        (total) => `${total} cartas viradas.`,
        "Selecione uma carta dupla para virar.",
      );
    }),
  );
  elements.panelDrawButton.addEventListener("click", () =>
    runPanelAction(elements.panelDrawButton, async () => {
      const count = await drawSelectedDecks(obr, buildImage, lastDeckSelection);
      await showPanelActionResult(
        count,
        "Carta comprada.",
        (total) => `${total} cartas compradas.`,
        "Selecione uma pilha com cartas para comprar.",
      );
    }),
  );
  elements.panelShuffleButton.addEventListener("click", () =>
    runPanelAction(elements.panelShuffleButton, async () => {
      const count = await shuffleSelectedDecks(obr, lastDeckSelection);
      await showPanelActionResult(
        count,
        "Pilha embaralhada.",
        (total) => `${total} pilhas embaralhadas.`,
        "Selecione uma pilha com pelo menos duas cartas.",
      );
    }),
  );
  elements.panelReturnButton.addEventListener("click", () =>
    runPanelAction(elements.panelReturnButton, async () => {
      const count = await returnSelectedCardsToDeck(
        obr,
        lastCardSelection,
        lastDeckSelection,
      );
      await showPanelActionResult(
        count,
        "Carta devolvida para a pilha.",
        (total) => `${total} cartas devolvidas para a pilha.`,
        "Selecione uma carta comprada e uma pilha alvo.",
      );
    }),
  );
  elements.panelRepairButton.addEventListener("click", () =>
    runPanelAction(elements.panelRepairButton, async () => {
      const stats = await repairSceneMetadata();
      const total = stats.cards + stats.decks;

      if (!total) {
        const warning = "Nao encontrei cartas ou pilhas para sincronizar.";
        setMessage(warning, "warning");
        await obr.notification.show(warning, "WARNING");
        return;
      }

      const message = getRepairMessage(stats);
      setMessage(message, "success");
      await obr.notification.show(message, "SUCCESS");
    }),
  );
  elements.frontUrl.addEventListener("input", () =>
    clearAsset("front") ||
    updatePreview(elements.frontUrl, elements.frontFile, elements.frontPreview),
  );
  elements.frontFile.addEventListener("change", () =>
    clearAsset("front") ||
    updatePreview(elements.frontUrl, elements.frontFile, elements.frontPreview),
  );
  elements.pickFrontAssetButton.addEventListener("click", () =>
    pickSingleAsset("front", elements.frontPreview, elements.layer).catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui escolher a frente dos assets.", "error");
    }),
  );
  elements.backUrl.addEventListener("input", () =>
    clearAsset("back") ||
    updatePreview(elements.backUrl, elements.backFile, elements.backPreview),
  );
  elements.backFile.addEventListener("change", () =>
    clearAsset("back") ||
    updatePreview(elements.backUrl, elements.backFile, elements.backPreview),
  );
  elements.pickBackAssetButton.addEventListener("click", () =>
    pickSingleAsset("back", elements.backPreview, elements.layer).catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui escolher o verso dos assets.", "error");
    }),
  );
  elements.deckBackUrl.addEventListener("input", () =>
    clearAsset("deckBack") ||
    updatePreview(elements.deckBackUrl, elements.deckBackFile, elements.deckBackPreview),
  );
  elements.deckBackFile.addEventListener("change", () =>
    clearAsset("deckBack") ||
    updatePreview(elements.deckBackUrl, elements.deckBackFile, elements.deckBackPreview),
  );
  elements.pickDeckBackAssetButton.addEventListener("click", () =>
    pickSingleAsset("deckBack", elements.deckBackPreview, elements.deckLayer).catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui escolher o verso dos assets.", "error");
    }),
  );
  elements.deckFrontUrls.addEventListener("input", () => clearAsset("deckFronts"));
  elements.deckFrontFiles.addEventListener("change", () => clearAsset("deckFronts"));
  elements.pickDeckFrontAssetsButton.addEventListener("click", () =>
    pickDeckFrontAssets().catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui escolher as frentes dos assets.", "error");
    }),
  );
  elements.migratePublicButton.addEventListener("click", () => {
    elements.migratePublicButton.disabled = true;
    setMessage("Migrando links locais da cena...", "neutral");
    migrateSceneLocalAssets()
      .catch((error) => {
        console.error(error);
        setMessage(error.message || "Nao consegui migrar os links locais.", "error");
      })
      .finally(() => {
        elements.migratePublicButton.disabled = !obr;
      });
  });

  updatePreview(elements.frontUrl, elements.frontFile, elements.frontPreview, selectedAssets.front);
  updatePreview(elements.backUrl, elements.backFile, elements.backPreview, selectedAssets.back);
  updatePreview(
    elements.deckBackUrl,
    elements.deckBackFile,
    elements.deckBackPreview,
    selectedAssets.deckBack,
  );
  setConnectionStatus("Painel carregado; conectando...", false);
  setMessage("Previa ativa. Conectando ao Owlbear...", "neutral");

  try {
    const loaded =
      (await window.doubleSidedCardsSdkReady) ||
      (await import("./" + "sdk-client.js?v=33").then((sdkModule) =>
        sdkModule.loadOwlbearSdk(20000),
      ));
    obr = loaded.OBR;
    buildImage = loaded.sdk.buildImage;
    obr.broadcast
      .sendMessage(COMMANDS_CHANNEL, { type: "register-commands" }, { destination: "LOCAL" })
      .catch((error) => {
        console.warn("Unable to request command registration", error);
      });
    const selection = await obr.player.getSelection();
    await Promise.all([rememberCardSelection(selection), rememberDeckSelection(selection)]);
    obr.player.onChange((player) => {
      rememberCardSelection(player.selection).catch((error) => {
        console.warn("Unable to update card selection", error);
      });
      rememberDeckSelection(player.selection).catch((error) => {
        console.warn("Unable to update deck selection", error);
      });
    });
    setConnectionStatus("Conectado ao Owlbear", true);
    setMessage("", "neutral");
  } catch (error) {
    console.warn(error);
    setConnectionStatus("Sem conexao ao SDK", false);
    setMessage(
      `A tela carregou, mas ainda nao conectou ao Owlbear: ${error.message}`,
      "warning",
    );
  }
}

init();
