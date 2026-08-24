const PROBE_MIME_TYPES = Object.freeze(["image/webp", "image/jpeg"]);
const SHA256_PATTERN = /^sha256:([0-9a-f]{64})$/;
const MAX_PROBE_ASSET_SIZE = 2_000_000;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getErrorMessage(error, fallback = "Falha desconhecida.") {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : fallback;
}

function normalizeSha256(value, label = "blobSha256") {
  const normalized = String(value || "").trim().toLowerCase();
  const match = normalized.match(SHA256_PATTERN);
  if (!match) {
    throw new Error(`${label} precisa usar o formato sha256:<64 caracteres hexadecimais>.`);
  }
  return { value: normalized, hex: match[1] };
}

function normalizeMime(value) {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function assertProbeMime(value, label = "Asset") {
  const mime = normalizeMime(value);
  if (!PROBE_MIME_TYPES.includes(mime)) {
    throw new Error(
      `${label} usa MIME inesperado: ${mime || "não informado"}. A sonda aceita apenas image/webp e image/jpeg.`,
    );
  }
  return mime;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} precisa ser um inteiro positivo.`);
  }
  return value;
}

function normalizeGatewayUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Informe uma URL válida para o gateway HTTPS.");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("O gateway precisa usar HTTPS e não pode conter credenciais na URL.");
  }
  if (url.search || url.hash || !url.hostname) {
    throw new Error("A URL do gateway não pode conter query string ou fragmento.");
  }

  return url.origin + url.pathname.replace(/\/+$/, "");
}

function getCrypto(cryptoImplementation) {
  const implementation = cryptoImplementation || globalThis.crypto;
  if (!implementation?.subtle?.digest) {
    throw new Error("Este ambiente não oferece SHA-256 pela Web Crypto API.");
  }
  return implementation;
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new TypeError("O cálculo de SHA-256 exige bytes em ArrayBuffer.");
}

export async function calculateBlobSha256(bytes, cryptoImplementation) {
  const digest = await getCrypto(cryptoImplementation).subtle.digest(
    "SHA-256",
    toArrayBuffer(bytes),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function getCandidateSize(asset, file) {
  return Number.isFinite(file?.size) && file.size > 0 ? file.size : asset.size;
}

function findSmallestCandidate(selection, mime) {
  return Object.entries(selection.pack.assets)
    .flatMap(([assetId, asset]) => {
      const file = selection.assetFiles.get(assetId);
      return file && normalizeMime(asset.mime) === mime ? [{ assetId, asset, file }] : [];
    })
    .sort(
      (left, right) =>
        getCandidateSize(left.asset, left.file) - getCandidateSize(right.asset, right.file) ||
        left.assetId.localeCompare(right.assetId),
    )[0];
}

async function prepareCandidate(candidate, kind, cryptoImplementation) {
  const { assetId, asset, file } = candidate;
  const label = `${kind} ${assetId}`;
  const mime = assertProbeMime(asset.mime, label);
  const width = positiveInteger(asset.width, `A largura de ${label}`);
  const height = positiveInteger(asset.height, `A altura de ${label}`);
  const expectedSize = positiveInteger(asset.size, `O tamanho de ${label}`);
  if (expectedSize > MAX_PROBE_ASSET_SIZE) {
    throw new Error(
      `${label} possui ${expectedSize} bytes; a POC aceita no máximo ${MAX_PROBE_ASSET_SIZE} bytes por arquivo.`,
    );
  }

  const browserMime = normalizeMime(file.type);
  if (browserMime && browserMime !== mime) {
    throw new Error(
      `${label} possui MIME divergente: manifesto ${mime}, navegador ${browserMime}.`,
    );
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== expectedSize) {
    throw new Error(
      `${label} possui ${bytes.byteLength} bytes, mas o manifesto declara ${expectedSize}.`,
    );
  }

  const expectedHash = normalizeSha256(asset.blobSha256, `O blobSha256 de ${label}`).value;
  const calculatedHash = await calculateBlobSha256(bytes, cryptoImplementation);
  if (calculatedHash !== expectedHash) {
    throw new Error(
      `Integridade inválida em ${label}: calculado ${calculatedHash}, esperado ${expectedHash}.`,
    );
  }

  return {
    kind,
    assetId,
    blobSha256: expectedHash,
    mime,
    width,
    height,
    originalByteLength: bytes.byteLength,
    bytes,
  };
}

export async function selectPrivateAssetStorageProbeAssets(
  selection,
  options = {},
) {
  if (!selection?.pack?.assets || !(selection.assetFiles instanceof Map)) {
    throw new Error("Selecione novamente o Runtime Private Asset Pack antes da sonda HTTPS.");
  }

  const webp = findSmallestCandidate(selection, "image/webp");
  const jpeg = findSmallestCandidate(selection, "image/jpeg");
  if (!webp || !jpeg) {
    throw new Error(
      "O pack selecionado precisa conter pelo menos um WebP e um JPEG com arquivo disponível.",
    );
  }

  return Promise.all([
    prepareCandidate(webp, "WebP", options.crypto),
    prepareCandidate(jpeg, "JPEG", options.crypto),
  ]);
}

async function readJsonResponse(response, stage) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : `HTTP ${response.status}`;
    throw new Error(`${stage}: ${message}.`);
  }
  if (!isRecord(payload)) {
    throw new Error(`${stage}: o gateway retornou JSON inválido.`);
  }
  return payload;
}

function assertResolvedUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("O gateway retornou uma URL GET inválida.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("O gateway retornou uma URL GET que não usa HTTPS seguro.");
  }
  return url.href;
}

function validateCheckResult(result, descriptor) {
  if (!isRecord(result) || result.blobSha256 !== descriptor.blobSha256) {
    throw new Error(`A consulta do gateway não confirmou ${descriptor.blobSha256}.`);
  }
  if (typeof result.exists !== "boolean") {
    throw new Error(`A consulta do gateway não informou se ${descriptor.blobSha256} existe.`);
  }
  return {
    blobSha256: result.blobSha256,
    exists: result.exists,
    url: typeof result.url === "string" && result.url ? assertResolvedUrl(result.url) : null,
  };
}

export function createPrivateAssetStorageClient(options = {}) {
  const gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
  const uploadToken = String(options.uploadToken || "");
  const fetchImplementation = options.fetch || globalThis.fetch;
  if (uploadToken.length < 32) {
    throw new Error("Informe a capability temporária de upload fornecida no deploy da POC.");
  }
  if (typeof fetchImplementation !== "function") {
    throw new Error("Este ambiente não oferece fetch para acessar o gateway.");
  }

  const authorizedHeaders = {
    Authorization: `Bearer ${uploadToken}`,
  };

  return {
    gatewayUrl,
    gatewayHostname: new URL(gatewayUrl).hostname,

    async checkBlobs(descriptors) {
      const response = await fetchImplementation(`${gatewayUrl}/v1/blobs/check`, {
        method: "POST",
        credentials: "omit",
        headers: {
          ...authorizedHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          blobs: descriptors.map((descriptor) => ({
            blobSha256: normalizeSha256(descriptor.blobSha256).value,
            size: positiveInteger(descriptor.originalByteLength, "O tamanho do blob"),
            mime: assertProbeMime(descriptor.mime),
          })),
        }),
      });
      const payload = await readJsonResponse(response, "Consulta de blobs");
      if (!Array.isArray(payload.results) || payload.results.length !== descriptors.length) {
        throw new Error("Consulta de blobs: o gateway retornou uma lista incompleta.");
      }
      return payload.results.map((result, index) =>
        validateCheckResult(result, descriptors[index]),
      );
    },

    async uploadBlob(descriptor) {
      const hash = normalizeSha256(descriptor.blobSha256).hex;
      const response = await fetchImplementation(`${gatewayUrl}/v1/blobs/${hash}`, {
        method: "PUT",
        credentials: "omit",
        headers: {
          ...authorizedHeaders,
          "Content-Type": assertProbeMime(descriptor.mime),
          "X-Blob-SHA256": descriptor.blobSha256,
          "X-Blob-Size": String(descriptor.originalByteLength),
        },
        body: descriptor.bytes,
      });
      const payload = await readJsonResponse(response, `Upload de ${descriptor.blobSha256}`);
      if (payload.blobSha256 !== descriptor.blobSha256 || payload.stored !== true) {
        throw new Error(`Upload de ${descriptor.blobSha256}: confirmação inválida do gateway.`);
      }
      return {
        stored: true,
        alreadyExisted: payload.alreadyExisted === true,
        url: assertResolvedUrl(payload.url),
      };
    },

    async verifyGet(descriptor, rawUrl, cryptoImplementation) {
      const url = assertResolvedUrl(rawUrl);
      let response;
      try {
        response = await fetchImplementation(url, {
          method: "GET",
          credentials: "omit",
        });
      } catch (error) {
        throw new Error(
          `GET/CORS de ${descriptor.blobSha256} falhou: ${getErrorMessage(error)}`,
        );
      }
      if (!response.ok) {
        throw new Error(`GET de ${descriptor.blobSha256} retornou HTTP ${response.status}.`);
      }

      const receivedMime = normalizeMime(response.headers.get("Content-Type"));
      if (receivedMime !== descriptor.mime) {
        throw new Error(
          `GET de ${descriptor.blobSha256} retornou Content-Type ${receivedMime || "ausente"}; esperado ${descriptor.mime}.`,
        );
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== descriptor.originalByteLength) {
        throw new Error(
          `GET de ${descriptor.blobSha256} retornou ${bytes.byteLength} bytes; esperado ${descriptor.originalByteLength}.`,
        );
      }
      const calculatedHash = await calculateBlobSha256(bytes, cryptoImplementation);
      if (calculatedHash !== descriptor.blobSha256) {
        throw new Error(
          `GET de ${descriptor.blobSha256} falhou na verificação SHA-256: recebido ${calculatedHash}.`,
        );
      }

      const contentLengthHeader = response.headers.get("Content-Length");
      const contentLength = contentLengthHeader == null ? null : Number(contentLengthHeader);
      return {
        status: response.status,
        cors: "sucesso (resposta e bytes legíveis no navegador)",
        contentType: receivedMime,
        contentLength: Number.isFinite(contentLength) ? contentLength : null,
        verifiedBlobSha256: calculatedHash,
      };
    },
  };
}

export function buildPrivateAssetStorageBinding(descriptor, rawUrl) {
  return {
    assetId: descriptor.assetId,
    blobSha256: normalizeSha256(descriptor.blobSha256).value,
    url: assertResolvedUrl(rawUrl),
    width: positiveInteger(descriptor.width, "A largura do binding"),
    height: positiveInteger(descriptor.height, "A altura do binding"),
    mime: assertProbeMime(descriptor.mime),
  };
}

function createAssetReport(descriptor) {
  return {
    kind: descriptor.kind,
    assetId: descriptor.assetId,
    blobSha256: descriptor.blobSha256,
    mime: descriptor.mime,
    width: descriptor.width,
    height: descriptor.height,
    originalByteLength: descriptor.originalByteLength,
    alreadyExisted: null,
    uploadPerformed: false,
    uploadCompleted: false,
    urlResolved: false,
    urlHostname: null,
    getUrl: null,
    cors: "não verificado",
    httpGetStatus: null,
    receivedContentType: null,
    receivedContentLength: null,
    addItems: "não executado",
    itemId: null,
  };
}

function attachDiagnosticReport(error, report) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  report.completedAt = new Date().toISOString();
  report.success = false;
  report.error = {
    name: normalized.name || "Error",
    message: getErrorMessage(normalized),
  };
  normalized.diagnosticReport = report;
  return normalized;
}

export async function runPrivateAssetStorageProbe(options = {}) {
  const report = {
    probe: "private-asset-storage-https",
    startedAt: new Date().toISOString(),
    completedAt: null,
    success: false,
    gatewayHostname: null,
    assets: [],
    doubleSidedCard: {
      addItems: "não executado",
      itemId: null,
    },
    error: null,
  };

  try {
    options.onProgress?.({ stage: "selecting" });
    const descriptors = await selectPrivateAssetStorageProbeAssets(options.selection, {
      crypto: options.crypto,
    });
    report.assets = descriptors.map(createAssetReport);

    const client = createPrivateAssetStorageClient({
      gatewayUrl: options.gatewayUrl,
      uploadToken: options.uploadToken,
      fetch: options.fetch,
    });
    report.gatewayHostname = client.gatewayHostname;

    options.onProgress?.({ stage: "checking", total: descriptors.length });
    const initial = await client.checkBlobs(descriptors);
    for (let index = 0; index < descriptors.length; index += 1) {
      report.assets[index].alreadyExisted = initial[index].exists;
      if (!initial[index].exists) {
        options.onProgress?.({
          stage: "uploading",
          kind: descriptors[index].kind,
          index: index + 1,
          total: descriptors.length,
        });
        report.assets[index].uploadPerformed = true;
        await client.uploadBlob(descriptors[index]);
        report.assets[index].uploadCompleted = true;
      }
    }

    options.onProgress?.({ stage: "confirming", total: descriptors.length });
    const confirmed = await client.checkBlobs(descriptors);
    const assets = [];
    for (let index = 0; index < descriptors.length; index += 1) {
      const descriptor = descriptors[index];
      if (!confirmed[index].exists || !confirmed[index].url) {
        throw new Error(`O gateway não confirmou o blob ${descriptor.blobSha256} após o upload.`);
      }

      const assetReport = report.assets[index];
      assetReport.urlResolved = true;
      assetReport.getUrl = confirmed[index].url;
      assetReport.urlHostname = new URL(confirmed[index].url).hostname;
      options.onProgress?.({
        stage: "verifying-get",
        kind: descriptor.kind,
        index: index + 1,
        total: descriptors.length,
      });
      const getResult = await client.verifyGet(
        descriptor,
        confirmed[index].url,
        options.crypto,
      );
      assetReport.cors = getResult.cors;
      assetReport.httpGetStatus = getResult.status;
      assetReport.receivedContentType = getResult.contentType;
      assetReport.receivedContentLength = getResult.contentLength;

      const binding = buildPrivateAssetStorageBinding(descriptor, confirmed[index].url);
      assets.push({
        assetId: descriptor.assetId,
        blobSha256: descriptor.blobSha256,
        imageContent: {
          width: binding.width,
          height: binding.height,
          mime: binding.mime,
          url: binding.url,
        },
        binding,
      });
    }

    report.completedAt = new Date().toISOString();
    return { assets, report };
  } catch (error) {
    throw attachDiagnosticReport(error, report);
  }
}

function yesNo(value) {
  return value == null ? "não verificado" : value ? "sim" : "não";
}

function valueOrPending(value) {
  return value == null || value === "" ? "não verificado" : String(value);
}

export function formatPrivateAssetStorageProbeReport(report) {
  const lines = [
    "Diagnóstico temporário — armazenamento HTTPS",
    `início: ${valueOrPending(report?.startedAt)}`,
    `fim: ${valueOrPending(report?.completedAt)}`,
    `gateway hostname: ${valueOrPending(report?.gatewayHostname)}`,
    `resultado geral: ${report?.success ? "sucesso" : report?.error ? "falha" : "incompleto"}`,
  ];

  for (const asset of report?.assets || []) {
    lines.push(
      "",
      `Asset ${asset.kind}`,
      `assetId: ${valueOrPending(asset.assetId)}`,
      `blobSha256: ${valueOrPending(asset.blobSha256)}`,
      `mime: ${valueOrPending(asset.mime)}`,
      `width: ${valueOrPending(asset.width)}`,
      `height: ${valueOrPending(asset.height)}`,
      `originalByteLength: ${valueOrPending(asset.originalByteLength)}`,
      `já existia no storage: ${yesNo(asset.alreadyExisted)}`,
      `upload realizado: ${yesNo(asset.uploadPerformed)}`,
      `upload concluído: ${yesNo(asset.uploadCompleted)}`,
      `URL resolvida: ${yesNo(asset.urlResolved)}`,
      `hostname da URL: ${valueOrPending(asset.urlHostname)}`,
      `URL GET (capability de acesso ao asset): ${valueOrPending(asset.getUrl)}`,
      `CORS: ${valueOrPending(asset.cors)}`,
      `HTTP GET: ${valueOrPending(asset.httpGetStatus)}`,
      `Content-Type recebido: ${valueOrPending(asset.receivedContentType)}`,
      `Content-Length recebido: ${valueOrPending(asset.receivedContentLength)}`,
      `addItems: ${valueOrPending(asset.addItems)}`,
      `itemId: ${valueOrPending(asset.itemId)}`,
    );
  }

  lines.push(
    "",
    "Carta dupla de diagnóstico",
    `addItems: ${valueOrPending(report?.doubleSidedCard?.addItems)}`,
    `itemId: ${valueOrPending(report?.doubleSidedCard?.itemId)}`,
  );
  if (report?.error) {
    lines.push(
      "",
      `erro: ${valueOrPending(report.error.name)}: ${valueOrPending(report.error.message)}`,
    );
  }
  lines.push(
    "",
    "O relatório não contém a capability de upload nem credenciais Cloudflare/R2.",
    "A URL GET contém uma capability de leitura necessária para os jogadores carregarem o asset.",
  );
  return lines.join("\n");
}
