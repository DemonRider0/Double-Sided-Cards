import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { access, readFile } from "node:fs/promises";

import {
  buildPrivateAssetStorageBinding,
  calculateBlobSha256,
  createPrivateAssetStorageClient,
  formatPrivateAssetStorageProbeReport,
  runPrivateAssetStorageProbe,
  selectPrivateAssetStorageProbeAssets,
} from "../src/private-asset-storage.js";

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function testFile(name, mime, bytes) {
  return {
    name,
    type: mime,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function createSelection() {
  const webpBytes = Uint8Array.from([1, 3, 5, 7]);
  const largeWebpBytes = Uint8Array.from([1, 2, 3, 4, 5, 6]);
  const jpegBytes = Uint8Array.from([2, 4, 6, 8, 10]);
  const webpId = `sha256:${"a".repeat(64)}`;
  const largeWebpId = `sha256:${"b".repeat(64)}`;
  const jpegId = `sha256:${"c".repeat(64)}`;
  const assets = {
    [largeWebpId]: {
      blobSha256: sha256(largeWebpBytes),
      mime: "image/webp",
      size: largeWebpBytes.byteLength,
      width: 60,
      height: 80,
    },
    [webpId]: {
      blobSha256: sha256(webpBytes),
      mime: "image/webp",
      size: webpBytes.byteLength,
      width: 40,
      height: 50,
    },
    [jpegId]: {
      blobSha256: sha256(jpegBytes),
      mime: "image/jpeg",
      size: jpegBytes.byteLength,
      width: 30,
      height: 45,
    },
  };
  return {
    selection: {
      pack: { assets },
      assetFiles: new Map([
        [largeWebpId, testFile("large.webp", "image/webp", largeWebpBytes)],
        [webpId, testFile("small.webp", "image/webp", webpBytes)],
        [jpegId, testFile("small.jpg", "image/jpeg", jpegBytes)],
      ]),
    },
    ids: { webpId, jpegId },
    bytesByHash: new Map([
      [assets[webpId].blobSha256, webpBytes],
      [assets[jpegId].blobSha256, jpegBytes],
    ]),
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createGatewayFetch(bytesByHash, initiallyStored = []) {
  const stored = new Set(initiallyStored);
  const calls = [];
  const gateway = "https://gateway.example";
  const capability = "read_capability_abcdefghijklmnopqrstuvwxyz012345";

  return {
    calls,
    stored,
    async fetch(rawUrl, options = {}) {
      const url = new URL(rawUrl);
      calls.push({ url: url.href, method: options.method || "GET" });
      if (url.pathname === "/v1/blobs/check") {
        const body = JSON.parse(options.body);
        return jsonResponse({
          ok: true,
          results: body.blobs.map((blob) => ({
            blobSha256: blob.blobSha256,
            exists: stored.has(blob.blobSha256),
            url: stored.has(blob.blobSha256)
              ? `${gateway}/i/${capability}/${blob.blobSha256.slice(7)}`
              : null,
          })),
        });
      }
      if (options.method === "PUT") {
        const blobSha256 = options.headers["X-Blob-SHA256"];
        stored.add(blobSha256);
        return jsonResponse(
          {
            ok: true,
            stored: true,
            alreadyExisted: false,
            blobSha256,
            url: `${gateway}/i/${capability}/${blobSha256.slice(7)}`,
          },
          201,
        );
      }
      if (options.method === "GET") {
        const hash = `sha256:${url.pathname.split("/").at(-1)}`;
        const bytes = bytesByHash.get(hash);
        const mime = [...bytesByHash.keys()].indexOf(hash) === 0 ? "image/webp" : "image/jpeg";
        return new Response(bytes, {
          status: 200,
          headers: {
            "Content-Type": mime,
            "Content-Length": String(bytes.byteLength),
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    },
  };
}

async function testHashAndSelection() {
  const fixture = createSelection();
  const selected = await selectPrivateAssetStorageProbeAssets(fixture.selection, {
    crypto: webcrypto,
  });
  assert.equal(selected.length, 2);
  assert.equal(selected[0].assetId, fixture.ids.webpId);
  assert.equal(selected[1].assetId, fixture.ids.jpegId);
  assert.equal(
    await calculateBlobSha256(selected[0].bytes, webcrypto),
    selected[0].blobSha256,
  );

  const broken = createSelection();
  broken.selection.pack.assets[broken.ids.webpId].blobSha256 = `sha256:${"f".repeat(64)}`;
  await assert.rejects(
    () => selectPrivateAssetStorageProbeAssets(broken.selection, { crypto: webcrypto }),
    /Integridade inválida/,
  );
}

async function testDeduplicationBindingsAndReport() {
  const fixture = createSelection();
  const initialWebpHash = fixture.selection.pack.assets[fixture.ids.webpId].blobSha256;
  const gateway = createGatewayFetch(fixture.bytesByHash, [initialWebpHash]);
  const uploadToken = "upload_token_that_must_never_appear_in_the_report_123456";
  const result = await runPrivateAssetStorageProbe({
    selection: fixture.selection,
    gatewayUrl: "https://gateway.example/",
    uploadToken,
    fetch: gateway.fetch,
    crypto: webcrypto,
  });

  assert.equal(result.assets.length, 2);
  assert.equal(gateway.calls.filter((call) => call.method === "PUT").length, 1);
  assert.equal(result.report.assets[0].alreadyExisted, true);
  assert.equal(result.report.assets[0].uploadPerformed, false);
  assert.equal(result.report.assets[1].alreadyExisted, false);
  assert.equal(result.report.assets[1].uploadPerformed, true);
  assert.equal(result.report.assets[1].uploadCompleted, true);
  assert.equal(result.assets[0].binding.assetId, fixture.ids.webpId);
  assert.equal(result.assets[0].imageContent.mime, "image/webp");
  assert.match(result.assets[0].imageContent.url, /^https:\/\/gateway\.example\/i\//);

  const reportText = formatPrivateAssetStorageProbeReport(result.report);
  assert.match(reportText, /já existia no storage: sim/);
  assert.match(reportText, /upload realizado: sim/);
  assert.match(reportText, /HTTP GET: 200/);
  assert.match(reportText, /URL GET \(capability de acesso ao asset\): https:\/\//);
  assert.doesNotMatch(reportText, new RegExp(uploadToken));
}

async function testRejectedMimeGatewayErrorsAndUrls() {
  assert.throws(
    () =>
      buildPrivateAssetStorageBinding(
        {
          assetId: `sha256:${"a".repeat(64)}`,
          blobSha256: `sha256:${"b".repeat(64)}`,
          width: 1,
          height: 1,
          mime: "image/png",
        },
        "https://gateway.example/i/capability/hash",
      ),
    /MIME inesperado/,
  );
  assert.throws(
    () =>
      createPrivateAssetStorageClient({
        gatewayUrl: "http://gateway.example",
        uploadToken: "x".repeat(40),
        fetch: async () => jsonResponse({}),
      }),
    /HTTPS/,
  );

  const client = createPrivateAssetStorageClient({
    gatewayUrl: "https://gateway.example",
    uploadToken: "x".repeat(40),
    fetch: async () => jsonResponse({ error: "gateway indisponível" }, 503),
  });
  await assert.rejects(
    () =>
      client.checkBlobs([
        {
          blobSha256: `sha256:${"d".repeat(64)}`,
          originalByteLength: 10,
          mime: "image/jpeg",
        },
      ]),
    /gateway indisponível/,
  );
}

async function testPublicBundleHasNoAdministrativeSecrets() {
  try {
    await access(new URL("../dist/app.js", import.meta.url));
  } catch {
    return;
  }
  const bundle = await readFile(new URL("../dist/app.js", import.meta.url), "utf8");
  for (const forbidden of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_API_KEY",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "POC_READ_CAPABILITY",
    "POC_UPLOAD_TOKEN",
  ]) {
    assert.equal(bundle.includes(forbidden), false, `${forbidden} apareceu no bundle público`);
  }
}

await testHashAndSelection();
await testDeduplicationBindingsAndReport();
await testRejectedMimeGatewayErrorsAndUrls();
await testPublicBundleHasNoAdministrativeSecrets();

console.log("POC de armazenamento HTTPS validada sem secrets administrativos no bundle.");

