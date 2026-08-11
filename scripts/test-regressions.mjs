import assert from "node:assert/strict";

import {
  DECK_METADATA_KEY,
  METADATA_KEY,
  normalizeDeckMetadata,
} from "../src/card-data.js";
import {
  PRIVATE_ASSET_PACK_FORMAT,
  PRIVATE_ASSET_PACK_VERSION,
  PRIVATE_ASSET_STORAGE_KEY,
  createAssetResolver,
  getPrivateAssetPackStatus,
  installPrivateAssetPack,
  readPrivateAssetState,
  resolveAssetReferences,
  savePrivateAssetBindings,
} from "../src/asset-resolver.js";
import { loadPresetCardGroups } from "../src/preset-cards.js";
import { loadPresetDecks } from "../src/preset-decks.js";
import { loadScenePresetEntries } from "../src/scene-preset.js";
import {
  hydratePrivateAssetPackManifest,
  matchOwlbearAssetBindings,
  preparePrivateAssetUpload,
  uploadPrivateAssetPack,
} from "../src/private-asset-pack.js";

const RETURNED_SCENE_ITEM_ID_FIELD = "returnedSceneItemId";

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

function createPrivatePackFixture() {
  const frontId = `sha256:${"a".repeat(64)}`;
  const backId = `sha256:${"b".repeat(64)}`;
  const preset = {
    version: 1,
    id: "tutorial",
    name: "Tutorial",
    savedAt: "2026-01-01T00:00:00.000Z",
    itemCount: 1,
    items: [
      {
        id: "item-1",
        type: "IMAGE",
        metadata: {},
        image: { assetId: frontId, width: 10, height: 20, mime: "image/png" },
      },
    ],
    metadata: {},
  };
  return {
    format: PRIVATE_ASSET_PACK_FORMAT,
    version: PRIVATE_ASSET_PACK_VERSION,
    id: "fixture-pack",
    name: "Fixture",
    assets: {
      [frontId]: {
        file: `assets/${"a".repeat(64)}.png`,
        name: "Frente.png",
        owlbearName: "DSC aaaaaaaaaaaa Frente.png",
      },
      [backId]: {
        file: `assets/${"b".repeat(64)}.png`,
        name: "Verso.png",
        owlbearName: "DSC bbbbbbbbbbbb Verso.png",
      },
    },
    aliases: {
      "assets/preset-cards/teste/Frente.png": frontId,
      "assets/preset-cards/teste/Copia exata.png": frontId,
      ".local-assets/legado.png": frontId,
      "assets/preset-cards/teste/Verso.png": backId,
      "owlbear:11111111-1111-1111-1111-111111111111": frontId,
    },
    presets: {
      cards: {
        version: 1,
        groups: [
          {
            id: "teste",
            name: "Teste",
            back: { assetId: backId },
            cards: [{ id: "frente", name: "Frente", front: { assetId: frontId } }],
          },
        ],
      },
      decks: {
        version: 1,
        decks: [
          {
            id: "teste",
            name: "Teste",
            back: { assetId: backId },
            cards: [{ name: "Frente", front: { assetId: frontId } }],
          },
        ],
      },
      scenes: {
        tutorial: {
          definition: { id: "tutorial", name: "Tutorial", restoreLabel: "Restaurar" },
          summary: { savedAt: preset.savedAt, itemCount: 1 },
          preset,
        },
      },
    },
  };
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function testPrivateAssetArchitecture() {
  const pack = createPrivatePackFixture();
  const [frontId, backId] = Object.keys(pack.assets);
  const binding = {
    url: "https://images.owlbear.rodeo/user-owned-front.png",
    width: 1000,
    height: 1500,
    mime: "image/png",
  };
  const resolver = createAssetResolver(pack, { [frontId]: binding });

  for (const legacyReference of [
    "assets/preset-cards/teste/Frente.png",
    "https://demonrider0.github.io/Double-Sided-Cards/assets/preset-cards/teste/Frente.png?v=69",
    "http://localhost:5173/assets/preset-cards/teste/Copia%20exata.png",
    "http://localhost:5173/.local-assets/legado.png",
    "https://example.invalid/https://images.owlbear.rodeo/11111111-1111-1111-1111-111111111111.png",
  ]) {
    const result = resolver.resolve({ url: legacyReference, width: 1, height: 1 });
    assert.equal(result.canonicalId, frontId);
    assert.equal(result.resolved, true);
    assert.equal(result.value.assetId, frontId);
    assert.equal(result.value.url, binding.url);
  }

  assert.equal(resolver.resolve({ assetId: backId }).resolved, false);
  assert.equal(resolver.resolve("https://example.invalid/public.png").canonicalId, null);

  const migrated = resolveAssetReferences(
    {
      image: { url: "assets/preset-cards/teste/Frente.png", width: 1, height: 1 },
      metadata: {
        face: { url: "assets/preset-cards/teste/Copia exata.png", width: 1, height: 1 },
      },
    },
    { resolver },
  );
  assert.equal(migrated.resolved, 1);
  assert.equal(migrated.unresolved, 0);
  assert.equal(migrated.value.image.assetId, frontId);
  assert.equal(migrated.value.metadata.face.url, binding.url);

  const storage = createMemoryStorage();
  installPrivateAssetPack(pack, storage);
  assert.ok(storage.getItem(PRIVATE_ASSET_STORAGE_KEY));
  assert.equal(readPrivateAssetState(storage).pack.id, pack.id);
  assert.deepEqual(getPrivateAssetPackStatus(storage), {
    configured: true,
    id: pack.id,
    name: pack.name,
    total: 2,
    linked: 0,
    missing: 2,
  });
  savePrivateAssetBindings({ [frontId]: binding }, storage);
  assert.equal(getPrivateAssetPackStatus(storage).linked, 1);

  const matched = matchOwlbearAssetBindings(pack, [
    {
      name: pack.assets[backId].owlbearName,
      description: `double-sided-cards-private-asset:${encodeURIComponent(backId)}`,
      image: {
        url: "https://images.owlbear.rodeo/user-owned-back.png",
        width: 1000,
        height: 1500,
        mime: "image/png",
      },
    },
  ]);
  assert.equal(matched.bindings[backId].url.includes("owlbear.rodeo"), true);
  assert.deepEqual(matched.unmatched, []);

  assert.deepEqual(await loadPresetCardGroups(null), []);
  assert.deepEqual(await loadPresetDecks(null), []);
  assert.equal((await loadScenePresetEntries(null)).every((entry) => !entry.summary), true);
  assert.equal((await loadPresetCardGroups(pack)).length, 1);
  assert.equal((await loadPresetDecks(pack)).length, 1);

  const externalManifest = {
    ...pack,
    presets: {
      cards: "presets/cards.json",
      decks: "presets/decks.json",
      scenes: {
        tutorial: {
          name: "Tutorial",
          restoreLabel: "Restaurar",
          file: "presets/scenes/tutorial.json",
        },
      },
    },
  };
  const jsonFiles = new Map([
    ["presets/cards.json", pack.presets.cards],
    ["presets/decks.json", pack.presets.decks],
    ["presets/scenes/tutorial.json", pack.presets.scenes.tutorial.preset],
  ]);
  const hydrated = await hydratePrivateAssetPackManifest(externalManifest, async (file) =>
    clone(jsonFiles.get(file)),
  );
  assert.equal(hydrated.presets.scenes.tutorial.preset.id, "tutorial");
}

function createImageUploadBuilderRecorder(record) {
  return (file) => {
    const upload = { file };
    const builder = {
      name(value) {
        upload.name = value;
        return builder;
      },
      description(value) {
        upload.description = value;
        return builder;
      },
      build() {
        record.push(upload);
        return upload;
      },
    };
    return builder;
  };
}

async function testPrivateAssetUploadPreparation() {
  const firstId = `sha256:${"c".repeat(64)}`;
  const secondId = `sha256:${"d".repeat(64)}`;
  const firstName = `${"c".repeat(64)}.png`;
  const secondName = `${"d".repeat(64)}.webp`;
  const firstBytes = Uint8Array.from([1, 2, 3, 4]);
  const secondBytes = Uint8Array.from([5, 6, 7]);
  const firstFile = new File([firstBytes], firstName, { type: "image/png" });
  const secondFile = new File([secondBytes], secondName, { type: "image/webp" });
  const pack = {
    assets: {
      [firstId]: {
        file: `assets/${firstName}`,
        owlbearName: "DSC first",
        mime: "image/png",
        size: firstBytes.byteLength,
        typeHint: "PROP",
      },
      [secondId]: {
        file: `assets/${secondName}`,
        owlbearName: "DSC second",
        mime: "image/webp",
        size: secondBytes.byteLength,
        typeHint: "PROP",
      },
    },
  };
  const built = [];
  const buildImageUpload = createImageUploadBuilderRecorder(built);

  const prepared = await preparePrivateAssetUpload(
    buildImageUpload,
    firstFile,
    firstId,
    pack.assets[firstId],
  );
  assert.ok(prepared.file instanceof File);
  assert.notEqual(prepared.file, firstFile);
  assert.equal(prepared.file.name, firstName);
  assert.equal(prepared.file.type, "image/png");
  assert.deepEqual(new Uint8Array(await prepared.file.arrayBuffer()), firstBytes);
  assert.equal(prepared.name, "DSC first");
  assert.equal(
    prepared.description,
    `double-sided-cards-private-asset:${encodeURIComponent(firstId)}`,
  );

  const calls = [];
  const progress = [];
  const result = await uploadPrivateAssetPack(
    {
      assets: {
        async uploadImages(uploads, type) {
          calls.push({ uploads, type });
        },
      },
    },
    buildImageUpload,
    {
      pack,
      assetFiles: new Map([
        [firstId, firstFile],
        [secondId, secondFile],
      ]),
    },
    (event) => progress.push(event),
  );
  assert.deepEqual(result, { uploaded: 2, missingFiles: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].uploads.length, 2);
  assert.equal(calls[0].type, "PROP");
  assert.notEqual(calls[0].uploads[0].file, firstFile);
  assert.notEqual(calls[0].uploads[1].file, secondFile);
  assert.equal(calls[0].uploads[1].file.name, secondName);
  assert.equal(calls[0].uploads[1].file.type, "image/webp");
  assert.deepEqual(new Uint8Array(await calls[0].uploads[1].file.arrayBuffer()), secondBytes);
  assert.equal(progress.at(-1).stage, "uploaded");
  assert.equal(progress.at(-1).processed, 2);

  let apiCalls = 0;
  await assert.rejects(
    () =>
      uploadPrivateAssetPack(
        {
          assets: {
            async uploadImages() {
              apiCalls += 1;
            },
          },
        },
        buildImageUpload,
        {
          pack: {
            assets: {
              [firstId]: {
                ...pack.assets[firstId],
                size: 0,
              },
            },
          },
          assetFiles: new Map([[firstId, new File([], firstName, { type: "image/png" })]]),
        },
      ),
    (error) => {
      assert.equal(error.name, "PrivateAssetUploadError");
      assert.equal(error.category, "invalid-file");
      assert.equal(error.assetId, firstId);
      assert.equal(error.prepared, 0);
      assert.equal(error.uploaded, 0);
      assert.match(error.message, /está vazio|ArrayBuffer válido/);
      return true;
    },
  );
  assert.equal(apiCalls, 0);

  const storageRejection = { code: "STORAGE_QUOTA", error: "Storage quota exceeded" };
  await assert.rejects(
    () =>
      uploadPrivateAssetPack(
        {
          assets: {
            async uploadImages() {
              throw storageRejection;
            },
          },
        },
        buildImageUpload,
        {
          pack: { assets: { [firstId]: pack.assets[firstId] } },
          assetFiles: new Map([[firstId, firstFile]]),
        },
      ),
    (error) => {
      assert.equal(error.cause, storageRejection);
      assert.equal(error.category, "storage");
      assert.equal(error.possibleStorageIssue, true);
      assert.equal(error.prepared, 1);
      assert.equal(error.uploaded, 0);
      assert.match(error.message, /Storage quota exceeded/);
      assert.match(error.message, /possível problema de armazenamento\/cota/);
      return true;
    },
  );

  const cancellation = new DOMException("The user aborted the upload", "AbortError");
  await assert.rejects(
    () =>
      uploadPrivateAssetPack(
        {
          assets: {
            async uploadImages() {
              throw cancellation;
            },
          },
        },
        buildImageUpload,
        {
          pack: { assets: { [firstId]: pack.assets[firstId] } },
          assetFiles: new Map([[firstId, firstFile]]),
        },
      ),
    (error) => {
      assert.equal(error.cause, cancellation);
      assert.equal(error.category, "cancelled");
      assert.equal(error.cancelled, true);
      assert.match(error.message, /cancelado pelo usuário/);
      return true;
    },
  );
}

await testConcurrentReturnIdempotency();
await testPrivateAssetArchitecture();
await testPrivateAssetUploadPreparation();

console.log("Regressões de pilhas e arquitetura privada de assets validadas.");
