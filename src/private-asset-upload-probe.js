import { preparePrivateAssetUpload } from "./private-asset-pack.js";

const UPLOAD_REQUEST_ID = "OBR_ASSETS_UPLOAD_IMAGES";
const UPLOAD_RESPONSE_PREFIX = `${UPLOAD_REQUEST_ID}_RESPONSE_`;
const DEFAULT_TIMEOUT_MS = 7000;
const DIAGNOSTIC_FIELDS = [
  "url",
  "width",
  "height",
  "mime",
  "id",
  "assetId",
  "name",
  "images",
  "assets",
  "items",
];
const IDENTIFIER_FIELD_PATTERN = /(?:id|identifier|uuid|key|ref|hash|path|uri|url)$/i;
const activeMessageBuses = new WeakSet();

function isObject(value) {
  return Boolean(value && typeof value === "object");
}

function getJavascriptType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function decodeBase64Url(value, atobImplementation) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atobImplementation(padded);
}

export function getOwlbearOriginFromLocation(location, atobImplementation = globalThis.atob) {
  const encodedReference = new URLSearchParams(location?.search || "").get("obrref");
  if (!encodedReference || typeof atobImplementation !== "function") {
    throw new Error("A origem do Owlbear não está disponível para a sondagem.");
  }

  let decodedReference;
  try {
    decodedReference = decodeBase64Url(encodedReference, atobImplementation);
  } catch {
    throw new Error("A referência de origem do Owlbear é inválida.");
  }

  const separatorIndex = decodedReference.indexOf(" ");
  const origin = separatorIndex >= 0 ? decodedReference.slice(0, separatorIndex) : "";
  try {
    return new URL(origin).origin;
  } catch {
    throw new Error("A referência não contém uma origem válida do Owlbear.");
  }
}

export function isPrivateAssetUploadResponseMessage(event, owlbearOrigin, responseId) {
  return Boolean(
    event?.origin === owlbearOrigin &&
      typeof responseId === "string" &&
      responseId.startsWith(UPLOAD_RESPONSE_PREFIX) &&
      isObject(event?.data) &&
      event.data.id === responseId,
  );
}

function isImageContent(value) {
  return Boolean(
    isObject(value) &&
      typeof value.url === "string" &&
      typeof value.width === "number" &&
      typeof value.height === "number" &&
      typeof value.mime === "string",
  );
}

function inspectPayload(payload) {
  const keys = new Set();
  const fieldPaths = Object.fromEntries(DIAGNOSTIC_FIELDS.map((field) => [field, []]));
  const urls = [];
  const imageContents = [];
  const imageContentPaths = [];
  const assetReferences = [];
  const identifierCandidates = [];
  const fieldInventory = [];
  const arrayLengths = [];
  const visited = new WeakSet();

  function visit(value, path) {
    if (!isObject(value) || visited.has(value)) {
      return;
    }
    visited.add(value);

    if (isImageContent(value)) {
      imageContents.push(value);
      imageContentPaths.push(path);
    }
    if (Array.isArray(value)) {
      arrayLengths.push({ path, length: value.length });
    }

    for (const key of Object.keys(value)) {
      keys.add(key);
      const child = value[key];
      const childPath = path ? `${path}.${key}` : key;
      const fieldEntry = {
        path: childPath,
        key,
        javascriptType: getJavascriptType(child),
      };
      fieldInventory.push(fieldEntry);
      if (IDENTIFIER_FIELD_PATTERN.test(key)) {
        identifierCandidates.push(
          isObject(child) ? fieldEntry : { ...fieldEntry, value: child },
        );
      }
      if (Object.hasOwn(fieldPaths, key)) {
        fieldPaths[key].push(childPath);
      }
      if (typeof child === "string" && (/^https?:\/\//i.test(child) || key === "url")) {
        urls.push({ path: childPath, value: child });
      }
      if (typeof child === "string" && /^(?:assetId|assetName|id|name)$/i.test(key)) {
        assetReferences.push({ path: childPath, value: child });
      }
      visit(child, childPath);
    }
  }

  visit(payload, "payload");
  const directItemArray = [payload, payload?.items, payload?.images, payload?.assets].find(
    Array.isArray,
  );

  return {
    javascriptType: getJavascriptType(payload),
    foundAtAnyDepth: {
      ImageContent: imageContents.length > 0,
      ...Object.fromEntries(
        DIAGNOSTIC_FIELDS.map((field) => [field, fieldPaths[field].length > 0]),
      ),
    },
    fieldPaths,
    imageContentPaths,
    keys: [...keys],
    urls,
    imageContents,
    assetReferences,
    identifierCandidates,
    fieldInventory,
    arrayLengths,
    returnedItemCount: directItemArray?.length ?? (isImageContent(payload) ? 1 : 0),
  };
}

export function createPrivateAssetUploadResponseReport(responseId, payload) {
  return {
    responseMessageId: responseId,
    rawPayload: payload,
    ...inspectPayload(payload),
  };
}

function logPrivateAssetUploadResponseReport(report, logger) {
  const { rawPayload, ...summary } = report;

  logger.log(
    `[Cartas Duplas] Payload bruto de ${report.responseMessageId} (sem normalização):`,
    rawPayload,
  );
  logger.log("[Cartas Duplas] Resumo da resposta de upload:", summary);
}

export function reportPrivateAssetUploadResponse(responseId, payload, logger = console) {
  const report = createPrivateAssetUploadResponseReport(responseId, payload);
  logPrivateAssetUploadResponseReport(report, logger);
  return report;
}

function createSerializableDiagnosticSnapshot(value, path, visited) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : `[Number: ${String(value)}]`;
  }
  if (typeof value === "undefined") {
    return "[undefined]";
  }
  if (typeof value === "bigint") {
    return `[BigInt: ${value.toString()}]`;
  }
  if (typeof value === "symbol") {
    return `[Symbol: ${value.description || "sem descrição"}]`;
  }
  if (typeof value === "function") {
    return `[Function: ${value.name || "anônima"}]`;
  }
  if (!isObject(value)) {
    return String(value);
  }
  if (visited.has(value)) {
    return `[Circular -> ${visited.get(value)}]`;
  }
  visited.set(value, path);

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "[Date inválida]" : value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => {
      try {
        return createSerializableDiagnosticSnapshot(child, `${path}[${index}]`, visited);
      } catch (error) {
        return `[Falha ao representar: ${error?.message || String(error)}]`;
      }
    });
  }

  const snapshot = {};
  let propertyKeys;
  try {
    propertyKeys = Reflect.ownKeys(value);
  } catch (error) {
    return `[Falha ao listar propriedades: ${error?.message || String(error)}]`;
  }
  for (const propertyKey of propertyKeys) {
    const displayKey =
      typeof propertyKey === "symbol"
        ? `[Symbol: ${propertyKey.description || "sem descrição"}]`
        : propertyKey;
    try {
      snapshot[displayKey] = createSerializableDiagnosticSnapshot(
        value[propertyKey],
        `${path}.${displayKey}`,
        visited,
      );
    } catch (error) {
      snapshot[displayKey] = `[Falha ao representar: ${error?.message || String(error)}]`;
    }
  }
  return snapshot;
}

export function stringifyPrivateAssetUploadDiagnostic(value) {
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // A representação abaixo é usada somente para exibição e cópia do diagnóstico.
  }

  try {
    return JSON.stringify(
      createSerializableDiagnosticSnapshot(value, "payload", new WeakMap()),
      null,
      2,
    );
  } catch (error) {
    return `[Não foi possível representar o valor: ${error?.message || String(error)}]`;
  }
}

export function formatPrivateAssetUploadResponseReport(report) {
  if (!report || typeof report !== "object") {
    throw new Error("O relatório da sondagem não está disponível.");
  }

  const { rawPayload, ...summary } = report;
  const foundFields = Object.entries(report.foundAtAnyDepth || {})
    .map(([field, found]) => `${field}: ${found ? "sim" : "não"}`)
    .join("\n");

  return [
    "Cartas Duplas — diagnóstico temporário de uploadImages",
    "Resposta capturada: sim",
    `Mensagem: ${report.responseMessageId || "não informada"}`,
    `Tipo JavaScript do payload: ${report.javascriptType || typeof rawPayload}`,
    "",
    "CAMPOS PROCURADOS",
    foundFields || "Nenhum campo diagnóstico foi enumerado.",
    "",
    "CAMINHOS DOS CAMPOS",
    stringifyPrivateAssetUploadDiagnostic(report.fieldPaths || {}),
    "",
    "URLS ENCONTRADAS",
    stringifyPrivateAssetUploadDiagnostic(report.urls || []),
    "",
    "CANDIDATOS A IDS E REFERÊNCIAS",
    stringifyPrivateAssetUploadDiagnostic({
      assetReferences: report.assetReferences || [],
      identifierCandidates: report.identifierCandidates || [],
    }),
    "",
    "PAYLOAD BRUTO — REPRESENTAÇÃO PARA EXIBIÇÃO/CÓPIA",
    stringifyPrivateAssetUploadDiagnostic(rawPayload),
    "",
    "RESUMO COMPLETO",
    stringifyPrivateAssetUploadDiagnostic(summary),
  ].join("\n");
}

export async function probePrivateAssetUploadResponse(
  OBR,
  imageUpload,
  typeHint,
  options = {},
) {
  if (!OBR?.assets?.uploadImages || !imageUpload || Array.isArray(imageUpload)) {
    throw new Error("A sondagem exige exatamente um ImageUpload válido.");
  }

  const windowObject = options.windowObject || globalThis.window;
  const messageBus = options.messageBus || OBR.assets.messageBus;
  const owlbearOrigin =
    options.owlbearOrigin || getOwlbearOriginFromLocation(windowObject?.location);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logger = options.logger === undefined ? globalThis.console : options.logger;
  const onReport = options.onReport;
  if (
    !windowObject?.addEventListener ||
    !windowObject?.removeEventListener ||
    typeof messageBus?.send !== "function"
  ) {
    throw new Error("Os recursos internos necessários à sondagem não estão disponíveis.");
  }
  if (activeMessageBuses.has(messageBus)) {
    throw new Error("Já existe uma sondagem de upload em andamento neste painel.");
  }
  activeMessageBuses.add(messageBus);

  let expectedResponseId = null;
  let listenerInstalled = false;
  let timeoutId = null;
  let resolveResponse;
  let rejectResponse;
  const responsePromise = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  const removeListener = () => {
    if (listenerInstalled) {
      windowObject.removeEventListener("message", onMessage);
      listenerInstalled = false;
    }
  };
  const clearResponseTimeout = () => {
    if (timeoutId !== null) {
      windowObject.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  const onMessage = (event) => {
    if (!isPrivateAssetUploadResponseMessage(event, owlbearOrigin, expectedResponseId)) {
      return;
    }

    removeListener();
    clearResponseTimeout();
    const payload = event.data.data;
    try {
      const report = createPrivateAssetUploadResponseReport(event.data.id, payload);
      if (logger?.log) {
        logPrivateAssetUploadResponseReport(report, logger);
      }
      if (typeof onReport === "function") {
        onReport(report);
      }
    } catch (error) {
      rejectResponse(error);
      return;
    }
    resolveResponse(payload);
  };

  const originalSend = messageBus.send;
  let sendWasWrapped = false;
  try {
    windowObject.addEventListener("message", onMessage);
    listenerInstalled = true;
    timeoutId = windowObject.setTimeout(() => {
      removeListener();
      timeoutId = null;
      rejectResponse(
        new Error(`A resposta de ${UPLOAD_REQUEST_ID} não chegou em ${timeoutMs}ms.`),
      );
    }, timeoutMs);

    messageBus.send = function sendWithUploadNonceCapture(id, data, nonce) {
      if (id === UPLOAD_REQUEST_ID && expectedResponseId === null) {
        if (typeof nonce !== "string" || !nonce.startsWith("_")) {
          throw new Error("O nonce da sondagem de upload é inválido.");
        }
        expectedResponseId = `${id}_RESPONSE${nonce}`;
      }
      return originalSend.call(this, id, data, nonce);
    };
    sendWasWrapped = true;

    const uploadPromise = OBR.assets.uploadImages([imageUpload], typeHint);
    messageBus.send = originalSend;
    sendWasWrapped = false;

    if (!expectedResponseId) {
      throw new Error("A sondagem não identificou o nonce do upload.");
    }

    const [payload] = await Promise.all([responsePromise, uploadPromise]);
    return payload;
  } finally {
    if (sendWasWrapped) {
      messageBus.send = originalSend;
    }
    removeListener();
    clearResponseTimeout();
    activeMessageBuses.delete(messageBus);
  }
}

export function selectSingleImageForUploadProbe(
  documentObject = globalThis.document,
  accept = "image/*",
) {
  if (!documentObject?.createElement) {
    return Promise.reject(
      new Error("O seletor de arquivo não está disponível neste contexto."),
    );
  }

  return new Promise((resolve, reject) => {
    const input = documentObject.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = false;
    input.hidden = true;

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      input.remove();
    };
    const onChange = () => {
      const files = [...(input.files || [])];
      cleanup();
      if (files.length !== 1) {
        reject(new Error("Selecione exatamente uma imagem pequena para a sondagem."));
        return;
      }
      resolve(files[0]);
    };
    const onCancel = () => {
      cleanup();
      reject(new Error("A seleção da imagem da sondagem foi cancelada."));
    };

    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    (documentObject.body || documentObject.documentElement).append(input);
    try {
      input.click();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function runPrivateAssetUploadResponseConsoleProbe(
  OBR,
  buildImageUpload,
  options = {},
) {
  if (typeof buildImageUpload !== "function") {
    throw new Error("O construtor de ImageUpload do Owlbear não está disponível.");
  }

  const {
    file: providedFile,
    documentObject = globalThis.document,
    typeHint = "PROP",
    onFileSelected,
    ...probeOptions
  } = options;
  const file = providedFile || (await selectSingleImageForUploadProbe(documentObject));
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) {
    throw new Error("A sondagem exige exatamente um arquivo de imagem não vazio.");
  }
  if (typeof file.type !== "string" || !file.type.startsWith("image/")) {
    throw new Error("O arquivo escolhido não foi reconhecido como imagem.");
  }
  if (typeof onFileSelected === "function") {
    onFileSelected(file);
  }

  const builder = buildImageUpload(file);
  if (!builder?.name || !builder?.build) {
    throw new Error("Não foi possível construir o ImageUpload da sondagem.");
  }
  builder.name(`[Sonda Cartas Duplas] ${file.name || "imagem"}`);
  if (typeof builder.description === "function") {
    builder.description("Upload diagnóstico único de OBR_ASSETS_UPLOAD_IMAGES");
  }
  const imageUpload = builder.build();

  return probePrivateAssetUploadResponse(OBR, imageUpload, typeHint, probeOptions);
}

export async function runPrivateAssetUploadResponseDevTest(
  OBR,
  buildImageUpload,
  { file, assetId, asset },
  options = {},
) {
  const imageUpload = await preparePrivateAssetUpload(
    buildImageUpload,
    file,
    assetId,
    asset,
  );
  return probePrivateAssetUploadResponse(OBR, imageUpload, asset.typeHint, options);
}
