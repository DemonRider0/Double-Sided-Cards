import {
  COMMANDS_CHANNEL,
  applyCardFaceTransform,
  createCardMetadata,
  createCardMetadataMap,
  createDeckMetadata,
  createDeckMetadataMap,
  createGridData,
  createImageData,
  deckDescription,
  getCardMetadata,
  getDeckMetadata,
  normalizeCardMetadata,
  normalizeDeckMetadata,
  setCardMetadata,
  setDeckMetadata,
  shouldMirrorBackFace,
} from "./card-data.js";
import {
  applyDeckDisplay,
  createMissionDeckFromSelection,
  createDeckText,
  drawSelectedDecks,
  getDeckItems,
  returnSelectedCardsToDeck,
  shuffleSelectedDecks,
} from "./deck.js";
import { applyDivinitySizing, needsDivinitySizing } from "./divinity-sizing.js";
import { flipSelectedItems, getDoubleSidedCards } from "./flip.js";
import {
  buildPresetDeckData,
  isPresetDeckReady,
  loadPresetDecks,
} from "./preset-decks.js";
import {
  buildPresetCardData,
  isPresetCardReady,
  loadPresetCardGroups,
} from "./preset-cards.js";
import {
  getSceneRestoreStatus,
  loadScenePresetEntries,
  restoreDefaultBoardPreset,
  saveScenePreset,
  SCENE_PRESETS,
} from "./scene-preset.js";
import {
  ACTIVE_COLOR_KEY,
  CARD_CATEGORY_KEY,
  PLAYER_COLORS,
  returnSelectedCardToOrigin,
} from "./selection-board.js";

const elements = {
  presetDeckSelect: document.querySelector("#presetDeckSelect"),
  presetDeckGridWidth: document.querySelector("#presetDeckGridWidth"),
  presetDeckLayer: document.querySelector("#presetDeckLayer"),
  presetDeckInfo: document.querySelector("#presetDeckInfo"),
  importPresetDeckButton: document.querySelector("#importPresetDeckButton"),
  presetCardGroupSelect: document.querySelector("#presetCardGroupSelect"),
  presetCardSelect: document.querySelector("#presetCardSelect"),
  presetCardGridWidth: document.querySelector("#presetCardGridWidth"),
  presetCardLayer: document.querySelector("#presetCardLayer"),
  presetCardInfo: document.querySelector("#presetCardInfo"),
  importPresetCardButton: document.querySelector("#importPresetCardButton"),
  missionDeckInfo: document.querySelector("#missionDeckInfo"),
  createMissionDeckButton: document.querySelector("#createMissionDeckButton"),
  panelFlipButton: document.querySelector("#panelFlipButton"),
  panelDrawButton: document.querySelector("#panelDrawButton"),
  panelShuffleButton: document.querySelector("#panelShuffleButton"),
  panelReturnButton: document.querySelector("#panelReturnButton"),
  panelRepairButton: document.querySelector("#panelRepairButton"),
  returnOriginButton: document.querySelector("#returnOriginButton"),
  colorAssignments: document.querySelector("#colorAssignments"),
  publicBaseUrl: document.querySelector("#publicBaseUrl"),
  migratePublicButton: document.querySelector("#migratePublicButton"),
  createScenePresetButtons: [...document.querySelectorAll("[data-create-scene-preset]")],
  restoreScenePresetButtons: [...document.querySelectorAll("[data-restore-scene-preset]")],
  defaultBoardInfo: document.querySelector("#defaultBoardInfo"),
  connectionStatus: document.querySelector("#connectionStatus"),
  message: document.querySelector("#message"),
};

let obr = null;
let buildImage = null;
let lastCardSelection = [];
let lastDeckSelection = [];
let lastFlipSelection = [];
let presetDecks = [];
let presetCardGroups = [];
let scenePresetEntries = [];
let sceneRestoreRunning = false;
let colorAssignmentsRefreshTimer = null;
const customSelects = new Map();

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
  if (!isConnected) {
    renderPlayerColorAssignments([]);
  }
  elements.migratePublicButton.disabled = !isConnected;
  updateDefaultBoardControls(isConnected);
  elements.panelFlipButton.disabled = !isConnected;
  elements.panelDrawButton.disabled = !isConnected;
  elements.panelShuffleButton.disabled = !isConnected;
  elements.panelReturnButton.disabled = !isConnected;
  elements.panelRepairButton.disabled = !isConnected;
  elements.returnOriginButton.disabled = !isConnected;
  updatePresetDeckControls(isConnected);
  updatePresetCardControls(isConnected);
  updateMissionDeckControls(isConnected);
}

function normalizePointerColor(color) {
  const value = String(color || "").trim().toLowerCase();

  if (/^#[0-9a-f]{8}$/.test(value)) {
    return value.slice(0, 7);
  }

  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);

  if (rgb) {
    return `#${rgb
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  return value;
}

function getPlayerColor(player) {
  const metadataColor = player.metadata?.[ACTIVE_COLOR_KEY]?.color;

  if (PLAYER_COLORS.some((entry) => entry.id === metadataColor)) {
    return metadataColor;
  }

  const pointerColor = normalizePointerColor(player.color);
  return (
    PLAYER_COLORS.find(
      (entry) => normalizePointerColor(entry.pointerColor) === pointerColor,
    )?.id || null
  );
}

function playerName(player) {
  return player.name || player.username || "Jogador sem nome";
}

function renderPlayerColorAssignments(players) {
  if (!elements.colorAssignments) {
    return;
  }

  elements.colorAssignments.replaceChildren();

  for (const color of PLAYER_COLORS) {
    const playersUsingColor = players.filter((player) => getPlayerColor(player) === color.id);
    const names = playersUsingColor.length
      ? playersUsingColor.map(playerName).join(", ")
      : "Sem jogador";
    const item = document.createElement("li");
    item.textContent = `${names} - ${color.label.toLowerCase()}`;
    elements.colorAssignments.append(item);
  }
}

async function getCurrentPlayerSnapshot() {
  if (!obr) {
    return null;
  }

  const [id, name, color, metadata] = await Promise.all([
    obr.player.getId().catch(() => obr.player.id || ""),
    obr.player.getName().catch(() => ""),
    obr.player.getColor().catch(() => ""),
    obr.player.getMetadata().catch(() => ({})),
  ]);

  if (!id) {
    return null;
  }

  return {
    id,
    name,
    color,
    metadata,
  };
}

function mergeCurrentPlayer(players, currentPlayer) {
  if (!currentPlayer?.id) {
    return players;
  }

  const nextPlayers = [...players];
  const playerIndex = nextPlayers.findIndex((player) => player.id === currentPlayer.id);

  if (playerIndex >= 0) {
    nextPlayers[playerIndex] = {
      ...nextPlayers[playerIndex],
      ...currentPlayer,
      metadata: {
        ...(nextPlayers[playerIndex].metadata || {}),
        ...(currentPlayer.metadata || {}),
      },
    };
  } else {
    nextPlayers.push(currentPlayer);
  }

  return nextPlayers;
}

async function refreshPlayerColorAssignments() {
  if (!obr?.party?.getPlayers) {
    renderPlayerColorAssignments([]);
    return;
  }

  try {
    const [players, currentPlayer] = await Promise.all([
      obr.party.getPlayers(),
      getCurrentPlayerSnapshot(),
    ]);
    renderPlayerColorAssignments(mergeCurrentPlayer(players, currentPlayer));
  } catch (error) {
    console.warn("Nao consegui atualizar as cores dos jogadores", error);
    if (elements.colorAssignments) {
      elements.colorAssignments.replaceChildren();
      const item = document.createElement("li");
      item.textContent = "Nao consegui ler os jogadores.";
      elements.colorAssignments.append(item);
    }
  }
}

function schedulePlayerColorAssignmentsRefresh(fallbackPlayers = null) {
  if (colorAssignmentsRefreshTimer) {
    window.clearTimeout(colorAssignmentsRefreshTimer);
  }

  colorAssignmentsRefreshTimer = window.setTimeout(() => {
    colorAssignmentsRefreshTimer = null;
    refreshPlayerColorAssignments().catch((error) => {
      console.warn("Nao consegui atualizar as cores do painel", error);

      if (fallbackPlayers) {
        renderPlayerColorAssignments(fallbackPlayers);
      }
    });
  }, 150);
}

function formatPresetDate(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value || "";
  }
}

function updateDefaultBoardControls(isConnected = Boolean(obr)) {
  const entriesById = new Map(scenePresetEntries.map((entry) => [entry.definition.id, entry]));

  for (const button of elements.createScenePresetButtons) {
    button.hidden = true;
    button.disabled = true;
  }

  for (const button of elements.restoreScenePresetButtons) {
    const entry = entriesById.get(button.dataset.restoreScenePreset);
    button.disabled = sceneRestoreRunning || !isConnected || !entry?.preset;
  }

  if (!scenePresetEntries.length) {
    elements.defaultBoardInfo.textContent = "Carregando mapas salvos...";
    return;
  }

  const parts = scenePresetEntries.map(({ definition, preset }) => {
    if (!preset) {
      return `${definition.name}: nao cadastrado`;
    }

    const itemLabel = preset.itemCount === 1 ? "1 item" : `${preset.itemCount} itens`;
    return `${definition.name}: ${itemLabel}, salvo em ${formatPresetDate(preset.savedAt)}`;
  });

  elements.defaultBoardInfo.textContent = parts.join(" | ");
}

async function refreshDefaultBoardInfo() {
  scenePresetEntries = await loadScenePresetEntries();
  updateDefaultBoardControls(Boolean(obr));
}

async function rememberSelection(selection) {
  if (!obr || !selection?.length) {
    return;
  }

  const selectedItems = await obr.scene.items.getItems(selection);
  const cardIds = getDoubleSidedCards(selectedItems).map((item) => item.id);
  const deckIds = getDeckItems(selectedItems).map((item) => item.id);

  if (cardIds.length) {
    lastCardSelection = cardIds;
    lastFlipSelection = cardIds;
  }

  if (deckIds.length) {
    lastDeckSelection = deckIds;
    lastFlipSelection = deckIds;
  }
}

async function refreshPanelSelectionMemory() {
  if (!obr) {
    return;
  }

  const selection = await obr.player.getSelection();
  await rememberSelection(selection);
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

function getSelectLabel(select) {
  return select.selectedOptions?.[0]?.textContent || select.options?.[0]?.textContent || "Escolha uma opcao";
}

function closeCustomSelect(select) {
  const state = customSelects.get(select);

  if (!state) {
    return;
  }

  state.root.dataset.open = "false";
  state.menu.hidden = true;
  state.button.setAttribute("aria-expanded", "false");
}

function closeOtherCustomSelects(currentSelect) {
  for (const select of customSelects.keys()) {
    if (select !== currentSelect) {
      closeCustomSelect(select);
    }
  }
}

function buildCustomSelectMenu(select) {
  const state = customSelects.get(select);

  if (!state) {
    return;
  }

  state.menu.replaceChildren();

  for (const option of select.options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "custom-select__option";
    item.textContent = option.textContent;
    item.disabled = option.disabled;
    item.dataset.selected = String(option.selected);
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.selected));
    item.addEventListener("click", () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeCustomSelect(select);
      syncAllCustomSelects();
    });
    state.menu.append(item);
  }
}

function openCustomSelect(select) {
  const state = customSelects.get(select);

  if (!state || select.disabled) {
    return;
  }

  closeOtherCustomSelects(select);
  buildCustomSelectMenu(select);
  state.root.dataset.open = "true";
  state.menu.hidden = false;
  state.button.setAttribute("aria-expanded", "true");
}

function syncCustomSelect(select) {
  const state = customSelects.get(select);

  if (!state) {
    return;
  }

  state.button.textContent = getSelectLabel(select);
  state.button.disabled = select.disabled;
  state.root.dataset.disabled = String(select.disabled);

  if (state.root.dataset.open === "true") {
    buildCustomSelectMenu(select);
  }
}

function syncAllCustomSelects() {
  for (const select of customSelects.keys()) {
    syncCustomSelect(select);
  }
}

function enhanceCustomSelect(select) {
  if (!select || customSelects.has(select)) {
    return;
  }

  select.classList.add("native-select-hidden");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const root = document.createElement("div");
  root.className = "custom-select";
  root.dataset.open = "false";
  root.dataset.disabled = String(select.disabled);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "custom-select__button";
  button.textContent = getSelectLabel(select);
  button.disabled = select.disabled;
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "custom-select__menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");

  root.append(button, menu);
  select.after(root);

  const observer = new MutationObserver(() => syncCustomSelect(select));
  observer.observe(select, {
    attributes: true,
    attributeFilter: ["disabled"],
    childList: true,
    subtree: true,
  });

  customSelects.set(select, { button, menu, observer, root });

  button.addEventListener("click", (event) => {
    event.stopPropagation();

    if (root.dataset.open === "true") {
      closeCustomSelect(select);
      return;
    }

    openCustomSelect(select);
  });

  button.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCustomSelect(select);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCustomSelect(select);
    }
  });

  select.addEventListener("change", () => syncCustomSelect(select));
  syncCustomSelect(select);
}

function enhancePanelSelects() {
  for (const select of document.querySelectorAll("select")) {
    enhanceCustomSelect(select);
  }

  document.addEventListener("click", (event) => {
    for (const { root } of customSelects.values()) {
      if (!root.contains(event.target)) {
        root.dataset.open = "false";
        root.querySelector(".custom-select__menu").hidden = true;
        root.querySelector(".custom-select__button").setAttribute("aria-expanded", "false");
      }
    }
  });

  syncAllCustomSelects();
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

function imageMayHaveTransparency(blob) {
  const mime = blob.type || "";
  return mime === "image/png" || mime === "image/webp";
}

function imageLooksTransparent(image) {
  const sampleSize = 64;
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const context = canvas.getContext("2d");

  if (!context) {
    return false;
  }

  context.clearRect(0, 0, sampleSize, sampleSize);
  context.drawImage(image, 0, 0, sampleSize, sampleSize);
  const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;

  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 250) {
      return true;
    }
  }

  return false;
}


async function repairSceneMetadata() {
  const items = await obr.scene.items.getItems();
  const repairableItems = [];
  const stats = { cards: 0, decks: 0 };

  for (const item of items) {
    const card = normalizeCardMetadata(getCardMetadata(item), { item });

    if (card.ok) {
      repairableItems.push(item);
      stats.cards += 1;
      continue;
    }

    const deck = normalizeDeckMetadata(getDeckMetadata(item), { item });

    if (deck.ok) {
      repairableItems.push(item);
      stats.decks += 1;
    }
  }

  if (repairableItems.length) {
    await obr.scene.items.updateItems(repairableItems, (draftItems) => {
      for (const item of draftItems) {
        const cardResult = normalizeCardMetadata(getCardMetadata(item), { item });
        const cardMetadata = cardResult.ok ? cardResult.value : null;

        if (cardMetadata) {
          const currentFace = cardMetadata.currentFace === "back" ? "back" : "front";
          const nextCardMetadata = {
            ...cardMetadata,
            currentFace,
            mirrorBack: shouldMirrorBackFace(cardMetadata.faces.front, cardMetadata.faces.back),
          };
          const face = nextCardMetadata.faces[currentFace];

          item.image = createImageData(face);
          item.grid = createGridData(face, nextCardMetadata.gridWidth, nextCardMetadata.origin);
          applyDivinitySizing(item, face);
          applyCardFaceTransform(item, nextCardMetadata, currentFace);
          item.description = currentFace === "back" ? "Carta dupla: verso" : "Carta dupla: frente";
          setCardMetadata(item, nextCardMetadata);
          continue;
        }

        const deckResult = normalizeDeckMetadata(getDeckMetadata(item), { item });
        const deckMetadata = deckResult.ok ? deckResult.value : null;

        if (deckMetadata) {
          applyDeckDisplay(item, deckMetadata);
          setDeckMetadata(item, deckMetadata);
        }
      }
    });
  }

  return stats;
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

function normalizeComparableUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function repairNestedPublicUrl(rawUrl, stats) {
  const value = String(rawUrl || "");
  const matches = [...value.matchAll(/https?:\/\//g)];

  if (matches.length < 2) {
    return value;
  }

  const nextUrl = value.slice(matches[matches.length - 1].index);

  if (normalizeComparableUrl(value) === normalizeComparableUrl(nextUrl)) {
    return value;
  }

  stats.urls += 1;
  return nextUrl;
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

function isRemoteSceneAssetUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    const isLocalUrl = url.hostname === "localhost" || url.hostname === "127.0.0.1";

    return !isLocalUrl && (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}

function shouldCachePlainSceneImage(item) {
  if (!item.image?.url || !isRemoteSceneAssetUrl(item.image.url)) {
    return false;
  }

  try {
    const url = new URL(item.image.url, window.location.origin);

    if (url.hostname === "images.owlbear.rodeo") {
      return true;
    }
  } catch {
    return false;
  }

  const area = (item.image.width || 0) * (item.image.height || 0);
  const mime = item.image.mime || "";
  const isWebp = mime === "image/webp" || /\.webp(?:$|[?#])/i.test(item.image.url);

  return item.layer === "MAP" || item.layer === "NOTE" || area >= 2_000_000 || isWebp;
}

function getCachedAssetInfo(rawUrl, remoteCache) {
  const repairedUrl = repairNestedPublicUrl(rawUrl, { urls: 0 });
  return remoteCache.get(rawUrl) || remoteCache.get(repairedUrl) || null;
}

function getRemoteAssetName(item, mime = "image/jpeg") {
  const fallback = item.name || getNameFromUrl(item.image?.url || "", "image");
  const extension = mime === "image/png" ? "png" : "jpg";
  return `${fallback}.${extension}`;
}

async function loadBlobImage(blob) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error("A imagem carregou sem dimensoes validas."));
          return;
        }

        resolve({
          url: objectUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
          mime: blob.type || "image/png",
        });
      };
      image.onerror = () => {
        reject(new Error(`Nao consegui carregar esta imagem: ${objectUrl}`));
      };
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Nao consegui converter a imagem para o formato otimizado."));
      },
      mime,
      quality,
    );
  });
}

async function optimizeSceneImageBlob(blob, info) {
  const shouldConvertToJpeg =
    blob.type === "image/webp" ||
    blob.type === "image/png" ||
    (info.width || 0) * (info.height || 0) >= 2_000_000;

  if (!shouldConvertToJpeg) {
    return { blob, mime: blob.type || info.mime || "image/png" };
  }

  const image = await createImageBitmap(blob);

  try {
    const transparent = imageMayHaveTransparency(blob) && imageLooksTransparent(image);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");

    if (!context) {
      return { blob, mime: blob.type || info.mime || "image/png" };
    }

    if (!transparent) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(image, 0, 0);
    const mime = transparent ? "image/png" : "image/jpeg";

    return {
      blob: await canvasToBlob(canvas, mime, transparent ? undefined : 0.84),
      mime,
    };
  } finally {
    image.close?.();
  }
}

async function uploadBlobAsLocalAsset(blob, name) {
  const response = await fetch(`./__local_asset?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
    },
    body: blob,
  });

  if (!response.ok) {
    throw new Error("O servidor local nao conseguiu salvar a imagem otimizada.");
  }

  const payload = await response.json();
  if (!payload.url) {
    throw new Error("O servidor local nao retornou a imagem otimizada.");
  }

  return payload.url;
}

async function cachePlainSceneImage(item) {
  const response = await fetch(item.image.url, {
    cache: "no-store",
    mode: "cors",
  });

  if (!response.ok) {
    throw new Error(`Nao consegui baixar "${item.name || "imagem"}" do Owlbear.`);
  }

  const originalBlob = await response.blob();
  const info = await loadBlobImage(originalBlob);
  const optimized = await optimizeSceneImageBlob(originalBlob, info);
  const url = await uploadBlobAsLocalAsset(optimized.blob, getRemoteAssetName(item, optimized.mime));

  return {
    url,
    width: info.width,
    height: info.height,
    mime: optimized.mime,
  };
}

async function cachePlainRemoteSceneImages(items, stats) {
  const cache = new Map();

  if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    return cache;
  }

  const remoteItems = [];
  const seenUrls = new Set();

  for (const item of items) {
    if (
      item.type !== "IMAGE" ||
      getCardMetadata(item) ||
      getDeckMetadata(item) ||
      !shouldCachePlainSceneImage(item) ||
      seenUrls.has(item.image.url)
    ) {
      continue;
    }

    seenUrls.add(item.image.url);
    remoteItems.push(item);
  }

  if (!remoteItems.length) {
    return cache;
  }

  setMessage(`Otimizando ${remoteItems.length} imagens normais da cena...`, "neutral");

  for (const item of remoteItems) {
    try {
      const info = await cachePlainSceneImage(item);
      cache.set(item.image.url, info);
      stats.cached += 1;
    } catch (error) {
      console.warn("Nao consegui otimizar imagem normal da cena", item.name, error);
      stats.cacheErrors += 1;
    }
  }

  return cache;
}

function migrateAssetUrl(rawUrl, publicBaseUrl, stats, remoteCache = new Map()) {
  const repairedUrl = repairNestedPublicUrl(rawUrl, stats);
  const cachedAsset = getCachedAssetInfo(repairedUrl, remoteCache);
  const urlToMigrate = cachedAsset?.url || repairedUrl;
  const filename = getMigratableAssetFilename(urlToMigrate);

  if (!filename) {
    return repairedUrl;
  }

  const nextUrl = `${publicBaseUrl}/assets/local-assets/${encodeAssetFilename(filename)}`;

  if (normalizeComparableUrl(rawUrl) === normalizeComparableUrl(nextUrl)) {
    return repairedUrl;
  }

  stats.urls += 1;
  return nextUrl;
}

function migrateFaceUrl(face, publicBaseUrl, stats, remoteCache) {
  const cachedAsset = getCachedAssetInfo(face.url, remoteCache);
  const nextUrl = migrateAssetUrl(face.url, publicBaseUrl, stats, remoteCache);

  if (
    normalizeComparableUrl(face.url) === normalizeComparableUrl(nextUrl) &&
    (!cachedAsset?.mime || face.mime === cachedAsset.mime)
  ) {
    return face;
  }

  return {
    ...face,
    url: nextUrl,
    width: cachedAsset?.width || face.width,
    height: cachedAsset?.height || face.height,
    mime: cachedAsset?.mime || face.mime,
  };
}

function migrateImageItem(item, publicBaseUrl, stats, remoteCache) {
  if (!item.image?.url) {
    return false;
  }

  const cachedAsset = getCachedAssetInfo(item.image.url, remoteCache);
  const nextUrl = migrateAssetUrl(item.image.url, publicBaseUrl, stats, remoteCache);

  if (
    normalizeComparableUrl(item.image.url) === normalizeComparableUrl(nextUrl) &&
    (!cachedAsset?.mime || item.image.mime === cachedAsset.mime)
  ) {
    return false;
  }

  item.image = {
    ...item.image,
    url: nextUrl,
    width: cachedAsset?.width || item.image.width,
    height: cachedAsset?.height || item.image.height,
    mime: cachedAsset?.mime || item.image.mime,
  };
  return true;
}

function migrateCardItem(item, publicBaseUrl, stats, remoteCache) {
  const result = normalizeCardMetadata(getCardMetadata(item), { item });
  const metadata = result.ok ? result.value : null;

  if (!metadata) {
    return false;
  }

  const urlCountBefore = stats.urls;
  const nextMetadata = {
    ...metadata,
    faces: {
      front: migrateFaceUrl(metadata.faces.front, publicBaseUrl, stats, remoteCache),
      back: migrateFaceUrl(metadata.faces.back, publicBaseUrl, stats, remoteCache),
    },
  };
  nextMetadata.mirrorBack = shouldMirrorBackFace(
    nextMetadata.faces.front,
    nextMetadata.faces.back,
  );
  const currentFace = nextMetadata.faces[nextMetadata.currentFace] || nextMetadata.faces.front;
  const urlsChanged = stats.urls !== urlCountBefore;
  const divinitySizingChanged = needsDivinitySizing(item, currentFace);
  const mirrorChanged = metadata.mirrorBack !== nextMetadata.mirrorBack;

  if (!urlsChanged && !divinitySizingChanged && !mirrorChanged) {
    return false;
  }

  item.image = createImageData(currentFace);
  item.grid = createGridData(currentFace, nextMetadata.gridWidth, nextMetadata.origin);
  applyDivinitySizing(item, currentFace);
  applyCardFaceTransform(
    item,
    nextMetadata,
    nextMetadata.currentFace === "back" ? "back" : "front",
  );
  if (divinitySizingChanged) {
    stats.sized += 1;
  }
  setCardMetadata(item, nextMetadata);
  return true;
}

function migrateDeckItem(item, publicBaseUrl, stats, remoteCache) {
  const result = normalizeDeckMetadata(getDeckMetadata(item), { item });
  const metadata = result.ok ? result.value : null;

  if (!metadata) {
    return false;
  }

  const urlCountBefore = stats.urls;
  const nextCards = metadata.cards.map((card) => ({
    ...card,
    front: migrateFaceUrl(card.front, publicBaseUrl, stats, remoteCache),
    ...(card.back
      ? { back: migrateFaceUrl(card.back, publicBaseUrl, stats, remoteCache) }
      : {}),
  }));
  const nextMetadata = {
    ...metadata,
    back: migrateFaceUrl(metadata.back, publicBaseUrl, stats, remoteCache),
    cards: nextCards,
  };

  if (stats.urls === urlCountBefore) {
    return false;
  }

  const count = nextMetadata.cards.length;
  applyDeckDisplay(item, nextMetadata);
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
    cached: 0,
    cacheErrors: 0,
    items: 0,
    urls: 0,
    sized: 0,
  };
  const remoteCache = await cachePlainRemoteSceneImages(items, stats);

  await obr.scene.items.updateItems(items, (draftItems) => {
    for (const item of draftItems) {
      const changed =
        migrateCardItem(item, publicBaseUrl, stats, remoteCache) ||
        migrateDeckItem(item, publicBaseUrl, stats, remoteCache) ||
        migrateImageItem(item, publicBaseUrl, stats, remoteCache);

      if (changed) {
        stats.items += 1;
      }
    }
  });

  if (!stats.items) {
    setMessage("Nao encontrei links locais ou divindades fora do padrao nesta cena.", "warning");
    return;
  }

  const itemLabel = stats.items === 1 ? "1 item" : `${stats.items} itens`;
  const urlLabel = stats.urls === 1 ? "1 imagem" : `${stats.urls} imagens`;
  const divinityLabel =
    stats.sized === 1 ? "1 divindade ajustada" : `${stats.sized} divindades ajustadas`;
  const cachedLabel =
    stats.cached === 1 ? "1 imagem normal otimizada" : `${stats.cached} imagens normais otimizadas`;
  const cacheErrorLabel =
    stats.cacheErrors === 1
      ? "1 imagem normal nao pode ser otimizada"
      : `${stats.cacheErrors} imagens normais nao puderam ser otimizadas`;
  const message = stats.urls
    ? `Migrei ${itemLabel} da cena para usar ${urlLabel} publicas${
        stats.sized || stats.cached || stats.cacheErrors
          ? `; ${[stats.cached ? cachedLabel : "", stats.sized ? divinityLabel : ""]
              .filter(Boolean)
              .concat(stats.cacheErrors ? [cacheErrorLabel] : [])
              .join("; ")}.`
          : "."
      }`
    : stats.sized
      ? `${divinityLabel}.`
      : cacheErrorLabel;

  setMessage(message, "success");
  await obr.notification.show(
    stats.urls ? "Links locais migrados para o GitHub Pages." : "Divindades ajustadas.",
    "SUCCESS",
  );
}

function getScenePresetEntry(presetId) {
  return scenePresetEntries.find((entry) => entry.definition.id === presetId) || null;
}

async function createDefaultBoardFromCurrentScene(presetId) {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para criar o mapa salvo.", "warning");
    return;
  }

  const definition = SCENE_PRESETS.find((preset) => preset.id === presetId);
  const confirmed = window.confirm(
    `Salvar "${definition?.name || "mapa salvo"}" vai substituir esse backup pelo estado atual da cena. Continuar?`,
  );

  if (!confirmed) {
    return;
  }

  const result = await saveScenePreset(obr, presetId);
  await refreshDefaultBoardInfo();

  const itemLabel = result.itemCount === 1 ? "1 item" : `${result.itemCount} itens`;
  const message = `${definition?.name || "Mapa salvo"} criado com ${itemLabel}.`;
  setMessage(message, "success");
  await obr.notification.show("Mapa salvo criado.", "SUCCESS");
}

async function restoreDefaultBoard(presetId) {
  if (!obr) {
    setMessage("Abra esta extensao dentro do Owlbear para restaurar o tabuleiro.", "warning");
    return;
  }

  const entry = getScenePresetEntry(presetId);

  if (!entry?.preset) {
    setMessage("Esse mapa salvo ainda nao foi cadastrado na extensao.", "warning");
    await obr.notification.show("Mapa salvo nao cadastrado.", "WARNING");
    return;
  }

  const restoreStatus = await getSceneRestoreStatus(obr);
  if (restoreStatus.state === "local" || restoreStatus.state === "active") {
    const message = "Ja existe uma restauracao em andamento nesta cena.";
    setMessage(message, "warning");
    await obr.notification.show(message, "WARNING");
    return;
  }

  const recoveringOrphan = restoreStatus.state === "orphan";
  const recoveryWarning = recoveringOrphan
    ? "\n\nFoi encontrada uma restauracao interrompida. Continuar assumira o controle dela."
    : "";
  const confirmed = window.confirm(
    `${entry.definition.restoreLabel} vai substituir a cena atual. Nao inicie outra restauracao em outra conta durante o processo.${recoveryWarning}\n\nContinuar?`,
  );

  if (!confirmed) {
    return;
  }

  sceneRestoreRunning = true;
  updateDefaultBoardControls(true);
  setMessage("Restaurando...", "warning");

  try {
    const result = await restoreDefaultBoardPreset(obr, entry.preset, {
      allowOrphanRecovery: recoveringOrphan,
    });
    const message = `Cena restaurada: ${result.updated} atualizados, ${result.added} recriados, ${result.deleted} removidos.`;
    setMessage(message, "success");
    await obr.notification.show(`${entry.definition.name} restaurado.`, "SUCCESS");
  } finally {
    sceneRestoreRunning = false;
    updateDefaultBoardControls(Boolean(obr));
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

function getNameFromUrl(rawUrl, fallback) {
  try {
    const path = new URL(rawUrl).pathname;
    const filename = path.split("/").filter(Boolean).pop();
    return filename ? decodeURIComponent(filename.replace(/\.[^.]+$/, "")) : fallback;
  } catch {
    return fallback;
  }
}

function getSelectedPresetDeck() {
  const selectedId = elements.presetDeckSelect.value;
  return presetDecks.find((deck) => deck.id === selectedId) || null;
}

function setPresetDeckDefaultControls(deck) {
  if (!deck) {
    elements.presetDeckGridWidth.value = "2";
    elements.presetDeckLayer.value = "PROP";
    return;
  }

  elements.presetDeckGridWidth.value = String(deck.gridWidth || 2);
  if (
    [...elements.presetDeckLayer.options].some((option) => option.value === deck.layer)
  ) {
    elements.presetDeckLayer.value = deck.layer;
  } else {
    elements.presetDeckLayer.value = "PROP";
  }
}

function getSelectedPresetCardGroup() {
  const selectedId = elements.presetCardGroupSelect.value;
  return presetCardGroups.find((group) => group.id === selectedId) || null;
}

function getSelectedPresetCard() {
  const group = getSelectedPresetCardGroup();
  const selectedId = elements.presetCardSelect.value;
  const card = group?.cards.find((entry) => entry.id === selectedId) || null;

  return { group, card };
}

function setPresetCardDefaultControls(group) {
  if (!group) {
    elements.presetCardGridWidth.value = "2";
    elements.presetCardLayer.value = "PROP";
    return;
  }

  elements.presetCardGridWidth.value = String(group.gridWidth || 2);
  if (
    [...elements.presetCardLayer.options].some((option) => option.value === group.layer)
  ) {
    elements.presetCardLayer.value = group.layer;
  } else {
    elements.presetCardLayer.value = "PROP";
  }
}

function updateMissionDeckControls(isConnected = Boolean(obr)) {
  elements.createMissionDeckButton.disabled = !isConnected;
  elements.missionDeckInfo.textContent =
    "Selecione exatamente 5 cartas sacadas para unir em uma pilha temporaria.";
}

function updatePresetDeckControls(isConnected = Boolean(obr), syncDefaults = false) {
  const hasDecks = presetDecks.length > 0;
  const deck = hasDecks ? getSelectedPresetDeck() : null;
  const isReady = isPresetDeckReady(deck);

  elements.presetDeckSelect.disabled = !hasDecks;
  elements.presetDeckGridWidth.disabled = !hasDecks;
  elements.presetDeckLayer.disabled = !hasDecks;
  elements.importPresetDeckButton.disabled = !isConnected || !isReady;

  if (syncDefaults) {
    setPresetDeckDefaultControls(deck);
  }

  syncAllCustomSelects();

  if (!hasDecks) {
    elements.presetDeckInfo.textContent = "Nenhuma pilha cadastrada na biblioteca.";
    return;
  }

  if (!deck) {
    elements.presetDeckInfo.textContent = "Escolha uma pilha da biblioteca.";
    return;
  }

  if (!isReady) {
    elements.presetDeckInfo.textContent =
      "Esta pilha ja existe no catalogo, mas ainda precisa de verso e cartas.";
    return;
  }

  const count = deck.cards.length;
  elements.presetDeckInfo.textContent =
    count === 1
      ? `1 carta cadastrada. Padrao: ${deck.gridWidth} no grid.`
      : `${count} cartas cadastradas. Padrao: ${deck.gridWidth} no grid.`;
}

function populatePresetDeckSelect() {
  elements.presetDeckSelect.replaceChildren();

  if (!presetDecks.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhuma pilha cadastrada";
    elements.presetDeckSelect.append(option);
    updatePresetDeckControls(Boolean(obr), true);
    updateMissionDeckControls(Boolean(obr));
    return;
  }

  for (const deck of presetDecks) {
    const option = document.createElement("option");
    option.value = deck.id;
    option.textContent = isPresetDeckReady(deck)
      ? `${deck.name} (${deck.cards.length})`
      : `${deck.name} (configurar imagens)`;
    elements.presetDeckSelect.append(option);
  }

  updatePresetDeckControls(Boolean(obr), true);
  updateMissionDeckControls(Boolean(obr));
}

function updatePresetCardControls(isConnected = Boolean(obr), syncDefaults = false) {
  const hasGroups = presetCardGroups.length > 0;
  const { group, card } = hasGroups ? getSelectedPresetCard() : { group: null, card: null };
  const hasCards = Boolean(group?.cards?.length);
  const isReady = isPresetCardReady(group, card);

  elements.presetCardGroupSelect.disabled = !hasGroups;
  elements.presetCardSelect.disabled = !hasCards;
  elements.presetCardGridWidth.disabled = !hasGroups;
  elements.presetCardLayer.disabled = !hasGroups;
  elements.importPresetCardButton.disabled = !isConnected || !isReady;

  if (syncDefaults) {
    setPresetCardDefaultControls(group);
  }

  syncAllCustomSelects();

  if (!hasGroups) {
    elements.presetCardInfo.textContent = "Nenhuma carta cadastrada na biblioteca.";
    return;
  }

  if (!group) {
    elements.presetCardInfo.textContent = "Escolha um grupo de cartas.";
    return;
  }

  if (!hasCards) {
    elements.presetCardInfo.textContent =
      "Este grupo ja existe no catalogo, mas ainda precisa de verso e cartas.";
    return;
  }

  if (!isReady) {
    elements.presetCardInfo.textContent =
      "Esta carta ainda precisa de frente e verso no catalogo.";
    return;
  }

  const categoryLabel = group.category
    ? " Marca automatica para selecao de personagem."
    : "";
  elements.presetCardInfo.textContent =
    `${group.cards.length} cartas cadastradas. Padrao: ${group.gridWidth} no grid.${categoryLabel}`;
}

function populatePresetCardSelect(syncDefaults = false) {
  const group = getSelectedPresetCardGroup();
  elements.presetCardSelect.replaceChildren();

  if (!group?.cards?.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhuma carta cadastrada";
    elements.presetCardSelect.append(option);
    updatePresetCardControls(Boolean(obr), syncDefaults);
    return;
  }

  for (const card of group.cards) {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = isPresetCardReady(group, card)
      ? card.name
      : `${card.name} (configurar imagens)`;
    elements.presetCardSelect.append(option);
  }

  updatePresetCardControls(Boolean(obr), syncDefaults);
}

function populatePresetCardGroupSelect() {
  elements.presetCardGroupSelect.replaceChildren();

  if (!presetCardGroups.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhuma carta cadastrada";
    elements.presetCardGroupSelect.append(option);
    populatePresetCardSelect(true);
    return;
  }

  for (const group of presetCardGroups) {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.cards.length
      ? `${group.name} (${group.cards.length})`
      : `${group.name} (configurar imagens)`;
    elements.presetCardGroupSelect.append(option);
  }

  populatePresetCardSelect(true);
}

async function loadPresetLibrary() {
  [presetDecks, presetCardGroups] = await Promise.all([
    loadPresetDecks(),
    loadPresetCardGroups(),
  ]);
  populatePresetDeckSelect();
  populatePresetCardGroupSelect();
}

function getPresetDeckGridWidth() {
  const gridWidth = Number.parseFloat(elements.presetDeckGridWidth.value);

  if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
    throw new Error("A largura no grid da biblioteca precisa ser maior que zero.");
  }

  return gridWidth;
}

function getPresetCardGridWidth() {
  const gridWidth = Number.parseFloat(elements.presetCardGridWidth.value);

  if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
    throw new Error("A largura no grid da carta precisa ser maior que zero.");
  }

  return gridWidth;
}

async function addDeckToScene({
  name,
  back,
  cards,
  gridWidth,
  layer,
  position,
  deleteWhenEmpty = false,
}) {
  const deckPosition = position || (await getViewportCenter());
  const metadata = createDeckMetadata({ name, back, cards, gridWidth, deleteWhenEmpty });
  const item = buildImage(createImageData(back), createGridData(back, gridWidth))
    .name(`${name} (${cards.length})`)
    .description(deckDescription(cards.length))
    .text(createDeckText(cards.length))
    .layer(layer)
    .position(deckPosition)
    .metadata(createDeckMetadataMap(metadata))
    .build();

  await obr.scene.items.addItems([item]);
  return item;
}

async function addCardToScene({
  name,
  front,
  back,
  gridWidth,
  layer,
  category,
  origin,
  position,
}) {
  const cardPosition = position || (await getViewportCenter());
  const metadata = createCardMetadata({ name, front, back, gridWidth, origin });
  const metadataMap = createCardMetadataMap(metadata);

  if (category) {
    metadataMap[CARD_CATEGORY_KEY] = {
      version: 1,
      category,
    };
  }

  const item = buildImage(createImageData(front), createGridData(front, gridWidth, origin))
    .name(name)
    .description("Carta dupla: frente")
    .layer(layer)
    .position(cardPosition)
    .metadata(metadataMap)
    .build();

  applyCardFaceTransform(item, metadata, "front");
  applyDivinitySizing(item, front);
  await obr.scene.items.addItems([item]);
  return item;
}

async function createMissionDeck() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para criar a pilha.", "warning");
    return;
  }

  elements.createMissionDeckButton.disabled = true;
  setMessage("Criando pilha de missao...", "neutral");

  try {
    const deck = await createMissionDeckFromSelection(obr, buildImage);

    if (deck?.id) {
      await obr.player.select([deck.id], true);
      lastDeckSelection = [deck.id];
      lastFlipSelection = [deck.id];
    }
    lastCardSelection = [];
    await obr.notification.show("Pilha de missao criada.", "SUCCESS");
    setMessage("Pilha de missao criada com 5 cartas selecionadas.", "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui criar a pilha de missao.", "error");
  } finally {
    updateMissionDeckControls(Boolean(obr));
  }
}

async function createPresetDeck() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para criar uma pilha.", "warning");
    return;
  }

  const deck = getSelectedPresetDeck();
  if (!deck) {
    setMessage("Escolha uma pilha da biblioteca.", "warning");
    return;
  }

  if (!isPresetDeckReady(deck)) {
    setMessage("Esta pilha ainda precisa de verso e cartas no catalogo.", "warning");
    return;
  }

  elements.importPresetDeckButton.disabled = true;
  setMessage("Criando pilha da biblioteca...", "neutral");

  try {
    const deckData = await buildPresetDeckData(deck);
    const gridWidth = getPresetDeckGridWidth();
    await addDeckToScene({
      ...deckData,
      gridWidth,
      layer: elements.presetDeckLayer.value || deckData.layer,
    });
    await obr.notification.show(`Pilha "${deckData.name}" criada.`);
    setMessage(`Pilha "${deckData.name}" criada da biblioteca.`, "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui criar a pilha da biblioteca.", "error");
  } finally {
    updatePresetDeckControls(Boolean(obr));
  }
}

async function createPresetCard() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensao dentro do Owlbear Rodeo para criar uma carta.", "warning");
    return;
  }

  const { group, card } = getSelectedPresetCard();
  if (!group || !card) {
    setMessage("Escolha uma carta da biblioteca.", "warning");
    return;
  }

  if (!isPresetCardReady(group, card)) {
    setMessage("Esta carta ainda precisa de frente e verso no catalogo.", "warning");
    return;
  }

  elements.importPresetCardButton.disabled = true;
  setMessage("Criando carta da biblioteca...", "neutral");

  try {
    const cardData = await buildPresetCardData(group, card);
    const gridWidth = getPresetCardGridWidth();
    await addCardToScene({
      ...cardData,
      gridWidth,
      layer: elements.presetCardLayer.value || cardData.layer,
      origin: cardData.origin,
    });
    await obr.notification.show(`Carta "${cardData.name}" criada.`);
    setMessage(`Carta "${cardData.name}" criada da biblioteca.`, "success");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Nao consegui criar a carta da biblioteca.", "error");
  } finally {
    updatePresetCardControls(Boolean(obr));
  }
}

async function init() {
  enhancePanelSelects();

  elements.presetDeckSelect.addEventListener("change", () =>
    updatePresetDeckControls(Boolean(obr), true),
  );
  elements.presetCardGroupSelect.addEventListener("change", () =>
    populatePresetCardSelect(true),
  );
  elements.presetCardSelect.addEventListener("change", () =>
    updatePresetCardControls(Boolean(obr)),
  );
  elements.importPresetDeckButton.addEventListener("click", () =>
    createPresetDeck().catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui criar a pilha da biblioteca.", "error");
    }),
  );
  elements.importPresetCardButton.addEventListener("click", () =>
    createPresetCard().catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui criar a carta da biblioteca.", "error");
    }),
  );
  elements.createMissionDeckButton.addEventListener("click", () =>
    createMissionDeck().catch((error) => {
      console.error(error);
      setMessage(error.message || "Nao consegui criar a pilha de missao.", "error");
    }),
  );
  loadPresetLibrary().catch((error) => {
    console.warn(error);
    presetDecks = [];
    presetCardGroups = [];
    populatePresetDeckSelect();
    populatePresetCardGroupSelect();
    elements.presetDeckInfo.textContent =
      error.message || "Nao consegui carregar a biblioteca de pilhas.";
    elements.presetCardInfo.textContent =
      error.message || "Nao consegui carregar a biblioteca de cartas.";
  });
  elements.publicBaseUrl.value = getDefaultPublicBaseUrl();
  elements.panelFlipButton.addEventListener("click", () =>
    runPanelAction(elements.panelFlipButton, async () => {
      const fallbackSelection = lastFlipSelection.length
        ? lastFlipSelection
        : lastDeckSelection.length
          ? lastDeckSelection
          : lastCardSelection;
      const count = await flipSelectedItems(obr, fallbackSelection);
      await showPanelActionResult(
        count,
        "Carta virada.",
        (total) => `${total} itens virados.`,
        "Selecione uma carta dupla ou uma pilha com cartas para virar.",
      );
    }),
  );
  elements.panelDrawButton.addEventListener("click", () =>
    runPanelAction(elements.panelDrawButton, async () => {
      const count = await drawSelectedDecks(obr, buildImage, lastDeckSelection);
      if (count) {
        lastFlipSelection = lastDeckSelection;
        lastCardSelection = [];
      }
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
      if (!count) {
        await showPanelActionResult(
          count,
          "",
          () => "",
          "Selecione uma carta comprada com pilha de origem.",
        );
        return;
      }

      lastCardSelection = [];
      lastFlipSelection = lastDeckSelection;
      setMessage("", "neutral");
    }),
  );
  elements.returnOriginButton.addEventListener("click", () =>
    runPanelAction(elements.returnOriginButton, async () => {
      await returnSelectedCardToOrigin(obr, lastCardSelection);
      const message = "Carta devolvida para a posicao original.";
      setMessage(message, "success");
      await obr.notification.show(message, "SUCCESS");
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
  for (const button of elements.createScenePresetButtons) {
    button.addEventListener("click", () =>
      runPanelAction(button, () => createDefaultBoardFromCurrentScene(button.dataset.createScenePreset)),
    );
  }
  for (const button of elements.restoreScenePresetButtons) {
    button.addEventListener("click", () =>
      runPanelAction(button, () => restoreDefaultBoard(button.dataset.restoreScenePreset)),
    );
  }

  setConnectionStatus("Painel carregado; conectando...", false);
  setMessage("Previa ativa. Conectando ao Owlbear...", "neutral");

  try {
    const loaded =
      (await window.doubleSidedCardsSdkReady) ||
      (await import("./" + "sdk-client.js?v=65").then((sdkModule) =>
        sdkModule.loadOwlbearSdk(20000),
      ));
    obr = loaded.OBR;
    buildImage = loaded.sdk.buildImage;
    obr.broadcast
      .sendMessage(COMMANDS_CHANNEL, { type: "register-commands" }, { destination: "LOCAL" })
      .catch((error) => {
        console.warn("Nao consegui pedir o registro dos comandos", error);
    });
    const selection = await obr.player.getSelection();
    await rememberSelection(selection);
    await refreshDefaultBoardInfo();
    await refreshPlayerColorAssignments();
    obr.player.onChange((player) => {
      rememberSelection(player.selection).catch((error) => {
        console.warn("Nao consegui atualizar a selecao do painel", error);
      });
      schedulePlayerColorAssignmentsRefresh();
    });
    if (obr.party?.onChange) {
      obr.party.onChange((players) => {
        schedulePlayerColorAssignmentsRefresh(players);
      });
    }
    if (colorAssignmentsRefreshTimer) {
      window.clearTimeout(colorAssignmentsRefreshTimer);
    }
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
