import {
  COMMANDS_CHANNEL,
  DECK_METADATA_KEY,
  METADATA_KEY,
  REGISTRATION_ID,
  getCardMetadata,
  getDeckMetadata,
  normalizeCardMetadata,
  normalizeDeckMetadata,
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
import { resolveConfiguredAsset } from "./asset-resolver.js";
import { bootstrapPrivateSceneMetadata } from "./scene-preset.js";
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
  return `${new URL(`../${path}`, import.meta.url).toString()}?v=103`;
}

const COMMAND_REGISTRATION_DEBOUNCE_MS = 200;

function repairImageData(image) {
  if (!image?.url) {
    return { value: image, changed: false };
  }

  const resolution = resolveConfiguredAsset(image);
  const nextImage = resolution.resolved ? resolution.value : image;

  if (JSON.stringify(nextImage) === JSON.stringify(image)) {
    return { value: image, changed: false };
  }

  return {
    value: nextImage,
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
    const cardBack = card.back ? repairImageData(card.back) : null;
    cardsChanged ||= front.changed || Boolean(cardBack?.changed);

    return front.changed || cardBack?.changed
      ? {
          ...card,
          ...(front.changed ? { front: front.value } : {}),
          ...(cardBack?.changed ? { back: cardBack.value } : {}),
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

  if (normalizeCardMetadata(cardMetadata, { item }).ok) {
    const cardRepair = repairCardMetadata(cardMetadata);

    if (cardRepair.changed) {
      repair.cardMetadata = cardRepair.value;
      repair.changed = true;
    }
  }

  const deckMetadata = getDeckMetadata(item);

  if (normalizeDeckMetadata(deckMetadata, { item }).ok) {
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
  let sceneBootstrapPromise = null;

  function runSceneBootstrap() {
    if (sceneBootstrapPromise) {
      return sceneBootstrapPromise;
    }
    sceneBootstrapPromise = bootstrapPrivateSceneMetadata(OBR)
      .catch((error) => {
        console.warn("Não consegui inicializar a metadata privada da cena", error);
      })
      .finally(() => {
        sceneBootstrapPromise = null;
      });
    return sceneBootstrapPromise;
  }

  OBR.scene.onReadyChange((ready) => {
    if (ready) {
      runSceneBootstrap();
    }
  });
  OBR.scene
    .isReady()
    .then((ready) => (ready ? runSceneBootstrap() : null))
    .catch((error) => {
      console.warn("Não consegui verificar o bootstrap da cena", error);
    });

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
