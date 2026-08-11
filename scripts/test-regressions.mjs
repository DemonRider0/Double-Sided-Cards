import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECK_METADATA_KEY,
  METADATA_KEY,
  normalizeDeckMetadata,
} from "../src/card-data.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RETURNED_SCENE_ITEM_ID_FIELD = "returnedSceneItemId";
const SELECTION_BOARD_KEY = "br.demonrider.double-sided-cards/selection-board";
const CARD_CATEGORY_KEY = "br.demonrider.double-sided-cards/card-category";
const BLUE_DIVINITY_SLOT_ITEM_ID = "cebf3da7-4a6d-4c27-a5e9-2fcfc50742d7";

function clone(value) {
  return structuredClone(value);
}

function createFace(name) {
  return {
    name,
    url: `https://example.invalid/${name}.png`,
    width: 791,
    height: 520,
    mime: "image/png",
  };
}

function createCardItem(id, deckId) {
  const front = createFace("frente");
  const back = createFace("verso");

  return {
    id,
    type: "IMAGE",
    name: "Carta repetida legitima",
    description: "Campo visual preservado",
    position: { x: 10, y: 20 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    layer: "PROP",
    zIndex: 10,
    locked: false,
    metadata: {
      futureItemMetadata: { preserved: true },
      [METADATA_KEY]: {
        version: 1,
        name: "Carta repetida legitima",
        currentFace: "front",
        gridWidth: 2.25,
        mirrorBack: false,
        faces: { front, back },
        sourceDeckId: deckId,
        sourceDeckName: "Armas",
        futureCardField: { preserved: true },
      },
    },
  };
}

function createDeckItem(id) {
  const front = createFace("frente");
  const back = createFace("verso");
  const firstEntry = {
    name: "Carta repetida legitima",
    front,
    back,
    gridWidth: 2.25,
    futureEntryField: { preserved: true },
  };

  return {
    id,
    type: "IMAGE",
    name: "Armas (1)",
    description: "Pilha: 1 carta",
    text: { plainText: "1" },
    image: back,
    grid: { dpi: 1, offset: { x: 0, y: 0 } },
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    layer: "PROP",
    zIndex: 1,
    locked: false,
    metadata: {
      futureItemMetadata: { preserved: true },
      [DECK_METADATA_KEY]: {
        version: 1,
        name: "Armas",
        currentFace: "back",
        back,
        cards: [firstEntry],
        gridWidth: 2.25,
        futureDeckField: { preserved: true },
      },
    },
  };
}

function createGate() {
  let resolve;
  const promise = new Promise((gateResolve) => {
    resolve = gateResolve;
  });
  return { promise, resolve };
}

function createSharedScene(deck, card) {
  return {
    items: new Map([
      [deck.id, clone(deck)],
      [card.id, clone(card)],
    ]),
    firstClientUpdated: createGate(),
    secondClientUpdated: createGate(),
  };
}

function createObrClient(shared, clientId, coordinateConcurrentReturn = false) {
  return {
    player: {
      async select() {},
    },
    scene: {
      items: {
        async getItems(ids) {
          return ids.map((id) => shared.items.get(id)).filter(Boolean).map(clone);
        },
        async updateItems(ids, update) {
          if (coordinateConcurrentReturn && clientId === "second") {
            await shared.firstClientUpdated.promise;
          }

          const drafts = ids.map((id) => shared.items.get(id)).filter(Boolean).map(clone);
          update(drafts);

          for (const draft of drafts) {
            shared.items.set(draft.id, clone(draft));
          }

          if (coordinateConcurrentReturn && clientId === "first") {
            shared.firstClientUpdated.resolve();
          }
          if (coordinateConcurrentReturn && clientId === "second") {
            shared.secondClientUpdated.resolve();
          }
        },
        async deleteItems(ids) {
          if (coordinateConcurrentReturn && clientId === "first") {
            await shared.secondClientUpdated.promise;
          }
          for (const id of ids) {
            shared.items.delete(id);
          }
        },
      },
    },
  };
}

async function testConcurrentReturnIdempotency() {
  const deckId = "deck-1";
  const card = createCardItem("scene-card-1", deckId);
  const shared = createSharedScene(createDeckItem(deckId), card);
  const firstDeckModule = await import("../src/deck.js?regression-client=first");
  const secondDeckModule = await import("../src/deck.js?regression-client=second");
  const firstClient = createObrClient(shared, "first", true);
  const secondClient = createObrClient(shared, "second", true);

  const results = await Promise.all([
    firstDeckModule.returnCardsToDeck(firstClient, [clone(card)]),
    secondDeckModule.returnCardsToDeck(secondClient, [clone(card)]),
  ]);

  assert.deepEqual(results, [1, 1]);
  assert.equal(shared.items.has(card.id), false);

  let deckMetadata = shared.items.get(deckId).metadata[DECK_METADATA_KEY];
  assert.equal(deckMetadata.cards.length, 2);
  assert.equal(
    deckMetadata.cards.filter(
      (entry) => entry[RETURNED_SCENE_ITEM_ID_FIELD] === card.id,
    ).length,
    1,
  );
  assert.deepEqual(deckMetadata.futureDeckField, { preserved: true });
  assert.deepEqual(deckMetadata.cards[0].futureEntryField, { preserved: true });
  assert.deepEqual(deckMetadata.cards[1].futureCardField, { preserved: true });
  assert.deepEqual(shared.items.get(deckId).metadata.futureItemMetadata, { preserved: true });

  shared.items.set(card.id, clone(card));
  const retryClient = createObrClient(shared, "retry");
  assert.equal(await firstDeckModule.returnCardsToDeck(retryClient, [clone(card)]), 1);
  assert.equal(shared.items.has(card.id), false);
  assert.equal(shared.items.get(deckId).metadata[DECK_METADATA_KEY].cards.length, 2);

  const equalButDistinctCard = createCardItem("scene-card-2", deckId);
  equalButDistinctCard.metadata[METADATA_KEY][RETURNED_SCENE_ITEM_ID_FIELD] = card.id;
  shared.items.set(equalButDistinctCard.id, clone(equalButDistinctCard));
  assert.equal(
    await firstDeckModule.returnCardsToDeck(retryClient, [clone(equalButDistinctCard)]),
    1,
  );

  deckMetadata = shared.items.get(deckId).metadata[DECK_METADATA_KEY];
  assert.equal(deckMetadata.cards.length, 3);
  assert.deepEqual(
    deckMetadata.cards.slice(1).map((entry) => entry[RETURNED_SCENE_ITEM_ID_FIELD]),
    [card.id, equalButDistinctCard.id],
  );
  assert.equal(normalizeDeckMetadata(deckMetadata, { item: shared.items.get(deckId) }).ok, true);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function testMissionBlueSlot() {
  const [mission, tutorial] = await Promise.all([
    readJson("assets/scene-presets/missao-0-5.json"),
    readJson("assets/scene-presets/tutorial.json"),
  ]);
  const missionState = mission.metadata[SELECTION_BOARD_KEY];
  const tutorialState = tutorial.metadata[SELECTION_BOARD_KEY];
  const missionItem = mission.items.find((item) => item.id === BLUE_DIVINITY_SLOT_ITEM_ID);
  const tutorialItem = tutorial.items.find((item) => item.id === BLUE_DIVINITY_SLOT_ITEM_ID);

  assert.deepEqual(missionState.slots, tutorialState.slots);
  assert.equal(missionState.assigned.blue.divinity, null);
  assert.equal(missionState.origins[BLUE_DIVINITY_SLOT_ITEM_ID], undefined);
  assert.equal(missionItem.metadata[CARD_CATEGORY_KEY], undefined);
  assert.deepEqual(
    {
      position: missionItem.position,
      rotation: missionItem.rotation,
      scale: missionItem.scale,
      layer: missionItem.layer,
      zIndex: missionItem.zIndex,
      locked: missionItem.locked,
    },
    {
      position: tutorialItem.position,
      rotation: tutorialItem.rotation,
      scale: tutorialItem.scale,
      layer: tutorialItem.layer,
      zIndex: tutorialItem.zIndex,
      locked: tutorialItem.locked,
    },
  );
}

async function testWeaponsManifest() {
  const manifest = await readJson("assets/preset-decks/decks.json");
  const weapons = manifest.decks.find((deck) => deck.id === "armas");
  const paths = weapons.cards.map((card) => card.front.path);
  const hashes = await Promise.all(
    paths.map(async (assetPath) =>
      createHash("sha256").update(await readFile(path.join(root, assetPath))).digest("hex"),
    ),
  );

  assert.equal(weapons.cards.length, 24);
  assert.equal(new Set(paths).size, 24);
  assert.equal(new Set(hashes).size, 24);
}

await testConcurrentReturnIdempotency();
await testMissionBlueSlot();
await testWeaponsManifest();

console.log("Regressoes C3/B17 e C7 validadas.");
