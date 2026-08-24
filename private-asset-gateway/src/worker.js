const ALLOWED_MIME_TYPES = new Set(["image/webp", "image/jpeg"]);
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const MAX_BLOB_BYTES = 2_000_000;
const OBJECT_PREFIX = "poc-blobs/";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers":
      "Content-Type, Content-Length, ETag, X-Content-SHA256",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function errorResponse(error, status = 400) {
  return jsonResponse({ ok: false, error }, status);
}

function normalizeMime(value) {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function parseBlobSha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const match = normalized.match(/^sha256:([0-9a-f]{64})$/);
  return match ? { value: normalized, hex: match[1] } : null;
}

function objectKey(hashHex) {
  return `${OBJECT_PREFIX}${hashHex}`;
}

function validSecret(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,}$/.test(value);
}

function stringsEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left || ""));
  const rightBytes = new TextEncoder().encode(String(right || ""));
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

function isAuthorized(request, env) {
  if (!validSecret(env.POC_UPLOAD_TOKEN)) {
    return false;
  }
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") && stringsEqual(header.slice(7), env.POC_UPLOAD_TOKEN);
}

function assertConfigured(env) {
  if (!env.PRIVATE_ASSETS || !validSecret(env.POC_UPLOAD_TOKEN) || !validSecret(env.POC_READ_CAPABILITY)) {
    throw new Error("Gateway não configurado: binding R2 ou secrets obrigatórios ausentes");
  }
}

function stableUrl(request, env, hashHex) {
  return `${new URL(request.url).origin}/i/${encodeURIComponent(env.POC_READ_CAPABILITY)}/${hashHex}`;
}

function descriptorFromInput(value) {
  const hash = parseBlobSha256(value?.blobSha256);
  const mime = normalizeMime(value?.mime);
  const size = Number(value?.size);
  if (!hash || !ALLOWED_MIME_TYPES.has(mime) || !Number.isInteger(size) || size <= 0 || size > MAX_BLOB_BYTES) {
    return null;
  }
  return { blobSha256: hash.value, hashHex: hash.hex, mime, size };
}

function metadataMatches(object, descriptor) {
  return Boolean(
    object &&
      object.size === descriptor.size &&
      normalizeMime(object.httpMetadata?.contentType) === descriptor.mime &&
      object.customMetadata?.blobSha256 === descriptor.blobSha256,
  );
}

async function handleCheck(request, env) {
  if (!isAuthorized(request, env)) {
    return errorResponse("Autorização de upload inválida", 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("JSON de consulta inválido");
  }
  if (!Array.isArray(payload?.blobs) || payload.blobs.length < 1 || payload.blobs.length > 2) {
    return errorResponse("A POC aceita a consulta de um ou dois blobs por vez");
  }

  const descriptors = payload.blobs.map(descriptorFromInput);
  if (descriptors.some((descriptor) => !descriptor)) {
    return errorResponse("Descriptor inválido; use SHA-256, tamanho válido e image/webp ou image/jpeg");
  }

  const results = [];
  for (const descriptor of descriptors) {
    const object = await env.PRIVATE_ASSETS.head(objectKey(descriptor.hashHex));
    if (object && !metadataMatches(object, descriptor)) {
      return errorResponse("Objeto existente possui metadata incompatível", 409);
    }
    results.push({
      blobSha256: descriptor.blobSha256,
      exists: Boolean(object),
      url: object ? stableUrl(request, env, descriptor.hashHex) : null,
    });
  }
  return jsonResponse({ ok: true, results });
}

function hexToArrayBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hasExpectedImageSignature(bytes, mime) {
  const view = new Uint8Array(bytes);
  if (mime === "image/jpeg") {
    return view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff;
  }
  if (mime === "image/webp") {
    return (
      view.length >= 12 &&
      String.fromCharCode(...view.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...view.slice(8, 12)) === "WEBP"
    );
  }
  return false;
}

async function handleUpload(request, env, hashHex) {
  if (!isAuthorized(request, env)) {
    return errorResponse("Autorização de upload inválida", 401);
  }
  if (!SHA256_HEX_PATTERN.test(hashHex)) {
    return errorResponse("SHA-256 inválido");
  }

  const declaredHash = parseBlobSha256(request.headers.get("X-Blob-SHA256"));
  const mime = normalizeMime(request.headers.get("Content-Type"));
  const size = Number(request.headers.get("X-Blob-Size"));
  if (
    !declaredHash ||
    declaredHash.hex !== hashHex ||
    !ALLOWED_MIME_TYPES.has(mime) ||
    !Number.isInteger(size) ||
    size <= 0 ||
    size > MAX_BLOB_BYTES
  ) {
    return errorResponse("Headers de integridade, tamanho ou MIME inválidos");
  }

  const descriptor = {
    blobSha256: declaredHash.value,
    hashHex,
    mime,
    size,
  };
  const key = objectKey(hashHex);
  const existing = await env.PRIVATE_ASSETS.head(key);
  if (existing) {
    if (!metadataMatches(existing, descriptor)) {
      return errorResponse("Objeto existente possui metadata incompatível", 409);
    }
    return jsonResponse({
      ok: true,
      stored: true,
      alreadyExisted: true,
      blobSha256: descriptor.blobSha256,
      url: stableUrl(request, env, hashHex),
    });
  }

  const contentLengthHeader = request.headers.get("Content-Length");
  const contentLength = contentLengthHeader == null ? null : Number(contentLengthHeader);
  if (contentLength != null && Number.isFinite(contentLength) && contentLength !== size) {
    return errorResponse("Content-Length diferente do tamanho declarado");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== size) {
    return errorResponse("Corpo do upload diferente do tamanho declarado");
  }
  if (!hasExpectedImageSignature(bytes, mime)) {
    return errorResponse("Os bytes não correspondem ao MIME de imagem declarado", 415);
  }
  const calculatedHash = await sha256Hex(bytes);
  if (calculatedHash !== hashHex) {
    return errorResponse("SHA-256 calculado não corresponde ao blob declarado", 409);
  }

  const stored = await env.PRIVATE_ASSETS.put(key, bytes, {
    sha256: hexToArrayBuffer(hashHex),
    httpMetadata: {
      contentType: mime,
      cacheControl: IMMUTABLE_CACHE,
    },
    customMetadata: {
      blobSha256: descriptor.blobSha256,
    },
  });
  if (!stored || !metadataMatches(stored, descriptor)) {
    return errorResponse("O R2 não confirmou o objeto armazenado", 502);
  }

  return jsonResponse({
    ok: true,
    stored: true,
    alreadyExisted: false,
    blobSha256: descriptor.blobSha256,
    url: stableUrl(request, env, hashHex),
  }, 201);
}

function imageHeaders(object, hashHex) {
  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", normalizeMime(object.httpMetadata?.contentType));
  headers.set("Content-Length", String(object.size));
  headers.set("Cache-Control", IMMUTABLE_CACHE);
  headers.set("X-Content-SHA256", `sha256:${hashHex}`);
  if (object.httpEtag) {
    headers.set("ETag", object.httpEtag);
  }
  return headers;
}

async function handleGet(request, env, capability, hashHex) {
  if (
    !validSecret(env.POC_READ_CAPABILITY) ||
    !stringsEqual(capability, env.POC_READ_CAPABILITY) ||
    !SHA256_HEX_PATTERN.test(hashHex)
  ) {
    return errorResponse("Asset não encontrado", 404);
  }

  const key = objectKey(hashHex);
  const object =
    request.method === "HEAD"
      ? await env.PRIVATE_ASSETS.head(key)
      : await env.PRIVATE_ASSETS.get(key);
  if (!object || !ALLOWED_MIME_TYPES.has(normalizeMime(object.httpMetadata?.contentType))) {
    return errorResponse("Asset não encontrado", 404);
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers: imageHeaders(object, hashHex),
  });
}

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(),
        "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, X-Blob-SHA256, X-Blob-Size",
        "Access-Control-Max-Age": "7200",
      },
    });
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/v1/health") {
    return jsonResponse({
      ok: true,
      storage: "cloudflare-r2",
      configured: {
        bucket: Boolean(env.PRIVATE_ASSETS),
        uploadAuthorization: validSecret(env.POC_UPLOAD_TOKEN),
        readCapability: validSecret(env.POC_READ_CAPABILITY),
      },
    });
  }
  try {
    assertConfigured(env);
  } catch (error) {
    return errorResponse(error.message, 503);
  }
  if (request.method === "POST" && url.pathname === "/v1/blobs/check") {
    return handleCheck(request, env);
  }

  const uploadMatch = url.pathname.match(/^\/v1\/blobs\/([0-9a-f]{64})$/);
  if (request.method === "PUT" && uploadMatch) {
    return handleUpload(request, env, uploadMatch[1]);
  }

  const getMatch = url.pathname.match(/^\/i\/([^/]+)\/([0-9a-f]{64})$/);
  if ((request.method === "GET" || request.method === "HEAD") && getMatch) {
    return handleGet(request, env, decodeURIComponent(getMatch[1]), getMatch[2]);
  }

  return errorResponse("Rota não encontrada", 404);
}

export function createPrivateAssetGateway() {
  return { fetch: handleRequest };
}

export default createPrivateAssetGateway();
