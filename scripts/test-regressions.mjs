import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  DECK_METADATA_KEY,
  METADATA_KEY,
  normalizeDeckMetadata,
} from "../src/card-data.js";
import {
  PRIVATE_ASSET_PACK_FORMAT,
  PRIVATE_ASSET_MAX_FILE_SIZE,
  PRIVATE_ASSET_PACK_VERSION,
  PRIVATE_ASSET_STORAGE_KEY,
  collectPrivateAssetIds,
  createAssetResolver,
  getPrivateAssetPackStatus,
  installPrivateAssetPack,
  readPrivateAssetState,
  resolveAssetReferences,
  savePrivateAssetBindings,
  validatePrivateAssetPack,
} from "../src/asset-resolver.js";
import { isPresetCardConfigured, loadPresetCardGroups } from "../src/preset-cards.js";
import { isPresetDeckConfigured, loadPresetDecks } from "../src/preset-decks.js";
import {
  SCENE_BOOTSTRAP_MARKER_KEY,
  bootstrapPrivateSceneMetadata,
  buildPrivateSceneUpload,
  captureSceneEnvironment,
  createPrivateScene,
  loadScenePresetEntries,
} from "../src/scene-preset.js";
import {
  COLOR_TOKEN_KEY,
  PLAYER_COLORS,
  SELECTION_BOARD_KEY,
} from "../src/selection-board.js";
import {
  hydratePrivateAssetPackManifest,
  linkPrivateAssetPackFromOwlbear,
  matchOwlbearAssetBindings,
  preparePrivateAssetUpload,
  uploadPrivateAssetPack,
} from "../src/private-asset-pack.js";
import { inspectImageBytes } from "./image-metadata.mjs";
import { optimizePngForRuntime } from "./image-optimizer.mjs";

const RETURNED_SCENE_ITEM_ID_FIELD = "returnedSceneItemId";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZgNwAAAAASUVORK5CYII=",
  "base64",
);
const VALID_JPEG_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

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
        blobSha256: frontId,
        name: "Frente.png",
        owlbearName: "DSC aaaaaaaaaaaa Frente.png",
        size: 4,
        width: 10,
        height: 20,
        mime: "image/png",
        typeHint: "PROP",
      },
      [backId]: {
        file: `assets/${"b".repeat(64)}.png`,
        blobSha256: backId,
        name: "Verso.png",
        owlbearName: "DSC bbbbbbbbbbbb Verso.png",
        size: 4,
        width: 10,
        height: 20,
        mime: "image/png",
        typeHint: "PROP",
      },
    },
    aliases: {
      "assets/preset-cards/teste/Frente.png": frontId,
      "assets/preset-cards/teste/Copia exata.png": frontId,
      ".local-assets/legado.png": frontId,
      ".local-assets/1780360314623-2d773fbe-40df-48d4-ac48-aecc7767ded0-mapa-tutorial-c-.png": frontId,
      "sha256:8df5eec365bee571ee74e3b0b1f00f1112f754ea8799e72a291ab10d0f12ba0b": frontId,
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
  const existingCoreItem = createCardItem("core-without-pack", "existing-deck");
  const coreWithoutPack = resolveAssetReferences(existingCoreItem, {
    resolver: createAssetResolver(),
  });
  assert.equal(coreWithoutPack.canonical, 0);
  assert.equal(coreWithoutPack.unresolved, 0);
  assert.deepEqual(coreWithoutPack.value, existingCoreItem);

  const v1Pack = clone(pack);
  v1Pack.version = 1;
  for (const asset of Object.values(v1Pack.assets)) {
    delete asset.blobSha256;
  }
  const normalizedV1 = validatePrivateAssetPack(v1Pack);
  assert.equal(normalizedV1.version, 2);
  assert.equal(normalizedV1.sourceFormatVersion, 1);
  assert.equal(normalizedV1.assets[frontId].blobSha256, frontId);

  const recompressedV2 = clone(pack);
  recompressedV2.assets[frontId].blobSha256 = `sha256:${"f".repeat(64)}`;
  assert.equal(
    validatePrivateAssetPack(recompressedV2).assets[frontId].blobSha256,
    `sha256:${"f".repeat(64)}`,
  );
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
    ".local-assets/1780360314623-2d773fbe-40df-48d4-ac48-aecc7767ded0-mapa-tutorial-c-.png",
    "sha256:8df5eec365bee571ee74e3b0b1f00f1112f754ea8799e72a291ab10d0f12ba0b",
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
    runtimeSize: 8,
    total: 2,
    linked: 0,
    missing: 2,
  });
  savePrivateAssetBindings({ [frontId]: binding }, storage);
  assert.equal(getPrivateAssetPackStatus(storage).linked, 1);
  savePrivateAssetBindings(
    {
      [backId]: {
        ...binding,
        url: "https://images.owlbear.rodeo/user-owned-back.png",
      },
    },
    storage,
  );
  assert.equal(getPrivateAssetPackStatus(storage).linked, 2);
  assert.equal(readPrivateAssetState(storage).bindings[frontId].url, binding.url);
  const optimizedPack = clone(pack);
  optimizedPack.assets[frontId] = {
    ...optimizedPack.assets[frontId],
    file: `assets/${"a".repeat(64)}.webp`,
    blobSha256: `sha256:${"f".repeat(64)}`,
    size: 3,
    mime: "image/webp",
  };
  installPrivateAssetPack(optimizedPack, storage);
  assert.equal(readPrivateAssetState(storage).bindings[frontId].url, binding.url);
  assert.equal(getPrivateAssetPackStatus(storage).linked, 2);

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

  for (const [extension, mime] of [
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".webp", "image/webp"],
  ]) {
    const formatPack = createPrivatePackFixture();
    const assetId = Object.keys(formatPack.assets)[0];
    formatPack.assets[assetId].file = `assets/${"a".repeat(64)}${extension}`;
    formatPack.assets[assetId].mime = mime;
    assert.doesNotThrow(() => validatePrivateAssetPack(formatPack));
  }

  const svgPack = createPrivatePackFixture();
  const svgAssetId = Object.keys(svgPack.assets)[0];
  svgPack.assets[svgAssetId].file = `assets/${"a".repeat(64)}.svg`;
  svgPack.assets[svgAssetId].mime = "image/svg+xml";
  assert.throws(
    () => validatePrivateAssetPack(svgPack),
    /formato não suportado para upload no Owlbear/i,
  );
}

function createPrivateAssetDownload(pack, assetId, suffix = "png") {
  const asset = pack.assets[assetId];
  return {
    name: asset.owlbearName,
    description: `double-sided-cards-private-asset:${encodeURIComponent(assetId)}`,
    image: {
      url: `https://images.owlbear.rodeo/${assetId.slice(7, 19)}.${suffix}`,
      width: asset.width,
      height: asset.height,
      mime: asset.mime,
    },
  };
}

async function testManualPrivateAssetBindings() {
  const pack = createPrivatePackFixture();
  const [frontId, backId] = Object.keys(pack.assets);
  const resolver = createAssetResolver(pack);
  const [cardGroup] = await loadPresetCardGroups(pack);
  const card = cardGroup.cards[0];
  const [deck] = await loadPresetDecks(pack);
  const scene = pack.presets.scenes.tutorial.preset;
  const cardReferences = {
    front: card.front,
    back: card.back?.assetId || card.back?.path ? card.back : cardGroup.back,
  };

  assert.deepEqual(
    new Set(collectPrivateAssetIds(cardReferences, { resolver })),
    new Set([frontId, backId]),
  );
  assert.deepEqual(
    new Set(collectPrivateAssetIds(deck, { resolver })),
    new Set([frontId, backId]),
  );
  assert.deepEqual(collectPrivateAssetIds(scene, { resolver }), [frontId]);
  assert.equal(isPresetCardConfigured(cardGroup, card), true);
  assert.equal(isPresetDeckConfigured(deck), true);
  const unavailableScene = (await loadScenePresetEntries(pack)).find(
    (entry) => entry.definition.id === "tutorial",
  );
  assert.equal(unavailableScene.ready, false);
  assert.deepEqual(unavailableScene.unresolvedAssetIds, [frontId]);

  const storage = createMemoryStorage();
  installPrivateAssetPack(pack, storage);
  const originalFrontBinding = {
    url: "https://images.owlbear.rodeo/already-linked-front.png",
    width: 10,
    height: 20,
    mime: "image/png",
  };
  savePrivateAssetBindings({ [frontId]: originalFrontBinding }, storage);

  const partialResolver = createAssetResolver(pack, { [frontId]: originalFrontBinding });
  const cardBeforeResolution = clone(cardReferences);
  const partialResolution = resolveAssetReferences(cardReferences, { resolver: partialResolver });
  assert.equal(partialResolution.resolved, 1);
  assert.equal(partialResolution.unresolved, 1);
  assert.deepEqual(partialResolution.unresolvedIds, [backId]);
  assert.equal(partialResolution.value.front.url, originalFrontBinding.url);
  assert.equal(partialResolution.value.back.assetId, backId);
  assert.deepEqual(cardReferences, cardBeforeResolution);

  const partialScene = (await loadScenePresetEntries(pack, { resolver: partialResolver })).find(
    (entry) => entry.definition.id === "tutorial",
  );
  assert.equal(partialScene.ready, true);
  assert.deepEqual(partialScene.unresolvedAssetIds, []);
  assert.equal(getPrivateAssetPackStatus(storage).linked, 1);

  let selectorCalls = 0;
  const OBR = {
    assets: {
      async downloadImages() {
        selectorCalls += 1;
        return selectorCalls === 1 ? [createPrivateAssetDownload(pack, backId)] : [];
      },
    },
  };
  const first = await linkPrivateAssetPackFromOwlbear(OBR, storage);
  assert.equal(first.linked, 1);
  assert.equal(selectorCalls, 1);
  assert.equal(readPrivateAssetState(storage).bindings[frontId].url, originalFrontBinding.url);
  assert.equal(readPrivateAssetState(storage).bindings[backId].url.includes("owlbear.rodeo"), true);

  const linkedResolver = createAssetResolver(pack, readPrivateAssetState(storage).bindings);
  const linkedCard = resolveAssetReferences(cardReferences, { resolver: linkedResolver });
  assert.equal(linkedCard.unresolved, 0);
  assert.equal(linkedCard.value.front.url, originalFrontBinding.url);
  assert.equal(linkedCard.value.back.url.includes("owlbear.rodeo"), true);

  await linkPrivateAssetPackFromOwlbear(OBR, storage);
  assert.equal(selectorCalls, 2);

  const [privatePackSource, appSource, htmlSource] = await Promise.all([
    readFile(path.join(PROJECT_ROOT, "src/private-asset-pack.js"), "utf8"),
    readFile(path.join(PROJECT_ROOT, "src/app.js"), "utf8"),
    readFile(path.join(PROJECT_ROOT, "index.html"), "utf8"),
  ]);
  assert.equal(privatePackSource.includes("ensurePrivateAssetsLinked"), false);
  assert.equal(appSource.includes("ensurePrivateAssetsLinked"), false);
  assert.equal((privatePackSource.match(/\.downloadImages\(/g) || []).length, 1);
  assert.equal(appSource.includes("downloadImages("), false);
  assert.equal(appSource.includes("237"), false);
  assert.equal(appSource.includes("faltantes"), false);
  assert.equal(appSource.includes("status.missing"), false);
  assert.equal(appSource.includes("${status.linked} de"), false);
  assert.equal(htmlSource.includes("Upload opcional"), true);
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

function createSceneUploadBuilderRecorder(record) {
  return () => {
    const upload = {
      name: "New Scene",
      grid: {
        dpi: 150,
        scale: "5ft",
        style: {
          lineColor: "LIGHT",
          lineOpacity: 0.4,
          lineType: "DASHED",
          lineWidth: 2,
        },
        measurement: "CHEBYSHEV",
        type: "SQUARE",
      },
      fog: { filled: false, style: { color: "#222222", strokeWidth: 5 } },
      items: [],
    };
    const builder = {
      name(value) { upload.name = value; return builder; },
      items(value) { upload.items = value; return builder; },
      gridScale(value) { upload.grid.scale = value; return builder; },
      gridColor(value) { upload.grid.style.lineColor = value; return builder; },
      gridOpacity(value) { upload.grid.style.lineOpacity = value; return builder; },
      gridLineType(value) { upload.grid.style.lineType = value; return builder; },
      gridMeasurement(value) { upload.grid.measurement = value; return builder; },
      gridType(value) { upload.grid.type = value; return builder; },
      fogFilled(value) { upload.fog.filled = value; return builder; },
      fogColor(value) { upload.fog.style.color = value; return builder; },
      fogStrokeWidth(value) { upload.fog.style.strokeWidth = value; return builder; },
      build() { record.push(upload); return upload; },
    };
    return builder;
  };
}

async function testPrivateSceneUploadArchitecture() {
  const pack = createPrivatePackFixture();
  const [frontId] = Object.keys(pack.assets);
  const binding = {
    url: "https://images.owlbear.rodeo/user-owned-scene-image.webp",
    width: 1000,
    height: 1500,
    mime: "image/webp",
  };
  const resolver = createAssetResolver(pack, { [frontId]: binding });
  const preset = clone(pack.presets.scenes.tutorial.preset);
  preset.itemCount = PLAYER_COLORS.length;
  preset.items = PLAYER_COLORS.map((color, index) => ({
    id: `scene-item-${index + 1}`,
    type: "IMAGE",
    name: `Item ${index + 1}`,
    position: { x: index * 10, y: index * 20 },
    rotation: index * 5,
    scale: { x: 1 + index / 10, y: 1 + index / 10 },
    layer: index ? "PROP" : "MAP",
    zIndex: 100 + index,
    locked: index === 0,
    visible: true,
    ...(index === 1 ? { attachedTo: "scene-item-1" } : {}),
    image: { assetId: frontId, width: 10, height: 20, mime: "image/png" },
    metadata: {
      [COLOR_TOKEN_KEY]: { version: 1, color: color.id },
      ...(index === 0
        ? { [METADATA_KEY]: { version: 1, currentFace: "back", preserved: true } }
        : {}),
      ...(index === 1
        ? { [DECK_METADATA_KEY]: { version: 1, currentFace: "front", cards: [], preserved: true } }
        : {}),
    },
  }));
  preset.metadata = {
    "com.battle-system.smoke/sceneId": "private-smoke-data",
    [SELECTION_BOARD_KEY]: {
      version: 1,
      assigned: { red: { race: "scene-item-1" } },
      origins: { "scene-item-1": { x: 10, y: 20 } },
    },
  };
  preset.grid = {
    dpi: 72,
    scale: "1.5m",
    color: "DARK",
    opacity: 0.7,
    lineType: "SOLID",
    measurement: "EUCLIDEAN",
    type: "SQUARE",
  };
  preset.fog = { filled: true, color: "#101010", strokeWidth: 3 };

  const built = [];
  const buildSceneUpload = createSceneUploadBuilderRecorder(built);
  const first = buildPrivateSceneUpload(buildSceneUpload, preset, { resolver });
  assert.equal(first.itemCount, preset.items.length);
  assert.equal(first.idsPreserved, true);
  assert.equal(first.upload.grid.dpi, 72);
  assert.equal(first.upload.grid.scale, "1.5m");
  assert.equal(first.upload.fog.filled, true);
  assert.equal(first.upload.items[1].attachedTo, "scene-item-1");
  assert.equal(first.upload.items[0].image.url, binding.url);
  assert.deepEqual(first.upload.items[0].metadata[METADATA_KEY], preset.items[0].metadata[METADATA_KEY]);
  assert.deepEqual(first.upload.items[1].metadata[DECK_METADATA_KEY], preset.items[1].metadata[DECK_METADATA_KEY]);
  assert.equal(Object.hasOwn(first.upload, "metadata"), false);
  const marker = first.upload.items[0].metadata[SCENE_BOOTSTRAP_MARKER_KEY];
  assert.deepEqual(marker.selectionBoard, preset.metadata[SELECTION_BOARD_KEY]);
  assert.equal(JSON.stringify(marker).includes("battle-system"), false);

  const uploaded = [];
  const OBR = {
    assets: {
      async uploadScenes(scenes) {
        uploaded.push(scenes[0]);
      },
    },
    scene: {
      items: {
        async getItems() { throw new Error("A cena aberta não pode ser lida durante uploadScenes."); },
        async updateItems() { throw new Error("A cena aberta não pode ser alterada durante uploadScenes."); },
        async deleteItems() { throw new Error("A cena aberta não pode ser alterada durante uploadScenes."); },
      },
    },
  };
  await createPrivateScene(OBR, buildSceneUpload, preset, { resolver });
  await createPrivateScene(OBR, buildSceneUpload, preset, { resolver });
  assert.equal(uploaded.length, 2);
  assert.notEqual(uploaded[0], uploaded[1]);
  assert.notEqual(uploaded[0].items, uploaded[1].items);
  uploaded[0].items[0].position.x = 99999;
  assert.equal(uploaded[1].items[0].position.x, preset.items[0].position.x);

  assert.throws(
    () => buildPrivateSceneUpload(buildSceneUpload, preset, { resolver: createAssetResolver(pack) }),
    (error) => error.name === "MissingPrivateAssetBindingsError" && error.missingBindings === 1,
  );

  let sceneMetadata = {};
  let markerItem = clone(first.upload.items[0]);
  let metadataWrites = 0;
  const bootstrapOBR = {
    scene: {
      async getMetadata() { return clone(sceneMetadata); },
      async setMetadata(patch) {
        metadataWrites += 1;
        assert.deepEqual(Object.keys(patch), [SELECTION_BOARD_KEY]);
        sceneMetadata = { ...sceneMetadata, ...clone(patch) };
      },
      items: {
        async getItems() { return [clone(markerItem)]; },
        async updateItems(ids, update) {
          assert.deepEqual(ids, [markerItem.id]);
          const drafts = [clone(markerItem)];
          update(drafts);
          markerItem = drafts[0];
        },
      },
    },
  };
  assert.deepEqual(await bootstrapPrivateSceneMetadata(bootstrapOBR), {
    found: true,
    applied: true,
  });
  assert.equal(metadataWrites, 1);
  assert.equal(markerItem.metadata[SCENE_BOOTSTRAP_MARKER_KEY].completed, true);
  assert.deepEqual(await bootstrapPrivateSceneMetadata(bootstrapOBR), {
    found: false,
    applied: false,
  });
  assert.equal(metadataWrites, 1);
  assert.equal(Object.hasOwn(sceneMetadata, "com.battle-system.smoke/sceneId"), false);

  const captured = await captureSceneEnvironment({
    scene: {
      grid: {
        async getDpi() { return 72; },
        async getScale() { return { raw: "1.5m" }; },
        async getColor() { return "DARK"; },
        async getOpacity() { return 0.7; },
        async getLineType() { return "SOLID"; },
        async getMeasurement() { return "EUCLIDEAN"; },
        async getType() { return "SQUARE"; },
      },
      fog: {
        async getFilled() { return true; },
        async getColor() { return "#101010"; },
        async getStrokeWidth() { return 3; },
      },
    },
  });
  assert.deepEqual(captured, { grid: preset.grid, fog: preset.fog });
}

async function testRuntimeImageOptimizationPolicy() {
  const tinySource = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
  }).png().toBuffer();
  const tiny = await optimizePngForRuntime(tinySource);
  assert.equal(tiny.converted, false);
  assert.equal(tiny.runtimeSize, tinySource.length);

  const width = 512;
  const height = 512;
  const pixels = Buffer.alloc(width * height * 4);
  let seed = 0x12345678;
  for (let index = 0; index < width * height; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const offset = index * 4;
    pixels[offset] = seed & 0xff;
    pixels[offset + 1] = (seed >>> 8) & 0xff;
    pixels[offset + 2] = (seed >>> 16) & 0xff;
    pixels[offset + 3] = index % 251;
  }
  const source = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const optimized = await optimizePngForRuntime(source);
  assert.equal(optimized.converted, true);
  assert.ok(optimized.runtimeSize < source.length);
  const metadata = await sharp(optimized.bytes, { failOn: "error" }).metadata();
  await sharp(optimized.bytes, { failOn: "error" }).stats();
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.equal(metadata.hasAlpha, true);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createGeneratorFixture(sourceRoot, referencedSvg) {
  const directories = [
    "assets/preset-cards",
    "assets/preset-decks",
    "assets/scene-presets",
    "assets/local-assets",
  ];
  await Promise.all(
    directories.map((directory) => mkdir(path.join(sourceRoot, directory), { recursive: true })),
  );

  const pngReference = "assets/local-assets/valid.png";
  const svgReference = "assets/local-assets/old-card.svg";
  const invalidReference = "assets/local-assets/invalid-test.png";
  await writeFile(path.join(sourceRoot, pngReference), VALID_PNG_BYTES);
  await writeFile(path.join(sourceRoot, invalidReference), "hello", "utf8");
  await writeFile(
    path.join(sourceRoot, "assets/local-assets/arbitrary-test.png"),
    Buffer.from([0x00, 0x13, 0x37, 0xff]),
  );
  await writeFile(
    path.join(sourceRoot, svgReference),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>\n',
    "utf8",
  );
  await writeJson(path.join(sourceRoot, "assets/preset-cards/cards.json"), {
    version: 1,
    groups: [
      {
        id: "fixture",
        name: "Fixture",
        back: pngReference,
        cards: [
          {
            id: "card",
            name: "Card",
            front:
              referencedSvg === "svg"
                ? svgReference
                : referencedSvg === "invalid"
                  ? invalidReference
                  : pngReference,
          },
        ],
      },
    ],
  });
  await writeJson(path.join(sourceRoot, "assets/preset-decks/decks.json"), {
    version: 1,
    decks: [],
  });
  await writeJson(path.join(sourceRoot, "assets/scene-presets/tutorial.json"), {
    version: 1,
    id: "tutorial",
    name: "Tutorial",
    savedAt: "2026-01-01T00:00:00.000Z",
    itemCount: 0,
    items: [],
    metadata: {},
  });
}

function runPrivatePackGenerator(sourceRoot, outputRoot, previousManifest = "") {
  const argumentsList = [
    path.join(PROJECT_ROOT, "scripts/build-private-asset-pack.mjs"),
    "--source",
    sourceRoot,
    "--output",
    outputRoot,
  ];
  if (previousManifest) {
    argumentsList.push("--previous", previousManifest);
  }
  return spawnSync(
    process.execPath,
    argumentsList,
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

function runPrivatePackChecker(packRoot) {
  return spawnSync(
    process.execPath,
    [path.join(PROJECT_ROOT, "scripts/check-private-asset-pack.mjs"), "--pack", packRoot],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  return current >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createOversizedPng(fillByte) {
  const iendOffset = VALID_PNG_BYTES.length - 12;
  const payloadLength = PRIVATE_ASSET_MAX_FILE_SIZE - VALID_PNG_BYTES.length + 1;
  const chunk = Buffer.alloc(payloadLength + 12, fillByte);
  chunk.writeUInt32BE(payloadLength, 0);
  chunk.write("dsCa", 4, "ascii");
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + payloadLength)), 8 + payloadLength);
  return Buffer.concat([
    VALID_PNG_BYTES.subarray(0, iendOffset),
    chunk,
    VALID_PNG_BYTES.subarray(iendOffset),
  ]);
}

function addJpegComment(bytes, text) {
  const comment = Buffer.from(text, "utf8");
  const segment = Buffer.alloc(comment.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xfe;
  segment.writeUInt16BE(comment.length + 2, 2);
  comment.copy(segment, 4);
  return Buffer.concat([bytes.subarray(0, 2), segment, bytes.subarray(2)]);
}

async function addHistoricalTutorialReplacementFixture(sourceRoot) {
  const names = {
    oldA: "1779668122715-e5c59860-137c-4664-b55c-fc546033288b-mapa-tutorial-a-.png",
    mobileA:
      "1779668122715-e5c59860-137c-4664-b55c-fc546033288b-mapa-tutorial-a--mobile.jpg",
    oldB: "1779668122717-841f7e43-ef8f-407f-bfe7-115b51c6779c-mapa-tutorial-b-.png",
    mobileB:
      "1779668122717-841f7e43-ef8f-407f-bfe7-115b51c6779c-mapa-tutorial-b--mobile.jpg",
  };
  const oldABytes = createOversizedPng(0x41);
  const oldBBytes = createOversizedPng(0x42);
  const mobileABytes = addJpegComment(VALID_JPEG_BYTES, "tutorial-a");
  const mobileBBytes = addJpegComment(VALID_JPEG_BYTES, "tutorial-b");
  for (const [name, bytes] of [
    [names.oldA, oldABytes],
    [names.mobileA, mobileABytes],
    [names.oldB, oldBBytes],
    [names.mobileB, mobileBBytes],
  ]) {
    await writeFile(path.join(sourceRoot, "assets/local-assets", name), bytes);
  }
  return {
    names,
    oldAId: `sha256:${hashBytes(oldABytes)}`,
    oldBId: `sha256:${hashBytes(oldBBytes)}`,
  };
}

async function testPrivateAssetPackGeneratorFormats() {
  assert.deepEqual(inspectImageBytes(VALID_PNG_BYTES, "valid.png"), {
    width: 1,
    height: 1,
    mime: "image/png",
  });
  assert.throws(() => inspectImageBytes(Buffer.from("hello"), "hello.png"), /assinatura PNG/i);
  assert.throws(
    () => inspectImageBytes(Buffer.from([0x00, 0x13, 0x37, 0xff]), "bytes.png"),
    /assinatura PNG/i,
  );

  const oversizedPack = createPrivatePackFixture();
  const oversizedAssetId = Object.keys(oversizedPack.assets)[0];
  oversizedPack.assets[oversizedAssetId].size = PRIVATE_ASSET_MAX_FILE_SIZE + 1;
  assert.throws(() => validatePrivateAssetPack(oversizedPack), /plano Fledgling/i);

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "dsc-private-pack-test-"));
  try {
    const unreferencedSource = path.join(temporaryRoot, "unreferenced-source");
    const unreferencedOutput = path.join(temporaryRoot, "unreferenced-output");
    await createGeneratorFixture(unreferencedSource, "valid");
    const unreferencedResult = runPrivatePackGenerator(unreferencedSource, unreferencedOutput);
    assert.equal(
      unreferencedResult.status,
      0,
      unreferencedResult.stderr || unreferencedResult.stdout,
    );
    const manifest = JSON.parse(
      await readFile(path.join(unreferencedOutput, "private-asset-pack.json"), "utf8"),
    );
    const generatedCards = JSON.parse(
      await readFile(path.join(unreferencedOutput, "presets/cards.json"), "utf8"),
    );
    assert.equal(Object.keys(manifest.assets).length, 1);
    assert.equal(Object.values(manifest.assets)[0].mime, "image/png");
    assert.equal(
      generatedCards.groups[0].cards[0].front.assetId,
      Object.keys(manifest.assets)[0],
    );
    assert.equal(
      (await readdir(path.join(unreferencedOutput, "assets"))).some((file) =>
        file.toLowerCase().endsWith(".svg"),
      ),
      false,
    );
    assert.match(unreferencedResult.stdout, /1 imagens incompatíveis e não referenciadas ignoradas/);
    assert.match(unreferencedResult.stdout, /2 arquivos com extensão de imagem e conteúdo inválido ignorados/);

    const validAssetId = Object.keys(manifest.assets)[0];
    const invalidCanonicalBytes = Buffer.from("hello", "utf8");
    const invalidCanonicalId = `sha256:${hashBytes(invalidCanonicalBytes)}`;
    const invalidCanonicalFile = `assets/${invalidCanonicalId.slice("sha256:".length)}.png`;
    await rm(path.join(unreferencedOutput, manifest.assets[validAssetId].file));
    await writeFile(path.join(unreferencedOutput, invalidCanonicalFile), invalidCanonicalBytes);
    manifest.assets = {
      [invalidCanonicalId]: {
        ...manifest.assets[validAssetId],
        file: invalidCanonicalFile,
        size: invalidCanonicalBytes.length,
      },
    };
    manifest.aliases = Object.fromEntries(
      Object.entries(manifest.aliases).map(([alias, assetId]) => [
        alias,
        assetId === validAssetId ? invalidCanonicalId : assetId,
      ]),
    );
    await writeJson(path.join(unreferencedOutput, "private-asset-pack.json"), manifest);
    for (const relativePath of [
      "presets/cards.json",
      "presets/decks.json",
      "presets/scenes/tutorial.json",
    ]) {
      const filePath = path.join(unreferencedOutput, relativePath);
      const content = await readFile(filePath, "utf8");
      await writeFile(filePath, content.replaceAll(validAssetId, invalidCanonicalId), "utf8");
    }
    const invalidPackCheck = runPrivatePackChecker(unreferencedOutput);
    assert.notEqual(invalidPackCheck.status, 0);
    assert.match(
      `${invalidPackCheck.stderr}\n${invalidPackCheck.stdout}`,
      /Asset canônico não é uma imagem real e legível.*assinatura PNG/is,
    );

    const referencedSource = path.join(temporaryRoot, "referenced-source");
    const referencedOutput = path.join(temporaryRoot, "referenced-output");
    await createGeneratorFixture(referencedSource, "svg");
    const referencedResult = runPrivatePackGenerator(referencedSource, referencedOutput);
    assert.notEqual(referencedResult.status, 0);
    assert.match(
      `${referencedResult.stderr}\n${referencedResult.stdout}`,
      /Referência privada incompatível.*old-card\.svg.*formato.*não é aceito/is,
    );

    const invalidReferencedSource = path.join(temporaryRoot, "invalid-referenced-source");
    const invalidReferencedOutput = path.join(temporaryRoot, "invalid-referenced-output");
    await createGeneratorFixture(invalidReferencedSource, "invalid");
    const invalidReferencedResult = runPrivatePackGenerator(
      invalidReferencedSource,
      invalidReferencedOutput,
    );
    assert.notEqual(invalidReferencedResult.status, 0);
    assert.match(
      `${invalidReferencedResult.stderr}\n${invalidReferencedResult.stdout}`,
      /Referência privada incompatível.*invalid-test\.png.*não é uma imagem real e legível/is,
    );

    const replacementSource = path.join(temporaryRoot, "replacement-source");
    const replacementOutput = path.join(temporaryRoot, "replacement-output");
    const replacementPrevious = path.join(temporaryRoot, "replacement-previous.json");
    await createGeneratorFixture(replacementSource, "valid");
    const replacementFixture = await addHistoricalTutorialReplacementFixture(replacementSource);
    await writeJson(replacementPrevious, {
      aliases: {
        "owlbear:historical-a": replacementFixture.oldAId,
        "owlbear:historical-b": replacementFixture.oldBId,
      },
    });
    const replacementResult = runPrivatePackGenerator(
      replacementSource,
      replacementOutput,
      replacementPrevious,
    );
    assert.equal(replacementResult.status, 0, replacementResult.stderr || replacementResult.stdout);
    const replacementManifest = JSON.parse(
      await readFile(path.join(replacementOutput, "private-asset-pack.json"), "utf8"),
    );
    const oldAPath = `assets/local-assets/${replacementFixture.names.oldA}`;
    const oldBPath = `assets/local-assets/${replacementFixture.names.oldB}`;
    const mobileAPath = `assets/local-assets/${replacementFixture.names.mobileA}`;
    const mobileBPath = `assets/local-assets/${replacementFixture.names.mobileB}`;
    const mobileAId = replacementManifest.aliases[mobileAPath];
    const mobileBId = replacementManifest.aliases[mobileBPath];
    assert.ok(mobileAId && mobileBId && mobileAId !== mobileBId);
    assert.equal(replacementManifest.aliases[oldAPath], mobileAId);
    assert.equal(replacementManifest.aliases[oldBPath], mobileBId);
    assert.equal(replacementManifest.aliases[replacementFixture.oldAId], mobileAId);
    assert.equal(replacementManifest.aliases[replacementFixture.oldBId], mobileBId);
    assert.equal(replacementManifest.aliases["owlbear:historical-a"], mobileAId);
    assert.equal(replacementManifest.aliases["owlbear:historical-b"], mobileBId);
    assert.equal(
      Object.values(replacementManifest.assets).some(
        (asset) => asset.size > PRIVATE_ASSET_MAX_FILE_SIZE,
      ),
      false,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await testConcurrentReturnIdempotency();
await testPrivateAssetArchitecture();
await testManualPrivateAssetBindings();
await testPrivateAssetUploadPreparation();
await testPrivateSceneUploadArchitecture();
await testRuntimeImageOptimizationPolicy();
await testPrivateAssetPackGeneratorFormats();

console.log("Regressões de pilhas e arquitetura privada de assets validadas.");
