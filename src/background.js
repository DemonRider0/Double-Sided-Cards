import {
  COMMANDS_CHANNEL,
  DECK_METADATA_KEY,
  METADATA_KEY,
  REGISTRATION_ID,
  getCardMetadata,
  getDeckMetadata,
  setCardMetadata,
  setDeckMetadata,
} from "./card-data.js";
import {
  drawFromDecks,
  drawSelectedDecks,
  getDeckItems,
  returnCardsToDeck,
  returnSelectedCardsToDeck,
  shuffleDecks,
  shuffleSelectedDecks,
  syncDeckDisplays,
} from "./deck.js";
import { showActionFeedback } from "./feedback.js";
import { flipItems, flipSelectedItems, getDoubleSidedCards } from "./flip.js";
import { loadOwlbearSdk } from "./obr.js";
import {
  ACTIVE_COLOR_KEY,
  detectCardCategoryFromItem,
  detectPlayerColorFromItem,
  getColorLabel,
  normalizePlayerColor,
  placeSelectedCardInCategory,
  setActivePlayerColor,
} from "./selection-board.js";

function assetUrl(path) {
  return `${new URL(`../${path}`, import.meta.url).toString()}?v=65`;
}

const COMMAND_REGISTRATION_DEBOUNCE_MS = 200;

const OPTIMIZED_ASSET_FILENAMES = new Map([
  [
    "1779668122715-e5c59860-137c-4664-b55c-fc546033288b-mapa-tutorial-a-.png",
    "1779668122715-e5c59860-137c-4664-b55c-fc546033288b-mapa-tutorial-a--mobile.jpg",
  ],
  [
    "1779668122717-841f7e43-ef8f-407f-bfe7-115b51c6779c-mapa-tutorial-b-.png",
    "1779668122717-841f7e43-ef8f-407f-bfe7-115b51c6779c-mapa-tutorial-b--mobile.jpg",
  ],
  [
    "1780360314623-2d773fbe-40df-48d4-ac48-aecc7767ded0-mapa-tutorial-c-.png",
    "1780360314623-2d773fbe-40df-48d4-ac48-aecc7767ded0-mapa-tutorial-c--mobile.jpg",
  ],
  [
    "1780360314646-be4a1407-54d8-4f68-8a94-a03ba42de716-mapa-tutorial-a-.png",
    "1780360314646-be4a1407-54d8-4f68-8a94-a03ba42de716-mapa-tutorial-a--mobile.jpg",
  ],
]);

const BUNDLED_REMOTE_ASSET_IDS = new Map([
  ["ed545ed3-1b28-4bdf-8744-96fb835e2a14", "owlbear-edba733b-f850-4f74-8d9d-4b426f5083f6-Mesa-Expedicao-Excarlate.png"],
  ["edba733b-f850-4f74-8d9d-4b426f5083f6", "owlbear-edba733b-f850-4f74-8d9d-4b426f5083f6-Mesa-Expedicao-Excarlate.png"],
  ["8ee18e58-32e4-4148-b228-8565c87d764a", "owlbear-8ee18e58-32e4-4148-b228-8565c87d764a-Player.png"],
  ["eebc34cf-f140-4cc1-bad6-be29e352460b", "owlbear-eebc34cf-f140-4cc1-bad6-be29e352460b-Raca-Verso.png"],
  ["4506362a-8e87-40af-b929-e09afda3fa8e", "owlbear-4506362a-8e87-40af-b929-e09afda3fa8e-Classes-Verso.png"],
  ["ba0c7d8a-9288-49b4-a1bb-91adcabdd075", "owlbear-ba0c7d8a-9288-49b4-a1bb-91adcabdd075-Wynna-Verso.png"],
  ["498fa6fd-56d8-4e4f-ae5c-afd5383ba8e1", "owlbear-498fa6fd-56d8-4e4f-ae5c-afd5383ba8e1-Acesso.png"],
  ["0e503377-26e4-4cdf-8672-00d8ae907adc", "owlbear-0e503377-26e4-4cdf-8672-00d8ae907adc-Mizlah-Token.webp"],
  ["efe0588e-57ef-49e2-9449-9d97f16f3fce", "owlbear-efe0588e-57ef-49e2-9449-9d97f16f3fce-Mithreus-Token.webp"],
  ["e2be2ca1-9bfc-4f40-984b-7234c6c0a372", "owlbear-e2be2ca1-9bfc-4f40-984b-7234c6c0a372-Mathias-Token.webp"],
  ["6b45ef2c-672b-4fab-baed-8812cdc7738e", "owlbear-6b45ef2c-672b-4fab-baed-8812cdc7738e-Missao-0-Tutorial-Pag-2.jpg"],
  ["ad8ae303-af2f-4fb4-b039-7ca3fb79e01f", "owlbear-ad8ae303-af2f-4fb4-b039-7ca3fb79e01f-Missao-0-Tutorial-Pag-1.jpg"],
  ["859beb28-9b08-4af0-9aa3-e757fa96a49a", "owlbear-859beb28-9b08-4af0-9aa3-e757fa96a49a-Missao-1.1-Pg-2.webp"],
  ["098a5a25-6a2f-43a1-9841-7589ead78fe3", "owlbear-098a5a25-6a2f-43a1-9841-7589ead78fe3-Missao-1.1-Pg-1.webp"],
]);

function isLocalhost() {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function toBundledRemoteAssetUrl(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    const url = new URL(value, window.location.origin);

    if (url.hostname !== "images.owlbear.rodeo") {
      return value;
    }

    const file = url.pathname.split("/").pop() || "";
    const id = file.replace(/\.[^.]+$/, "");
    const bundledFilename = BUNDLED_REMOTE_ASSET_IDS.get(id);

    return bundledFilename ? assetUrl(`assets/local-assets/${bundledFilename}`) : value;
  } catch {
    return value;
  }
}

function toOptimizedAssetUrl(value) {
  if (typeof value !== "string") {
    return value;
  }

  const bundledUrl = toBundledRemoteAssetUrl(value);

  if (bundledUrl !== value) {
    return bundledUrl;
  }

  for (const [oldFilename, newFilename] of OPTIMIZED_ASSET_FILENAMES) {
    if (value.includes(oldFilename)) {
      return value.replace(oldFilename, newFilename);
    }
  }

  return value;
}

function isJpegUrl(value) {
  return typeof value === "string" && /\.jpe?g(?:$|[?#])/i.test(value);
}

function toLocalAssetUrl(value) {
  if (!isLocalhost() || typeof value !== "string") {
    return value;
  }

  try {
    const url = new URL(value, window.location.origin);
    const publicAssetMarker = "/Double-Sided-Cards/assets/";

    if (url.hostname === "demonrider0.github.io") {
      const markerIndex = url.pathname.indexOf(publicAssetMarker);

      if (markerIndex >= 0) {
        return `${window.location.origin}/assets/${url.pathname.slice(markerIndex + publicAssetMarker.length)}`;
      }
    }

    const markers = ["/.local-assets/", "/assets/local-assets/"];
    let filename = "";

    for (const marker of markers) {
      const markerIndex = url.pathname.indexOf(marker);

      if (markerIndex >= 0) {
        filename = url.pathname.slice(markerIndex + marker.length);
        break;
      }
    }

    if (!filename) {
      return value;
    }

    const nextUrl = `${window.location.origin}/assets/local-assets/${filename}`;

    return normalizeUrl(value) === normalizeUrl(nextUrl) ? value : nextUrl;
  } catch {
    return value;
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function repairImageData(image) {
  if (!image?.url) {
    return { value: image, changed: false };
  }

  const optimizedUrl = toOptimizedAssetUrl(image.url);
  const nextUrl = toLocalAssetUrl(optimizedUrl);
  const nextMime = isJpegUrl(nextUrl) ? "image/jpeg" : image.mime;

  if (nextUrl === image.url && nextMime === image.mime) {
    return { value: image, changed: false };
  }

  return {
    value: {
      ...image,
      url: nextUrl,
      mime: nextMime,
    },
    changed: true,
  };
}

function repairCardMetadata(cardMetadata) {
  const front = repairImageData(cardMetadata.faces.front);
  const back = repairImageData(cardMetadata.faces.back);

  if (!front.changed && !back.changed) {
    return { value: cardMetadata, changed: false };
  }

  return {
    value: {
      ...cardMetadata,
      faces: {
        ...cardMetadata.faces,
        front: front.value,
        back: back.value,
      },
    },
    changed: true,
  };
}

function repairDeckMetadata(deckMetadata) {
  const back = repairImageData(deckMetadata.back);
  let cardsChanged = false;
  const cards = deckMetadata.cards.map((card) => {
    const front = repairImageData(card.front);
    cardsChanged ||= front.changed;

    return front.changed
      ? {
          ...card,
          front: front.value,
        }
      : card;
  });

  if (!back.changed && !cardsChanged) {
    return { value: deckMetadata, changed: false };
  }

  return {
    value: {
      ...deckMetadata,
      back: back.value,
      cards,
    },
    changed: true,
  };
}

function getSceneAssetUrlRepair(item) {
  const repair = {
    changed: false,
    image: null,
    cardMetadata: null,
    deckMetadata: null,
  };

  const image = repairImageData(item.image);

  if (image.changed) {
    repair.image = image.value;
    repair.changed = true;
  }

  const cardMetadata = getCardMetadata(item);

  if (cardMetadata) {
    const cardRepair = repairCardMetadata(cardMetadata);

    if (cardRepair.changed) {
      repair.cardMetadata = cardRepair.value;
      repair.changed = true;
    }
  }

  const deckMetadata = getDeckMetadata(item);

  if (deckMetadata) {
    const deckRepair = repairDeckMetadata(deckMetadata);

    if (deckRepair.changed) {
      repair.deckMetadata = deckRepair.value;
      repair.changed = true;
    }
  }

  return repair;
}

function applySceneAssetUrlRepair(item) {
  const repair = getSceneAssetUrlRepair(item);

  if (!repair.changed) {
    return false;
  }

  if (repair.image) {
    item.image = repair.image;
  }

  if (repair.cardMetadata) {
    setCardMetadata(item, repair.cardMetadata);
  }

  if (repair.deckMetadata) {
    setDeckMetadata(item, repair.deckMetadata);
  }

  return true;
}

function repairSceneAssetUrlsForItem(item) {
  return applySceneAssetUrlRepair(item);
}

function itemNeedsSceneAssetUrlRepair(item) {
  return getSceneAssetUrlRepair(item).changed;
}

async function repairSceneAssetUrls(OBR, items) {
  const repairableItems = items.filter(itemNeedsSceneAssetUrlRepair);

  if (!repairableItems.length) {
    return 0;
  }

  await OBR.scene.items.updateItems(repairableItems, (draftItems) => {
    for (const item of draftItems) {
      repairSceneAssetUrlsForItem(item);
    }
  });

  return repairableItems.length;
}

async function removePreviousRegistrations(OBR) {
  const extensionIds = [REGISTRATION_ID];
  const contextMenuIds = [
    "flip",
    "flip-deck-top",
    "draw-from-deck",
    "shuffle-deck",
    "return-to-deck",
  ];
  const actionIds = [
    "flip-action",
    "draw-action",
    "shuffle-action",
    "return-action",
    "use-color-action",
    "place-race-action",
    "place-class-action",
    "place-divinity-action",
  ];
  const toolIds = ["flip-tool"];

  for (const extensionId of extensionIds) {
    for (const id of contextMenuIds) {
      await OBR.contextMenu.remove(`${extensionId}/${id}`).catch(() => {});
    }

    for (const id of actionIds) {
      await OBR.tool.removeAction(`${extensionId}/${id}`).catch(() => {});
    }

    for (const id of toolIds) {
      await OBR.tool.remove(`${extensionId}/${id}`).catch(() => {});
    }
  }
}

async function createContextMenu(OBR, contextMenu) {
  await OBR.contextMenu.remove(contextMenu.id).catch(() => {});
  await OBR.contextMenu.create(contextMenu).catch((error) => {
    console.warn(`Nao consegui registrar o menu ${contextMenu.id}`, error);
  });
}

async function createToolAction(OBR, action) {
  await OBR.tool.removeAction(action.id).catch(() => {});
  await OBR.tool.createAction(action).catch((error) => {
    console.warn(`Nao consegui registrar a acao ${action.id}`, error);
  });
}

async function setupContextMenu() {
  const { OBR, sdk } = await loadOwlbearSdk(20000);
  let lastCardSelection = [];
  let lastDeckSelection = [];
  let lastFlipSelection = [];
  let lastImageSelection = [];
  let activePlayerColor = null;
  let deckDisplaySyncTimer = null;

  async function rememberSelection(selection) {
    if (!selection?.length) {
      lastImageSelection = [];
      return;
    }

    const selectedItems = await OBR.scene.items.getItems(selection);
    const cardIds = getDoubleSidedCards(selectedItems).map((item) => item.id);
    const deckIds = getDeckItems(selectedItems).map((item) => item.id);
    const imageItems = selectedItems.filter((item) => item.type === "IMAGE");

    if (cardIds.length) {
      lastCardSelection = cardIds;
      lastFlipSelection = cardIds;
    }

    if (deckIds.length) {
      lastDeckSelection = deckIds;
      lastFlipSelection = deckIds;
    }

    if (!imageItems.length) {
      return;
    }

    if (imageItems.length === lastImageSelection.length && imageItems.every((item, index) => item.id === lastImageSelection[index])) {
      return;
    }

    lastImageSelection = imageItems.map((item) => item.id);

    const singleImageItem =
      selectedItems.length === 1 && imageItems.length === 1 ? imageItems[0] : null;

    if (!singleImageItem) {
      return;
    }

    const color = detectPlayerColorFromItem(singleImageItem);

    if (color && color !== activePlayerColor) {
      try {
        await setActivePlayerColor(OBR, color, {
          selectedTokenId: singleImageItem.id,
        });
        activePlayerColor = color;
        await OBR.notification.show(`Cor ativa: ${getColorLabel(color)}.`, "SUCCESS");
      } catch (error) {
        await showCommandError(error);
      }
    }

    const category = detectCardCategoryFromItem(singleImageItem);

    if (category) {
      try {
        await placeSelectedCardInCategory(OBR, category, [singleImageItem.id]);
      } catch (error) {
        await showCommandError(error);
      }
    }
  }

  function queueDeckDisplaySync(items) {
    if (!getDeckItems(items).length) {
      return;
    }

    if (deckDisplaySyncTimer) {
      window.clearTimeout(deckDisplaySyncTimer);
    }

    deckDisplaySyncTimer = window.setTimeout(() => {
      deckDisplaySyncTimer = null;
      syncDeckDisplays(OBR, items).catch((error) => {
        console.warn("Nao consegui sincronizar os contadores das pilhas", error);
      });
    }, 450);
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

  async function showCommandError(error) {
    console.warn(error);
    await OBR.notification.show(error.message || "Nao consegui executar o comando.", "WARNING");
  }

  function cardMetadataFilter() {
    return [
      { key: ["metadata", METADATA_KEY], value: undefined, operator: "!=" },
    ];
  }

  function deckMetadataFilter() {
    return [
      { key: ["metadata", DECK_METADATA_KEY], value: undefined, operator: "!=" },
    ];
  }

  OBR.player
    .getSelection()
    .then((selection) => rememberSelection(selection))
    .catch((error) => {
      console.warn("Nao consegui ler a selecao inicial", error);
    });

  OBR.player.onChange((player) => {
    activePlayerColor = normalizePlayerColor(
      player.metadata?.[ACTIVE_COLOR_KEY]?.color,
    );
    rememberSelection(player.selection).catch((error) => {
      console.warn("Nao consegui atualizar a selecao", error);
    });
  });
  OBR.scene.items
    .getItems()
    .then(async (items) => {
      const repairedCount = await repairSceneAssetUrls(OBR, items);
      return syncDeckDisplays(OBR, repairedCount ? await OBR.scene.items.getItems() : items);
    })
    .catch((error) => {
      console.warn("Nao consegui sincronizar os contadores das pilhas", error);
    });
  OBR.scene.items.onChange((items) => {
    queueDeckDisplaySync(items);
  });

  async function registerCommands() {
    await removePreviousRegistrations(OBR);

    await createContextMenu(OBR, {
      id: `${REGISTRATION_ID}/flip`,
      icons: [
        {
          icon: assetUrl("icons/flip.svg"),
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

    await createContextMenu(OBR, {
      id: `${REGISTRATION_ID}/draw-from-deck`,
      icons: [
        {
          icon: assetUrl("icons/draw.svg"),
          label: "Comprar carta",
          filter: {
            permissions: ["UPDATE"],
            every: [{ key: "type", value: "IMAGE" }],
            some: deckMetadataFilter(),
          },
        },
      ],
      async onClick(context) {
        try {
          const count = await drawFromDecks(OBR, sdk.buildImage, context.items);
          if (count) {
            lastDeckSelection = getDeckItems(context.items).map((item) => item.id);
            lastFlipSelection = lastDeckSelection;
            lastCardSelection = [];
          }
          await showActionResult(
            count,
            "Carta comprada.",
            (total) => `${total} cartas compradas.`,
            "A pilha esta vazia.",
            context.items,
          );
        } catch (error) {
          await showCommandError(error);
        }
      },
    });

    await createContextMenu(OBR, {
      id: `${REGISTRATION_ID}/flip-deck-top`,
      icons: [
        {
          icon: assetUrl("icons/flip.svg"),
          label: "Virar carta do topo",
          filter: {
            permissions: ["UPDATE"],
            every: [{ key: "type", value: "IMAGE" }],
            some: deckMetadataFilter(),
          },
        },
      ],
      async onClick(context) {
        const count = await flipItems(OBR, context.items);
        await showActionResult(
          count,
          "Topo da pilha virado.",
          (total) => `${total} pilhas viradas.`,
          "Selecione uma pilha com cartas.",
          context.items,
        );
      },
    });

    await createContextMenu(OBR, {
      id: `${REGISTRATION_ID}/shuffle-deck`,
      icons: [
        {
          icon: assetUrl("icons/shuffle.svg"),
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

    await createContextMenu(OBR, {
      id: `${REGISTRATION_ID}/return-to-deck`,
      icons: [
        {
          icon: assetUrl("icons/return.svg"),
          label: "Devolver para pilha",
          filter: {
            permissions: ["UPDATE", "DELETE"],
            every: [{ key: "type", value: "IMAGE" }],
            some: cardMetadataFilter(),
          },
        },
      ],
      async onClick(context) {
        try {
          const count = await returnCardsToDeck(OBR, context.items, lastDeckSelection);
          if (count) {
            lastCardSelection = [];
            lastFlipSelection = lastDeckSelection;
          }
          if (!count) {
            await OBR.notification.show(
              "Selecione uma carta comprada com pilha de origem.",
              "WARNING",
            );
          }
        } catch (error) {
          await showCommandError(error);
        }
      },
    });

    await createToolAction(OBR, {
      id: `${REGISTRATION_ID}/flip-action`,
      icons: [
        {
          icon: assetUrl("icons/flip.svg"),
          label: "Virar carta",
        },
      ],
      shortcut: "V",
      async onClick() {
        const selection = await OBR.player.getSelection();
        await rememberSelection(selection);
        const fallbackSelection = lastFlipSelection.length
          ? lastFlipSelection
          : lastDeckSelection.length
            ? lastDeckSelection
            : lastCardSelection;
        const anchors = await getAnchorItems(fallbackSelection);
        const count = await flipSelectedItems(OBR, fallbackSelection);
        await showActionResult(
          count,
          "Carta virada.",
          (total) => `${total} itens virados.`,
          "Selecione uma carta dupla ou uma pilha com cartas para virar.",
          anchors,
        );
      },
    });

    await createToolAction(OBR, {
      id: `${REGISTRATION_ID}/draw-action`,
      icons: [
        {
          icon: assetUrl("icons/draw.svg"),
          label: "Comprar carta",
        },
      ],
      shortcut: "C",
      async onClick() {
        try {
          const anchors = await getAnchorItems(lastDeckSelection);
          const count = await drawSelectedDecks(OBR, sdk.buildImage, lastDeckSelection);
          if (count) {
            lastFlipSelection = lastDeckSelection;
            lastCardSelection = [];
          }
          await showActionResult(
            count,
            "Carta comprada.",
            (total) => `${total} cartas compradas.`,
            "Selecione uma pilha com cartas para comprar.",
            anchors,
          );
        } catch (error) {
          await showCommandError(error);
        }
      },
    });

    await createToolAction(OBR, {
      id: `${REGISTRATION_ID}/shuffle-action`,
      icons: [
        {
          icon: assetUrl("icons/shuffle.svg"),
          label: "Embaralhar pilha",
        },
      ],
      shortcut: "E",
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

    await createToolAction(OBR, {
      id: `${REGISTRATION_ID}/return-action`,
      icons: [
        {
          icon: assetUrl("icons/return.svg"),
          label: "Devolver para pilha",
        },
      ],
      shortcut: "R",
      async onClick() {
        try {
          const anchors = await getAnchorItems(lastCardSelection);
          const count = await returnSelectedCardsToDeck(
            OBR,
            lastCardSelection,
            lastDeckSelection,
          );
          if (count) {
            lastCardSelection = [];
            lastFlipSelection = lastDeckSelection;
          }
          if (!count) {
            await OBR.notification.show(
              "Selecione uma carta comprada com pilha de origem.",
              "WARNING",
            );
          }
        } catch (error) {
          await showCommandError(error);
        }
      },
    });

  }

  let commandRegistrationActive = false;
  let commandRegistrationPending = false;
  let commandRegistrationReason = "";
  let commandRegistrationTimer = null;
  let commandRegistrationWaiters = [];

  function resolveCommandRegistrationWaiters() {
    const waiters = commandRegistrationWaiters;
    commandRegistrationWaiters = [];

    for (const resolve of waiters) {
      resolve();
    }
  }

  async function runCommandRegistrationQueue() {
    if (commandRegistrationActive) {
      return;
    }

    commandRegistrationActive = true;

    try {
      while (commandRegistrationPending) {
        const reason = commandRegistrationReason;
        commandRegistrationPending = false;

        try {
          await registerCommands();
        } catch (error) {
          console.warn(`Nao consegui registrar os comandos das Cartas Duplas (${reason})`, error);
        }
      }
    } finally {
      commandRegistrationActive = false;
      resolveCommandRegistrationWaiters();
    }
  }

  function queueCommandRegistration(reason, options = {}) {
    commandRegistrationPending = true;
    commandRegistrationReason = reason;

    const registration = new Promise((resolve) => {
      commandRegistrationWaiters.push(resolve);
    });

    if (commandRegistrationActive) {
      return registration;
    }

    if (commandRegistrationTimer) {
      window.clearTimeout(commandRegistrationTimer);
    }

    commandRegistrationTimer = window.setTimeout(() => {
      commandRegistrationTimer = null;
      runCommandRegistrationQueue().catch((error) => {
        console.warn("Nao consegui processar a fila de comandos das Cartas Duplas", error);
        resolveCommandRegistrationWaiters();
      });
    }, options.immediate ? 0 : COMMAND_REGISTRATION_DEBOUNCE_MS);

    return registration;
  }

  OBR.broadcast.onMessage(COMMANDS_CHANNEL, () => {
    queueCommandRegistration("pedido do painel");
  });

  await queueCommandRegistration("carregamento inicial", { immediate: true });

  for (const delayMs of [1200, 5000]) {
    window.setTimeout(() => {
      queueCommandRegistration(`atraso de ${delayMs}ms`);
    }, delayMs);
  }

  window.addEventListener("focus", () => {
    queueCommandRegistration("foco da janela");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      queueCommandRegistration("mudanca de visibilidade");
    }
  });
}

setupContextMenu().catch((error) => {
  console.error("Erro no plano de fundo das Cartas Duplas", error);
});
