import { createGridData, createImageData } from "./card-data.js";
import { selectSingleImageForUploadProbe } from "./private-asset-upload-probe.js";

const DATA_URL_PROBE_NAME = "[Sonda Cartas Duplas] data URL";
const DATA_URL_PROBE_ACCEPT = "image/png,image/jpeg,image/webp";
const DATA_URL_PROBE_GRID_WIDTH = 2;
const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function asBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Os bytes da imagem não estão em um formato reconhecido.");
}

function hasBytes(bytes, expected, offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function detectDataUrlProbeMime(bytesValue, file = {}) {
  const bytes = asBytes(bytesValue);
  if (bytes.length >= 8 && hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytes.length >= 3 && hasBytes(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }

  const declaredMime = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  if (SUPPORTED_MIME_TYPES.has(declaredMime)) {
    return declaredMime;
  }

  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  throw new Error("Escolha uma imagem PNG, JPEG ou WebP válida para a sonda.");
}

export function bytesToDataUrl(
  bytesValue,
  mime,
  btoaImplementation = globalThis.btoa,
) {
  const bytes = asBytes(bytesValue);
  if (!bytes.length) {
    throw new Error("A imagem escolhida está vazia.");
  }
  if (!SUPPORTED_MIME_TYPES.has(mime)) {
    throw new Error(`MIME não suportado pela sonda: ${mime || "não informado"}.`);
  }
  if (typeof btoaImplementation !== "function") {
    throw new Error("O navegador não disponibilizou a conversão base64 necessária.");
  }

  const chunks = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return `data:${mime};base64,${btoaImplementation(chunks.join(""))}`;
}

export function readDataUrlImageDimensions(
  dataUrl,
  ImageImplementation = globalThis.Image,
) {
  if (typeof ImageImplementation !== "function") {
    return Promise.reject(
      new Error("O navegador não disponibilizou o decodificador de imagem necessário."),
    );
  }

  return new Promise((resolve, reject) => {
    const image = new ImageImplementation();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      image.onload = null;
      image.onerror = null;
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        reject(new Error("A imagem foi lida, mas não apresentou dimensões válidas."));
        return;
      }
      resolve({ width, height });
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      reject(new Error("O navegador não conseguiu decodificar a imagem escolhida."));
    };
    image.src = dataUrl;
  });
}

export async function prepareDataUrlProbeImage(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Selecione exatamente um arquivo de imagem local.");
  }

  const buffer = await file.arrayBuffer();
  const bytes = asBytes(buffer);
  const mime = detectDataUrlProbeMime(bytes, file);
  const dataUrl = bytesToDataUrl(bytes, mime, options.btoaImplementation);
  const readDimensions = options.readDimensions || readDataUrlImageDimensions;
  const { width, height } = await readDimensions(dataUrl, options.ImageImplementation);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("A imagem escolhida não possui dimensões positivas válidas.");
  }

  return {
    dataUrl,
    height,
    mime,
    originalByteLength: bytes.byteLength,
    width,
  };
}

function redactDataUrls(value) {
  return String(value).replace(
    /data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/_=-]*/gi,
    (dataUrl) => {
      const prefix = dataUrl.slice(0, dataUrl.indexOf(",") + 1);
      return `${prefix}...[base64 omitida; comprimento ${dataUrl.length}]`;
    },
  );
}

function getErrorDetails(error) {
  return {
    message: redactDataUrls(error?.message || String(error)),
    name: error?.name || "Error",
    stack: typeof error?.stack === "string" ? redactDataUrls(error.stack) : null,
  };
}

function createDataUrlSummary(prepared) {
  return {
    dataUrlLength: prepared.dataUrl.length,
    dataUrlPrefix: `data:${prepared.mime};base64,...`,
    height: prepared.height,
    mime: prepared.mime,
    originalByteLength: prepared.originalByteLength,
    width: prepared.width,
  };
}

function createDataUrlProbeReport(prepared, item, addItemsCompleted, error = null) {
  return {
    probe: "ImageContent.url com data URL",
    success: addItemsCompleted && !error,
    addItemsCompleted,
    itemId: item?.id || null,
    itemName: item?.name || DATA_URL_PROBE_NAME,
    ...createDataUrlSummary(prepared),
    error: error ? getErrorDetails(error) : null,
  };
}

async function getDefaultProbePosition(OBR) {
  const [width, height] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  return OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 });
}

export async function runDataUrlImageProbe(OBR, buildImage, options = {}) {
  if (!OBR?.scene?.items?.addItems || typeof buildImage !== "function") {
    throw new Error("A API de itens de imagem do Owlbear não está disponível.");
  }

  const file =
    options.file ||
    (await selectSingleImageForUploadProbe(
      options.documentObject || globalThis.document,
      DATA_URL_PROBE_ACCEPT,
    ));
  if (typeof options.onFileSelected === "function") {
    options.onFileSelected(file);
  }

  const prepared = await prepareDataUrlProbeImage(file, options);
  if (typeof options.onPrepared === "function") {
    options.onPrepared(createDataUrlSummary(prepared));
  }

  const getPosition = options.getPosition || (() => getDefaultProbePosition(OBR));
  const position = await getPosition();
  const imageContent = createImageData({
    height: prepared.height,
    mime: prepared.mime,
    url: prepared.dataUrl,
    width: prepared.width,
  });
  const item = buildImage(
    imageContent,
    createGridData(imageContent, DATA_URL_PROBE_GRID_WIDTH),
  )
    .name(DATA_URL_PROBE_NAME)
    .description("Experimento diagnóstico temporário de ImageContent.url com data URL")
    .layer("PROP")
    .position(position)
    .build();

  try {
    await OBR.scene.items.addItems([item]);
  } catch (error) {
    const report = createDataUrlProbeReport(prepared, item, false, error);
    const failure = new Error(
      `O Owlbear rejeitou o Image item da sonda: ${report.error.message}`,
      { cause: error },
    );
    failure.name = "DataUrlImageProbeError";
    failure.diagnosticReport = report;
    if (failure.cause === undefined) {
      failure.cause = error;
    }
    throw failure;
  }

  return createDataUrlProbeReport(prepared, item, true);
}

export function formatDataUrlImageProbeReport(report) {
  if (!report || typeof report !== "object") {
    throw new Error("O relatório da sonda de data URL não está disponível.");
  }

  const lines = [
    "Cartas Duplas — diagnóstico temporário de data URL",
    `Resultado: ${report.success ? "item criado" : "falha"}`,
    `addItems terminou sem erro: ${report.addItemsCompleted ? "sim" : "não"}`,
    `itemId: ${report.itemId || "não disponível"}`,
    `itemName: ${report.itemName || DATA_URL_PROBE_NAME}`,
    `mime: ${report.mime || "não disponível"}`,
    `width: ${report.width ?? "não disponível"}`,
    `height: ${report.height ?? "não disponível"}`,
    `originalByteLength: ${report.originalByteLength ?? "não disponível"}`,
    `dataUrlPrefix: ${report.dataUrlPrefix || "não disponível"}`,
    `dataUrlLength: ${report.dataUrlLength ?? "não disponível"}`,
  ];

  if (report.error) {
    lines.push(
      "",
      "ERRO",
      `name: ${report.error.name || "Error"}`,
      `message: ${report.error.message || "não disponível"}`,
      "stack:",
      report.error.stack || "não disponível",
      "",
      "A sonda parou após a rejeição. Nenhuma alternativa foi tentada.",
    );
  } else {
    lines.push(
      "",
      "VERIFICAÇÃO MANUAL",
      "1. Verifique se a imagem apareceu corretamente na cena.",
      "2. Recarregue completamente a página do Owlbear.",
      "3. Verifique se o mesmo item continua aparecendo com a imagem correta.",
    );
  }

  return lines.join("\n");
}
