import {
  COMMANDS_CHANNEL,
  DECK_METADATA_KEY,
  EXTENSION_ID,
  getCardMetadata,
  METADATA_KEY,
} from "./card-data.js";
import {
  drawFromDecks,
  drawSelectedDecks,
  getCardItems,
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
  placeSelectedCardInCategory,
  setActivePlayerColor,
} from "./selection-board.js";

function assetUrl(path) {
  return new URL(`../${path}`, import.meta.url).toString();
}

async function removePreviousRegistrations(OBR) {
  const extensionIds = [EXTENSION_ID];
  const contextMenuIds = [
    "flip",
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
  await OBR.contextMenu.create(contextMenu);
}

async function createToolAction(OBR, action) {
  await OBR.tool.removeAction(action.id).catch(() => {});
  await OBR.tool.createAction(action);
}

async function setupContextMenu() {
  const { OBR, sdk } = await loadOwlbearSdk(20000);
  let lastCardSelection = [];
  let lastDeckSelection = [];
  let lastImageSelection = [];
  let activePlayerColor = null;
  const autoReturnPositions = new Map();
  const autoReturnTimers = new Map();
  const autoReturningCardIds = new Set();
  let autoReturnQueue = Promise.resolve();

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

  async function rememberImageSelection(selection) {
    if (!selection?.length) {
      return;
    }

    const selectedItems = await OBR.scene.items.getItems(selection);
    const imageItems = selectedItems.filter((item) => item.type === "IMAGE");

    if (!imageItems.length) {
      return;
    }

    lastImageSelection = imageItems.map((item) => item.id);

    const color = detectPlayerColorFromItem(imageItems[0]);

    if (color && color !== activePlayerColor) {
      try {
        await setActivePlayerColor(OBR, color);
        activePlayerColor = color;
        await OBR.notification.show(`Cor ativa: ${getColorLabel(color)}.`, "SUCCESS");
      } catch (error) {
        await showCommandError(error);
      }
    }

    const category = detectCardCategoryFromItem(imageItems[0]);

    if (category) {
      try {
        await placeSelectedCardInCategory(OBR, category, [imageItems[0].id]);
      } catch (error) {
        await showCommandError(error);
      }
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

  async function showCommandError(error) {
    console.warn(error);
    await OBR.notification.show(error.message || "Nao consegui executar o comando.", "WARNING");
  }

  function pointInBounds(point, bounds) {
    return (
      point.x >= bounds.min.x &&
      point.x <= bounds.max.x &&
      point.y >= bounds.min.y &&
      point.y <= bounds.max.y
    );
  }

  function didPositionChange(previous, current) {
    if (!previous) {
      return false;
    }

    return Math.hypot(current.x - previous.x, current.y - previous.y) > 1;
  }

  function rememberAutoReturnCardPositions(items) {
    for (const card of getDoubleSidedCards(items)) {
      if (!getCardMetadata(card)?.sourceDeckId) {
        continue;
      }

      autoReturnPositions.set(card.id, { ...card.position });
    }
  }

  function getMovedAutoReturnCardIds(items) {
    const movedCardIds = [];

    for (const card of getDoubleSidedCards(items)) {
      if (!getCardMetadata(card)?.sourceDeckId) {
        continue;
      }

      const previousPosition = autoReturnPositions.get(card.id);
      const currentPosition = { ...card.position };
      autoReturnPositions.set(card.id, currentPosition);

      if (
        !autoReturningCardIds.has(card.id) &&
        didPositionChange(previousPosition, currentPosition)
      ) {
        movedCardIds.push(card.id);
      }
    }

    return movedCardIds;
  }

  function scheduleAutoReturnCheck(cardId) {
    const existingTimer = autoReturnTimers.get(cardId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      autoReturnTimers.delete(cardId);
      queueAutoReturnCheck(cardId);
    }, 250);

    autoReturnTimers.set(cardId, timer);
  }

  function queueAutoReturnCheck(cardId) {
    autoReturnQueue = autoReturnQueue
      .catch(() => {})
      .then(() => returnCardIfDroppedOnSourceDeck(cardId))
      .catch((error) => {
        console.warn("Nao consegui devolver a carta automaticamente para a pilha", error);
      });
  }

  async function returnCardIfDroppedOnSourceDeck(cardId) {
    if (autoReturningCardIds.has(cardId)) {
      return;
    }

    autoReturningCardIds.add(cardId);

    try {
      const [card] = getCardItems(await OBR.scene.items.getItems([cardId]));
      const metadata = card ? getCardMetadata(card) : null;
      const sourceDeckId = metadata?.sourceDeckId;

      if (!card || !sourceDeckId) {
        autoReturnPositions.delete(cardId);
        return;
      }

      const [sourceDeck] = getDeckItems(await OBR.scene.items.getItems([sourceDeckId]));

      if (!sourceDeck) {
        return;
      }

      const sourceDeckBounds = await OBR.scene.items.getItemBounds([sourceDeck.id]);

      if (!pointInBounds(card.position, sourceDeckBounds)) {
        return;
      }

      const count = await returnCardsToDeck(OBR, [card], [sourceDeck.id]);

      if (count) {
        autoReturnPositions.delete(cardId);
      }
    } finally {
      autoReturningCardIds.delete(cardId);
    }
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
    .then(async (selection) => {
      await Promise.all([
        rememberCardSelection(selection),
        rememberDeckSelection(selection),
        rememberImageSelection(selection),
      ]);
    })
    .catch((error) => {
      console.warn("Nao consegui ler a selecao inicial", error);
    });

  OBR.player.onChange((player) => {
    activePlayerColor = player.metadata?.[ACTIVE_COLOR_KEY]?.color || activePlayerColor;
    rememberCardSelection(player.selection).catch((error) => {
      console.warn("Nao consegui atualizar a selecao de cartas", error);
    });
    rememberDeckSelection(player.selection).catch((error) => {
      console.warn("Nao consegui atualizar a selecao de pilhas", error);
    });
    rememberImageSelection(player.selection).catch((error) => {
      console.warn("Nao consegui atualizar a selecao de imagens", error);
    });
  });
  OBR.scene.items
    .getItems()
    .then((items) => {
      rememberAutoReturnCardPositions(items);
      return syncDeckDisplays(OBR, items);
    })
    .catch((error) => {
      console.warn("Nao consegui sincronizar os contadores das pilhas", error);
    });
  OBR.scene.items.onChange((items) => {
    for (const cardId of getMovedAutoReturnCardIds(items)) {
      scheduleAutoReturnCheck(cardId);
    }

    syncDeckDisplays(OBR, items).catch((error) => {
      console.warn("Nao consegui sincronizar os contadores alterados das pilhas", error);
    });
  });

  async function registerCommands() {
    await removePreviousRegistrations(OBR);

    await createContextMenu(OBR, {
      id: `${EXTENSION_ID}/flip`,
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
      id: `${EXTENSION_ID}/draw-from-deck`,
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

    await createContextMenu(OBR, {
      id: `${EXTENSION_ID}/shuffle-deck`,
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
      id: `${EXTENSION_ID}/return-to-deck`,
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
        const count = await returnCardsToDeck(OBR, context.items, lastDeckSelection);
        if (!count) {
          await OBR.notification.show(
            "Selecione uma carta e tenha uma pilha alvo selecionada recentemente.",
            "WARNING",
          );
        }
      },
    });

    await createToolAction(OBR, {
      id: `${EXTENSION_ID}/flip-action`,
      icons: [
        {
          icon: assetUrl("icons/flip.svg"),
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

    await createToolAction(OBR, {
      id: `${EXTENSION_ID}/draw-action`,
      icons: [
        {
          icon: assetUrl("icons/draw.svg"),
          label: "Comprar carta",
        },
      ],
      shortcut: "C",
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

    await createToolAction(OBR, {
      id: `${EXTENSION_ID}/shuffle-action`,
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
      id: `${EXTENSION_ID}/return-action`,
      icons: [
        {
          icon: assetUrl("icons/return.svg"),
          label: "Devolver para pilha",
        },
      ],
      shortcut: "R",
      async onClick() {
        const anchors = await getAnchorItems(lastCardSelection);
        const count = await returnSelectedCardsToDeck(
          OBR,
          lastCardSelection,
          lastDeckSelection,
        );
        if (!count) {
          await OBR.notification.show(
            "Selecione uma carta comprada e uma pilha alvo.",
            "WARNING",
          );
        }
      },
    });

  }

  let commandRegistration = Promise.resolve();
  function queueCommandRegistration(reason) {
    commandRegistration = commandRegistration
      .catch(() => {})
      .then(() => registerCommands())
      .catch((error) => {
        console.warn(`Nao consegui registrar os comandos das Cartas Duplas (${reason})`, error);
      });

    return commandRegistration;
  }

  OBR.broadcast.onMessage(COMMANDS_CHANNEL, () => {
    queueCommandRegistration("pedido do painel");
  });

  await queueCommandRegistration("carregamento inicial");

  for (const delayMs of [250, 1000, 2500, 5000]) {
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
