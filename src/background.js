import {
  DECK_METADATA_KEY,
  EXTENSION_ID,
  LEGACY_DECK_METADATA_KEY,
  LEGACY_METADATA_KEY,
  METADATA_KEY,
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
