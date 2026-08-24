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
  isPresetDeckConfigured,
  loadPresetDecks,
} from "./preset-decks.js";
import {
  buildPresetCardData,
  isPresetCardConfigured,
  loadPresetCardGroups,
} from "./preset-cards.js";
import {
  createPrivateScene,
  loadScenePresetEntries,
  saveScenePreset,
  SCENE_PRESETS,
} from "./scene-preset.js";
import {
  ACTIVE_COLOR_KEY,
  CARD_CATEGORY_KEY,
  PLAYER_COLORS,
  returnSelectedCardToOrigin,
} from "./selection-board.js";
import {
  clearPrivateAssetPack,
  getPrivateAssetPackStatus,
  resolveAssetReferences,
} from "./asset-resolver.js";
import {
  configurePrivateAssetPack,
  linkPrivateAssetPackFromOwlbear,
  readPrivateAssetPackFiles,
  uploadPrivateAssetPack,
} from "./private-asset-pack.js";
import { runPrivateAssetUploadResponseConsoleProbe } from "./private-asset-upload-probe.js";

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
  privatePackInput: document.querySelector("#privatePackInput"),
  privatePackChooseButton: document.querySelector("#privatePackChooseButton"),
  privatePackUploadButton: document.querySelector("#privatePackUploadButton"),
  privatePackLinkButton: document.querySelector("#privatePackLinkButton"),
  privatePackClearButton: document.querySelector("#privatePackClearButton"),
  privatePackInfo: document.querySelector("#privatePackInfo"),
  developmentSaveSceneButtons: [...document.querySelectorAll("[data-save-scene-preset]")],
  createScenePresetButtons: [...document.querySelectorAll("[data-create-scene-preset]")],
  defaultBoardInfo: document.querySelector("#defaultBoardInfo"),
  connectionStatus: document.querySelector("#connectionStatus"),
  message: document.querySelector("#message"),
};

let obr = null;
let buildImage = null;
let buildImageUpload = null;
let buildSceneUpload = null;
let lastCardSelection = [];
let lastDeckSelection = [];
let lastFlipSelection = [];
let presetDecks = [];
let presetCardGroups = [];
let scenePresetEntries = [];
let sceneCreationRunning = false;
let privatePackRunning = false;
let selectedPrivatePack = null;
let colorAssignmentsRefreshTimer = null;
const customSelects = new Map();

window.addEventListener("error", (event) => {
  if (!obr) {
    setConnectionStatus("Erro no painel", false);
  }
  setMessage(`Erro no painel: ${getErrorMessage(event.error || event.message)}`, "error");
});

window.addEventListener("unhandledrejection", (event) => {
  if (!obr) {
    setConnectionStatus("Erro no painel", false);
  }
  setMessage(`Erro no painel: ${getErrorMessage(event.reason)}`, "error");
});

function getErrorMessage(error, fallback = "Ocorreu um erro inesperado.") {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

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
  updatePrivatePackControls(isConnected);
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

function updatePrivatePackControls(isConnected = Boolean(obr)) {
  const status = getPrivateAssetPackStatus();
  elements.privatePackChooseButton.disabled = privatePackRunning;
  elements.privatePackUploadButton.disabled =
    privatePackRunning || !isConnected || !selectedPrivatePack?.assetFiles?.size;
  elements.privatePackLinkButton.disabled =
    privatePackRunning || !isConnected || !status.configured;
  elements.privatePackClearButton.disabled = privatePackRunning || !status.configured;

  if (!status.configured) {
    elements.privatePackInfo.textContent =
      "Core público ativo. Configure um pack privado para habilitar bibliotecas e mapas pessoais.";
    return;
  }

  elements.privatePackInfo.textContent =
    `${status.name || status.id}: ${status.total} assets disponíveis, ` +
    `${formatRuntimeSize(status.runtimeSize)}; ${status.linked} assets vinculados neste navegador.`;
}

function formatPrivateAssetIds(assetIds) {
  return assetIds.join(", ");
}

function requirePrivateDependencies(value, actionLabel) {
  const resolution = resolveAssetReferences(value);
  if (resolution.unresolved) {
    const count = resolution.unresolved;
    throw new Error(
      `Não é possível ${actionLabel}: ${count} ${count === 1 ? "asset privado necessário não está acessível" : "assets privados necessários não estão acessíveis"} ` +
        `como vínculo no Owlbear. Use “Vincular manualmente” e selecione ${count === 1 ? "este asset" : "estes assets"}: ` +
        formatPrivateAssetIds(resolution.unresolvedIds),
    );
  }

  return resolution;
}

async function showNotification(text, tone) {
  if (!obr?.notification?.show) {
    return;
  }

  try {
    if (tone) {
      await obr.notification.show(text, tone);
    } else {
      await obr.notification.show(text);
    }
  } catch (error) {
    console.warn("Nao consegui exibir a notificacao do Owlbear", error);
  }
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
      item.textContent = "Não consegui ler os jogadores.";
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

function formatRuntimeSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MiB";
  }
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} MiB`;
}

function updateDefaultBoardControls(isConnected = Boolean(obr)) {
  const entriesById = new Map(scenePresetEntries.map((entry) => [entry.definition.id, entry]));

  for (const button of elements.developmentSaveSceneButtons) {
    button.hidden = true;
    button.disabled = true;
  }

  for (const button of elements.createScenePresetButtons) {
    const entry = entriesById.get(button.dataset.createScenePreset);
    button.disabled =
      sceneCreationRunning || !isConnected || !entry?.ready || !(entry?.preset || entry?.summary);
  }

  if (!scenePresetEntries.length) {
    elements.defaultBoardInfo.textContent = "Carregando templates privados...";
    return;
  }

  const loadError = scenePresetEntries.find((entry) => entry.loadError)?.loadError;
  if (loadError) {
    elements.defaultBoardInfo.textContent = loadError;
    return;
  }

  const parts = scenePresetEntries.map(
    ({ definition, preset, ready, summary, unresolvedAssetIds }) => {
      const details = preset || summary;
      const displayName = definition.label || definition.name;
      if (!details) {
        return `${displayName}: não cadastrado`;
      }
      if (!ready) {
        const count = unresolvedAssetIds?.length || 0;
        return (
          `${displayName}: criação automática indisponível; ${count} ` +
          `${count === 1 ? "asset precisa" : "assets precisam"} ser ` +
          `vinculado${count === 1 ? "" : "s"} manualmente no Owlbear`
        );
      }

      const itemLabel = details.itemCount === 1 ? "1 item" : `${details.itemCount} itens`;
      const environment = details.grid || details.fog ? "grid/fog capturados" : "grid/fog legado";
      return `${displayName}: ${itemLabel}, salvo em ${formatPresetDate(details.savedAt)}, ${environment}`;
    },
  );

  elements.defaultBoardInfo.textContent =
    "A criação automática depende de todos os assets da cena estarem acessíveis pelo Owlbear. " +
    parts.join(" | ");
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
    await showNotification(warning, "WARNING");
    return;
  }

  const message = count === 1 ? singular : plural(count);
  setMessage(message, "success");
  await showNotification(message, "SUCCESS");
}

async function runPanelAction(button, action, pendingMessage = "") {
  if (!obr) {
    setMessage("Abra esta extensão dentro do Owlbear para usar os comandos.", "warning");
    return;
  }

  button.disabled = true;
  if (pendingMessage) {
    setMessage(pendingMessage, "neutral");
  }
  try {
    await refreshPanelSelectionMemory();
    await action();
  } catch (error) {
    console.error(error);
    setMessage(getErrorMessage(error, "Não consegui executar a ação."), "error");
  } finally {
    button.disabled = false;
  }
}

function getSelectLabel(select) {
  return select.selectedOptions?.[0]?.textContent || select.options?.[0]?.textContent || "Escolha uma opção";
}

function getSelectFieldLabel(select) {
  return select.closest("label")?.querySelector("span")?.textContent?.trim() || "";
}

function getEnabledCustomSelectOptions(state) {
  return [...state.menu.querySelectorAll(".custom-select__option:not(:disabled)")];
}

function focusCustomSelectOption(select, direction = 1) {
  const state = customSelects.get(select);
  if (!state) {
    return;
  }

  const options = [...state.menu.querySelectorAll(".custom-select__option")];
  const selectedIndex = [...select.options].findIndex((option) => option.selected);
  const selectedItem = options[selectedIndex];
  const enabledOptions = getEnabledCustomSelectOptions(state);
  const target =
    (selectedItem && !selectedItem.disabled && selectedItem) ||
    (direction < 0 ? enabledOptions.at(-1) : enabledOptions[0]);
  target?.focus();
}

function moveCustomSelectFocus(select, currentItem, direction) {
  const state = customSelects.get(select);
  if (!state) {
    return;
  }

  const options = getEnabledCustomSelectOptions(state);
  const currentIndex = options.indexOf(currentItem);
  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), options.length - 1);
  options[nextIndex]?.focus();
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
      state.button.focus();
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        item.click();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeCustomSelect(select);
        state.button.focus();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveCustomSelectFocus(select, item, event.key === "ArrowDown" ? 1 : -1);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const enabledOptions = getEnabledCustomSelectOptions(state);
        (event.key === "Home" ? enabledOptions[0] : enabledOptions.at(-1))?.focus();
      }
    });
    state.menu.append(item);
  }
}

function openCustomSelect(select, focusOption = false, direction = 1) {
  const state = customSelects.get(select);

  if (!state || select.disabled) {
    return;
  }

  closeOtherCustomSelects(select);
  buildCustomSelectMenu(select);
  state.root.dataset.open = "true";
  state.menu.hidden = false;
  state.button.setAttribute("aria-expanded", "true");
  if (focusOption) {
    focusCustomSelectOption(select, direction);
  }
}

function syncCustomSelect(select) {
  const state = customSelects.get(select);

  if (!state) {
    return;
  }

  const selectedLabel = getSelectLabel(select);
  state.button.textContent = selectedLabel;
  state.button.setAttribute(
    "aria-label",
    state.fieldLabel ? `${state.fieldLabel}: ${selectedLabel}` : selectedLabel,
  );
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
  menu.id = `${select.id || `select-${customSelects.size + 1}`}-menu`;
  const fieldLabel = getSelectFieldLabel(select);
  if (fieldLabel) {
    menu.setAttribute("aria-label", fieldLabel);
  }
  button.setAttribute("aria-controls", menu.id);

  root.append(button, menu);
  select.after(root);

  const observer = new MutationObserver(() => syncCustomSelect(select));
  observer.observe(select, {
    attributes: true,
    attributeFilter: ["disabled"],
    childList: true,
    subtree: true,
  });

  customSelects.set(select, { button, fieldLabel, menu, observer, root });

  button.addEventListener("click", (event) => {
    event.stopPropagation();

    if (root.dataset.open === "true") {
      closeCustomSelect(select);
      return;
    }

    openCustomSelect(select, event.detail === 0);
  });

  button.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCustomSelect(select);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (root.dataset.open === "true") {
        closeCustomSelect(select);
      } else {
        openCustomSelect(select, true);
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openCustomSelect(select, true, event.key === "ArrowDown" ? 1 : -1);
    }
  });

  root.addEventListener("focusout", () => {
    window.requestAnimationFrame(() => {
      if (!root.contains(document.activeElement)) {
        closeCustomSelect(select);
      }
    });
  });

  select.addEventListener("change", () => syncCustomSelect(select));
  syncCustomSelect(select);
}

function enhancePanelSelects() {
  for (const select of document.querySelectorAll("select")) {
    enhanceCustomSelect(select);
  }

  document.addEventListener("click", (event) => {
    for (const [select, { root }] of customSelects.entries()) {
      if (!root.contains(event.target)) {
        closeCustomSelect(select);
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

  if (stats.assets) {
    parts.push(
      stats.assets === 1
        ? "1 referência de asset migrada"
        : `${stats.assets} referências de assets migradas`,
    );
  }

  return `Cena sincronizada: ${parts.join(", ")}.`;
}

async function repairSceneMetadata() {
  const items = await obr.scene.items.getItems();
  const repairableItems = [];
  const stats = { cards: 0, decks: 0, assets: 0 };

  for (const item of items) {
    const resolution = resolveAssetReferences(item);
    const resolvedItem = resolution.value;
    const card = normalizeCardMetadata(getCardMetadata(resolvedItem), { item: resolvedItem });

    if (card.ok) {
      repairableItems.push(item);
      stats.cards += 1;
      stats.assets += resolution.resolved;
      continue;
    }

    const deck = normalizeDeckMetadata(getDeckMetadata(resolvedItem), { item: resolvedItem });

    if (deck.ok) {
      repairableItems.push(item);
      stats.decks += 1;
      stats.assets += resolution.resolved;
      continue;
    }

    if (resolution.resolved) {
      repairableItems.push(item);
      stats.assets += resolution.resolved;
    }
  }

  if (repairableItems.length) {
    await obr.scene.items.updateItems(repairableItems, (draftItems) => {
      for (const item of draftItems) {
        const resolution = resolveAssetReferences(item);
        Object.assign(item, resolution.value);
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


function getScenePresetEntry(presetId) {
  return scenePresetEntries.find((entry) => entry.definition.id === presetId) || null;
}

async function createDefaultBoardFromCurrentScene(presetId) {
  if (!obr) {
    setMessage("Abra esta extensão dentro do Owlbear para criar o mapa salvo.", "warning");
    return;
  }

  const definition = SCENE_PRESETS.find((preset) => preset.id === presetId);
  const confirmed = window.confirm(
    `Salvar "${definition?.label || definition?.name || "mapa salvo"}" vai substituir esse backup pelo estado atual da cena. Continuar?`,
  );

  if (!confirmed) {
    return;
  }

  setMessage("Salvando o mapa...", "neutral");
  const result = await saveScenePreset(obr, presetId);
  const entry = getScenePresetEntry(presetId);
  if (entry) {
    entry.summary = {
      itemCount: result.itemCount,
      savedAt: result.savedAt,
    };
    entry.preset = null;
    updateDefaultBoardControls(true);
  }

  const itemLabel = result.itemCount === 1 ? "1 item" : `${result.itemCount} itens`;
  const message = `${definition?.label || definition?.name || "Mapa salvo"} criado com ${itemLabel}.`;
  setMessage(message, "success");
  await showNotification("Mapa salvo criado.", "SUCCESS");
}

async function createSceneFromPrivatePreset(presetId) {
  if (!obr || !buildSceneUpload) {
    setMessage("Abra esta extensão dentro do Owlbear para criar a cena.", "warning");
    return;
  }
  if (sceneCreationRunning) {
    setMessage("Já existe uma criação de cena em andamento neste painel.", "warning");
    return;
  }

  const entry = getScenePresetEntry(presetId);
  if (!entry?.preset) {
    setMessage("Esse template privado não está configurado no pack.", "warning");
    return;
  }

  sceneCreationRunning = true;
  updateDefaultBoardControls(true);
  setMessage("Montando a nova cena com os assets vinculados...", "neutral");
  try {
    const displayName = entry.definition.label || entry.definition.name;
    requirePrivateDependencies(entry.preset, `criar ${displayName}`);
    const result = await createPrivateScene(obr, buildSceneUpload, entry.preset);
    const fallback = result.usedCapturedGrid && result.usedCapturedFog
      ? ""
      : " O template legado usou o fallback do SDK para grid/fog ausentes.";
    setMessage(
      `${displayName} criado com ${result.itemCount} itens e enviado ao Atlas.${fallback}`,
      fallback ? "warning" : "success",
    );
    await showNotification(`${displayName} criado no Atlas.`, "SUCCESS");
  } finally {
    sceneCreationRunning = false;
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
    "Selecione exatamente 5 cartas sacadas para unir em uma pilha temporária.";
}

function updatePresetDeckControls(isConnected = Boolean(obr), syncDefaults = false) {
  const hasDecks = presetDecks.length > 0;
  const deck = hasDecks ? getSelectedPresetDeck() : null;
  const isReady = isPresetDeckConfigured(deck);

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
      "Esta pilha já existe no catálogo, mas ainda precisa de verso e cartas.";
    return;
  }

  const count = deck.cards.length;
  elements.presetDeckInfo.textContent =
    count === 1
      ? `1 carta cadastrada. Padrão: ${deck.gridWidth} no grid.`
      : `${count} cartas cadastradas. Padrão: ${deck.gridWidth} no grid.`;
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
    option.textContent = isPresetDeckConfigured(deck)
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
  const isReady = isPresetCardConfigured(group, card);

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
      "Este grupo já existe no catálogo, mas ainda precisa de verso e cartas.";
    return;
  }

  if (!isReady) {
    elements.presetCardInfo.textContent =
      "Esta carta ainda precisa de frente e verso no catálogo.";
    return;
  }

  const categoryLabel = group.category
    ? " Marca automática para seleção de personagem."
    : "";
  elements.presetCardInfo.textContent =
    `${group.cards.length} cartas cadastradas. Padrão: ${group.gridWidth} no grid.${categoryLabel}`;
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
    option.textContent = isPresetCardConfigured(group, card)
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

async function reloadPrivateContent() {
  await Promise.all([loadPresetLibrary(), refreshDefaultBoardInfo()]);
  updatePrivatePackControls(Boolean(obr));
}

async function configureSelectedPrivatePack(files) {
  privatePackRunning = true;
  updatePrivatePackControls(Boolean(obr));
  setMessage("Lendo o Private Asset Pack...", "neutral");

  try {
    const imported = await readPrivateAssetPackFiles(files);
    configurePrivateAssetPack(imported);
    selectedPrivatePack = imported;
    await reloadPrivateContent();
    const missingFiles = imported.pack
      ? Object.keys(imported.pack.assets).length - imported.assetFiles.size
      : 0;
    setMessage(
      missingFiles
        ? `Pack configurado, mas ${missingFiles} arquivos canônicos não estavam na pasta selecionada.`
        : "Pack configurado. O upload e o vínculo manual no Owlbear são recursos opcionais.",
      missingFiles ? "warning" : "success",
    );
  } finally {
    privatePackRunning = false;
    elements.privatePackInput.value = "";
    updatePrivatePackControls(Boolean(obr));
  }
}

async function uploadSelectedPrivatePack() {
  if (!obr || !buildImageUpload || !selectedPrivatePack) {
    throw new Error("Selecione o Private Asset Pack antes de enviar os assets.");
  }

  const confirmed = window.confirm(
    `Enviar ${selectedPrivatePack.assetFiles.size} assets canônicos para a biblioteca privada do Owlbear?`,
  );
  if (!confirmed) {
    setMessage(
      `Envio cancelado pelo usuário antes de iniciar: 0 de ${selectedPrivatePack.assetFiles.size} assets processados.`,
      "warning",
    );
    return { cancelled: true };
  }

  privatePackRunning = true;
  updatePrivatePackControls(true);
  try {
    const result = await uploadPrivateAssetPack(
      obr,
      buildImageUpload,
      selectedPrivatePack,
      ({ stage, processed, total, groupSize, assetId, assetName }) => {
        if (stage === "preparing") {
          setMessage(
            `Preparando arquivos para o Owlbear: ${processed} de ${total}. ` +
              `${assetName || "Asset sem nome"}${assetId ? ` (${assetId})` : ""}.`,
            "neutral",
          );
          return;
        }
        if (stage === "uploading") {
          setMessage(
            `Enviando à API do Owlbear: ${processed} de ${total} uploads confirmados; ` +
              `aguardando a operação com ${groupSize} assets.`,
            "neutral",
          );
          return;
        }
        setMessage(`Envio confirmado pelo Owlbear: ${processed} de ${total} assets.`, "neutral");
      },
    );
    setMessage(
      `${result.uploaded} assets enviados ao Owlbear. Para usar um asset privado, vincule-o manualmente quando desejar.`,
      result.missingFiles ? "warning" : "success",
    );
  } finally {
    privatePackRunning = false;
    updatePrivatePackControls(Boolean(obr));
  }
}

async function linkConfiguredPrivatePack() {
  if (!obr) {
    throw new Error("Abra a extensão dentro do Owlbear para vincular os assets.");
  }

  privatePackRunning = true;
  updatePrivatePackControls(true);
  setMessage("Selecione no Owlbear os assets do pack que deseja vincular...", "neutral");
  try {
    const result = await linkPrivateAssetPackFromOwlbear(obr);
    await reloadPrivateContent();
    const packStatus = getPrivateAssetPackStatus();
    const stats = await repairSceneMetadata();
    const suffix = stats.assets
      ? ` ${stats.assets} referências da cena atual foram migradas.`
      : "";
    setMessage(
      result.linked
        ? `${result.linked} assets reconhecidos nesta seleção; ${packStatus.linked} vinculados neste navegador. ` +
          `${result.unmatched.length} selecionados não corresponderam ao pack.${suffix}`
        : `Nenhum dos ${result.selected} assets selecionados correspondeu ao manifesto; os ${packStatus.linked} vínculos anteriores foram preservados.`,
      result.linked ? (result.unmatched.length ? "warning" : "success") : "warning",
    );
  } finally {
    privatePackRunning = false;
    updatePrivatePackControls(Boolean(obr));
  }
}

async function removeConfiguredPrivatePack() {
  if (!window.confirm("Remover deste navegador a configuração e os vínculos do pack privado?")) {
    return;
  }

  clearPrivateAssetPack();
  selectedPrivatePack = null;
  await reloadPrivateContent();
  setMessage("Configuração local do Private Asset Pack removida. O Core público continua ativo.", "success");
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
    setMessage("Abra esta extensão dentro do Owlbear Rodeo para criar a pilha.", "warning");
    return;
  }

  elements.createMissionDeckButton.disabled = true;
  setMessage("Criando pilha de missão...", "neutral");

  try {
    const deck = await createMissionDeckFromSelection(obr, buildImage);

    if (deck?.id) {
      await obr.player.select([deck.id], true);
      lastDeckSelection = [deck.id];
      lastFlipSelection = [deck.id];
    }
    lastCardSelection = [];
    setMessage("Pilha de missão criada com 5 cartas selecionadas.", "success");
    await showNotification("Pilha de missão criada.", "SUCCESS");
  } catch (error) {
    console.error(error);
    setMessage(getErrorMessage(error, "Não consegui criar a pilha de missão."), "error");
  } finally {
    updateMissionDeckControls(Boolean(obr));
  }
}

async function createPresetDeck() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensão dentro do Owlbear Rodeo para criar uma pilha.", "warning");
    return;
  }

  const deck = getSelectedPresetDeck();
  if (!deck) {
    setMessage("Escolha uma pilha da biblioteca.", "warning");
    return;
  }

  if (!isPresetDeckConfigured(deck)) {
    setMessage("Esta pilha ainda precisa de verso e cartas no catálogo.", "warning");
    return;
  }

  elements.importPresetDeckButton.disabled = true;
  setMessage("Criando pilha da biblioteca...", "neutral");

  try {
    requirePrivateDependencies(deck, `criar a pilha "${deck.name}"`);
    const deckData = await buildPresetDeckData(deck);
    const gridWidth = getPresetDeckGridWidth();
    await addDeckToScene({
      ...deckData,
      gridWidth,
      layer: elements.presetDeckLayer.value || deckData.layer,
    });
    setMessage(`Pilha "${deckData.name}" criada da biblioteca.`, "success");
    await showNotification(`Pilha "${deckData.name}" criada.`);
  } catch (error) {
    console.error(error);
    setMessage(getErrorMessage(error, "Não consegui criar a pilha da biblioteca."), "error");
  } finally {
    updatePresetDeckControls(Boolean(obr));
  }
}

async function createPresetCard() {
  if (!obr || !buildImage) {
    setMessage("Abra esta extensão dentro do Owlbear Rodeo para criar uma carta.", "warning");
    return;
  }

  const { group, card } = getSelectedPresetCard();
  if (!group || !card) {
    setMessage("Escolha uma carta da biblioteca.", "warning");
    return;
  }

  if (!isPresetCardConfigured(group, card)) {
    setMessage("Esta carta ainda precisa de frente e verso no catálogo.", "warning");
    return;
  }

  elements.importPresetCardButton.disabled = true;
  setMessage("Criando carta da biblioteca...", "neutral");

  try {
    const back = card.back?.assetId || card.back?.path ? card.back : group.back;
    requirePrivateDependencies(
      { front: card.front, back },
      `criar a carta "${card.name}"`,
    );
    const cardData = await buildPresetCardData(group, card);
    const gridWidth = getPresetCardGridWidth();
    await addCardToScene({
      ...cardData,
      gridWidth,
      layer: elements.presetCardLayer.value || cardData.layer,
      origin: cardData.origin,
    });
    setMessage(`Carta "${cardData.name}" criada da biblioteca.`, "success");
    await showNotification(`Carta "${cardData.name}" criada.`);
  } catch (error) {
    console.error(error);
    setMessage(getErrorMessage(error, "Não consegui criar a carta da biblioteca."), "error");
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
      setMessage(getErrorMessage(error, "Não consegui criar a pilha da biblioteca."), "error");
    }),
  );
  elements.importPresetCardButton.addEventListener("click", () =>
    createPresetCard().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui criar a carta da biblioteca."), "error");
    }),
  );
  elements.createMissionDeckButton.addEventListener("click", () =>
    createMissionDeck().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui criar a pilha de missão."), "error");
    }),
  );
  loadPresetLibrary().catch((error) => {
    console.warn(error);
    presetDecks = [];
    presetCardGroups = [];
    populatePresetDeckSelect();
    populatePresetCardGroupSelect();
    elements.presetDeckInfo.textContent =
      getErrorMessage(error, "Não consegui carregar a biblioteca de pilhas.");
    elements.presetCardInfo.textContent =
      getErrorMessage(error, "Não consegui carregar a biblioteca de cartas.");
  });
  elements.privatePackChooseButton.addEventListener("click", () =>
    elements.privatePackInput.click(),
  );
  elements.privatePackInput.addEventListener("change", () => {
    configureSelectedPrivatePack(elements.privatePackInput.files).catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui configurar o Private Asset Pack."), "error");
    });
  });
  elements.privatePackUploadButton.addEventListener("click", () => {
    uploadSelectedPrivatePack().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui enviar os assets ao Owlbear."), "error");
    });
  });
  elements.privatePackLinkButton.addEventListener("click", () => {
    linkConfiguredPrivatePack().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui vincular os assets do Owlbear."), "error");
    });
  });
  elements.privatePackClearButton.addEventListener("click", () => {
    removeConfiguredPrivatePack().catch((error) => {
      console.error(error);
      setMessage(getErrorMessage(error, "Não consegui remover a configuração do pack."), "error");
    });
  });
  updatePrivatePackControls(false);
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
    }, "Virando a seleção..."),
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
    }, "Comprando uma carta..."),
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
    }, "Embaralhando a pilha..."),
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
        "Selecione uma carta comprada com pilha de origem.",
      );
      if (!count) return;

      lastCardSelection = [];
      lastFlipSelection = lastDeckSelection;
    }, "Devolvendo a carta para a pilha..."),
  );
  elements.returnOriginButton.addEventListener("click", () =>
    runPanelAction(elements.returnOriginButton, async () => {
      await returnSelectedCardToOrigin(obr, lastCardSelection);
      const message = "Carta devolvida para a posição original.";
      setMessage(message, "success");
      await showNotification(message, "SUCCESS");
    }, "Devolvendo a carta para a origem..."),
  );
  elements.panelRepairButton.addEventListener("click", () =>
    runPanelAction(elements.panelRepairButton, async () => {
      const stats = await repairSceneMetadata();
      const total = stats.cards + stats.decks;

      if (!total) {
        const warning = "Não encontrei cartas ou pilhas para sincronizar.";
        setMessage(warning, "warning");
        await showNotification(warning, "WARNING");
        return;
      }

      const message = getRepairMessage(stats);
      setMessage(message, "success");
      await showNotification(message, "SUCCESS");
    }, "Sincronizando a cena..."),
  );
  for (const button of elements.developmentSaveSceneButtons) {
    button.addEventListener("click", () =>
      runPanelAction(button, () => createDefaultBoardFromCurrentScene(button.dataset.saveScenePreset)),
    );
  }
  for (const button of elements.createScenePresetButtons) {
    button.addEventListener("click", () => {
      createSceneFromPrivatePreset(button.dataset.createScenePreset).catch((error) => {
        console.error(error);
        setMessage(getErrorMessage(error, "Não consegui criar a cena no Atlas."), "error");
      });
    });
  }

  setConnectionStatus("Painel carregado; conectando...", false);
  setMessage("Prévia ativa. Conectando ao Owlbear...", "neutral");

  let loaded;
  try {
    loaded =
      (await window.doubleSidedCardsSdkReady) ||
      (await import("./" + "sdk-client.js?v=103").then((sdkModule) =>
        sdkModule.loadOwlbearSdk(20000),
      ));
  } catch (error) {
    console.warn(error);
    setConnectionStatus("Sem conexão ao SDK", false);
    refreshDefaultBoardInfo().catch((presetError) => {
      console.warn("Nao consegui carregar os templates privados", presetError);
      elements.defaultBoardInfo.textContent =
        "Não consegui carregar os templates privados. Reabra o painel para tentar novamente.";
    });
    setMessage(
      `A tela carregou, mas ainda não conectou ao Owlbear: ${getErrorMessage(error)}`,
      "warning",
    );
    return;
  }

  obr = loaded.OBR;
  buildImage = loaded.sdk.buildImage;
  buildImageUpload = loaded.sdk.buildImageUpload;
  buildSceneUpload = loaded.sdk.buildSceneUpload;
  window.cartasDuplasProbeUploadImagesResponse = (options) =>
    runPrivateAssetUploadResponseConsoleProbe(obr, buildImageUpload, options);
  console.info(
    "[Cartas Duplas] Sonda disponível: await window.cartasDuplasProbeUploadImagesResponse()",
  );
  obr.broadcast
    .sendMessage(COMMANDS_CHANNEL, { type: "register-commands" }, { destination: "LOCAL" })
    .catch((error) => {
      console.warn("Nao consegui pedir o registro dos comandos", error);
    });

  const initialResults = await Promise.allSettled([
    obr.player.getSelection().then((selection) => rememberSelection(selection)),
    refreshDefaultBoardInfo(),
    refreshPlayerColorAssignments(),
  ]);
  const initialFailures = initialResults.filter((result) => result.status === "rejected");
  for (const failure of initialFailures) {
    console.warn("Nao consegui carregar parte do estado inicial do painel", failure.reason);
  }

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
  if (initialFailures.length) {
    setMessage(
      "Conectado ao Owlbear, mas parte do estado inicial não pôde ser carregada. Reabra o painel se alguma seção não atualizar.",
      "warning",
    );
  } else {
    setMessage("", "neutral");
  }
}

init();
