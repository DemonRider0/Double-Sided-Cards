import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createPrivateAssetGateway } from "../src/worker.js";

const UPLOAD_TOKEN = "upload_capability_abcdefghijklmnopqrstuvwxyz0123456789";
const READ_CAPABILITY = "read_capability_abcdefghijklmnopqrstuvwxyz0123456789";

class FakeR2Bucket {
  constructor() {
    this.objects = new Map();
    this.putCount = 0;
  }

  async head(key) {
    const value = this.objects.get(key);
    return value ? this.metadata(key, value) : null;
  }

  async get(key) {
    const value = this.objects.get(key);
    return value ? { ...this.metadata(key, value), body: value.bytes } : null;
  }

  async put(key, rawBytes, options) {
    this.putCount += 1;
    const bytes = new Uint8Array(rawBytes);
    const value = {
      bytes,
      httpMetadata: options.httpMetadata,
      customMetadata: options.customMetadata,
    };
    this.objects.set(key, value);
    return this.metadata(key, value);
  }

  metadata(key, value) {
    return {
      key,
      size: value.bytes.byteLength,
      httpMetadata: value.httpMetadata,
      customMetadata: value.customMetadata,
      httpEtag: `"${createHash("md5").update(value.bytes).digest("hex")}"`,
    };
  }
}

function createFixture() {
  const bucket = new FakeR2Bucket();
  return {
    bucket,
    gateway: createPrivateAssetGateway(),
    env: {
      PRIVATE_ASSETS: bucket,
      POC_UPLOAD_TOKEN: UPLOAD_TOKEN,
      POC_READ_CAPABILITY: READ_CAPABILITY,
    },
  };
}

function blobFixture(mime = "image/webp") {
  const bytes =
    mime === "image/jpeg"
      ? Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 10, 20, 30, 40])
      : Uint8Array.from([
          0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 10, 20, 30,
        ]);
  const hex = createHash("sha256").update(bytes).digest("hex");
  return { bytes, hex, blobSha256: `sha256:${hex}`, mime };
}

function authorizedHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${UPLOAD_TOKEN}`,
    ...extra,
  };
}

test("consulta, upload verificado, GET e deduplicação são idempotentes", async () => {
  const fixture = createFixture();
  const blob = blobFixture();
  const checkRequest = () =>
    new Request("https://gateway.example/v1/blobs/check", {
      method: "POST",
      headers: authorizedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        blobs: [
          { blobSha256: blob.blobSha256, size: blob.bytes.byteLength, mime: blob.mime },
        ],
      }),
    });

  let response = await fixture.gateway.fetch(checkRequest(), fixture.env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].exists, false);

  const uploadRequest = () =>
    new Request(`https://gateway.example/v1/blobs/${blob.hex}`, {
      method: "PUT",
      headers: authorizedHeaders({
        "Content-Type": blob.mime,
        "X-Blob-SHA256": blob.blobSha256,
        "X-Blob-Size": String(blob.bytes.byteLength),
      }),
      body: blob.bytes,
    });
  response = await fixture.gateway.fetch(uploadRequest(), fixture.env);
  assert.equal(response.status, 201);
  const uploaded = await response.json();
  assert.equal(uploaded.stored, true);
  assert.equal(uploaded.alreadyExisted, false);
  assert.match(uploaded.url, new RegExp(`/i/${READ_CAPABILITY}/${blob.hex}$`));
  assert.equal(fixture.bucket.putCount, 1);

  response = await fixture.gateway.fetch(uploadRequest(), fixture.env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).alreadyExisted, true);
  assert.equal(fixture.bucket.putCount, 1);

  response = await fixture.gateway.fetch(checkRequest(), fixture.env);
  assert.equal((await response.json()).results[0].exists, true);

  response = await fixture.gateway.fetch(new Request(uploaded.url), fixture.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), blob.mime);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("X-Content-SHA256"), blob.blobSha256);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), blob.bytes);
});

test("rejeita autorização, capability de leitura, MIME e hash inválidos", async () => {
  const fixture = createFixture();
  const blob = blobFixture("image/jpeg");

  let response = await fixture.gateway.fetch(
    new Request("https://gateway.example/v1/blobs/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobs: [] }),
    }),
    fixture.env,
  );
  assert.equal(response.status, 401);

  response = await fixture.gateway.fetch(
    new Request(`https://gateway.example/v1/blobs/${blob.hex}`, {
      method: "PUT",
      headers: authorizedHeaders({
        "Content-Type": "image/png",
        "X-Blob-SHA256": blob.blobSha256,
        "X-Blob-Size": String(blob.bytes.byteLength),
      }),
      body: blob.bytes,
    }),
    fixture.env,
  );
  assert.equal(response.status, 400);

  const invalidJpegBytes = Uint8Array.from([1, 2, 3, 4]);
  const invalidJpegHex = createHash("sha256").update(invalidJpegBytes).digest("hex");
  response = await fixture.gateway.fetch(
    new Request(`https://gateway.example/v1/blobs/${invalidJpegHex}`, {
      method: "PUT",
      headers: authorizedHeaders({
        "Content-Type": "image/jpeg",
        "X-Blob-SHA256": `sha256:${invalidJpegHex}`,
        "X-Blob-Size": String(invalidJpegBytes.byteLength),
      }),
      body: invalidJpegBytes,
    }),
    fixture.env,
  );
  assert.equal(response.status, 415);

  const wrongHex = "f".repeat(64);
  response = await fixture.gateway.fetch(
    new Request(`https://gateway.example/v1/blobs/${wrongHex}`, {
      method: "PUT",
      headers: authorizedHeaders({
        "Content-Type": blob.mime,
        "X-Blob-SHA256": `sha256:${wrongHex}`,
        "X-Blob-Size": String(blob.bytes.byteLength),
      }),
      body: blob.bytes,
    }),
    fixture.env,
  );
  assert.equal(response.status, 409);

  response = await fixture.gateway.fetch(
    new Request(`https://gateway.example/i/capability-incorreta/${blob.hex}`),
    fixture.env,
  );
  assert.equal(response.status, 404);
});

test("health não revela os valores dos secrets", async () => {
  const fixture = createFixture();
  const response = await fixture.gateway.fetch(
    new Request("https://gateway.example/v1/health"),
    fixture.env,
  );
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(text, new RegExp(UPLOAD_TOKEN));
  assert.doesNotMatch(text, new RegExp(READ_CAPABILITY));
  assert.deepEqual(JSON.parse(text).configured, {
    bucket: true,
    uploadAuthorization: true,
    readCapability: true,
  });
});

test("preflight CORS autoriza somente os métodos e headers da POC", async () => {
  const fixture = createFixture();
  const response = await fixture.gateway.fetch(
    new Request("https://gateway.example/v1/blobs/check", {
      method: "OPTIONS",
      headers: {
        Origin: "https://demonrider0.github.io",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    }),
    fixture.env,
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /POST/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Authorization/);
});
