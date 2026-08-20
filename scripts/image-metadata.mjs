import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);

function invalidImage(filePath, detail) {
  return new Error(`Imagem inválida ou ilegível em ${filePath}: ${detail}.`);
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readPngMetadata(bytes, filePath) {
  if (bytes.length < 33 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw invalidImage(filePath, "assinatura PNG ausente");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let foundImageData = false;
  let foundEnd = false;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const nextOffset = dataStart + length + 4;
    if (nextOffset > bytes.length) {
      throw invalidImage(filePath, `chunk PNG ${type || "desconhecido"} truncado`);
    }

    if (offset === PNG_SIGNATURE.length) {
      if (type !== "IHDR" || length !== 13) {
        throw invalidImage(filePath, "primeiro chunk não é um IHDR válido");
      }
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      if (
        !width ||
        !height ||
        !new Set([1, 2, 4, 8, 16]).has(bitDepth) ||
        !new Set([0, 2, 3, 4, 6]).has(colorType) ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        !new Set([0, 1]).has(bytes[dataStart + 12])
      ) {
        throw invalidImage(filePath, "metadata IHDR inconsistente");
      }
    }

    if (type === "IDAT") {
      foundImageData = true;
    }
    if (type === "IEND") {
      if (length !== 0 || nextOffset !== bytes.length) {
        throw invalidImage(filePath, "chunk IEND inválido ou bytes extras após a imagem");
      }
      foundEnd = true;
      break;
    }
    offset = nextOffset;
  }

  if (!width || !height || !foundImageData || !foundEnd) {
    throw invalidImage(filePath, "estrutura PNG incompleta");
  }
  return { width, height, mime: "image/png" };
}

function readJpegMetadata(bytes, filePath) {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    throw invalidImage(filePath, "marcadores JPEG SOI/EOI ausentes");
  }

  let offset = 2;
  let width = 0;
  let height = 0;
  let foundScan = false;
  while (offset < bytes.length - 2) {
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) {
      break;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      break;
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      throw invalidImage(filePath, "segmento JPEG truncado");
    }
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) {
      throw invalidImage(filePath, "tamanho de segmento JPEG inválido");
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (length < 7) {
        throw invalidImage(filePath, "segmento JPEG SOF inválido");
      }
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
    }
    if (marker === 0xda) {
      foundScan = true;
      break;
    }
    offset += length;
  }

  if (!width || !height || !foundScan) {
    throw invalidImage(filePath, "metadata ou scan JPEG ausente");
  }
  return { width, height, mime: "image/jpeg" };
}

function readWebpMetadata(bytes, filePath) {
  if (
    bytes.length < 30 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    throw invalidImage(filePath, "container RIFF/WEBP inválido");
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) {
      throw invalidImage(filePath, `chunk WebP ${type || "desconhecido"} truncado`);
    }

    if (type === "VP8X" && length >= 10) {
      return {
        width: readUInt24LE(bytes, dataStart + 4) + 1,
        height: readUInt24LE(bytes, dataStart + 7) + 1,
        mime: "image/webp",
      };
    }
    if (
      type === "VP8 " &&
      length >= 10 &&
      bytes[dataStart + 3] === 0x9d &&
      bytes[dataStart + 4] === 0x01 &&
      bytes[dataStart + 5] === 0x2a
    ) {
      return {
        width: bytes.readUInt16LE(dataStart + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataStart + 8) & 0x3fff,
        mime: "image/webp",
      };
    }
    if (type === "VP8L" && length >= 5 && bytes[dataStart] === 0x2f) {
      return {
        width: 1 + bytes[dataStart + 1] + ((bytes[dataStart + 2] & 0x3f) << 8),
        height:
          1 +
          (bytes[dataStart + 2] >> 6) +
          (bytes[dataStart + 3] << 2) +
          ((bytes[dataStart + 4] & 0x0f) << 10),
        mime: "image/webp",
      };
    }
    offset = dataEnd + (length % 2);
  }

  throw invalidImage(filePath, "chunk de imagem VP8/VP8L/VP8X ausente");
}

export function inspectImageBytes(bytes, filePath = "arquivo") {
  const extension = path.extname(filePath).toLowerCase();
  const expectedMime = MIME_BY_EXTENSION.get(extension);
  if (!expectedMime) {
    throw invalidImage(filePath, `extensão não suportada ${extension || "ausente"}`);
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  let metadata;
  if (expectedMime === "image/png") {
    metadata = readPngMetadata(buffer, filePath);
  } else if (expectedMime === "image/jpeg") {
    metadata = readJpegMetadata(buffer, filePath);
  } else {
    metadata = readWebpMetadata(buffer, filePath);
  }
  if (!metadata.width || !metadata.height || metadata.mime !== expectedMime) {
    throw invalidImage(filePath, "formato real não corresponde à extensão");
  }
  return metadata;
}

export async function readImageMetadata(filePath) {
  return inspectImageBytes(await readFile(filePath), filePath);
}

export async function createManifestAsset(filePath, publicPath) {
  return {
    path: publicPath,
    ...(await readImageMetadata(filePath)),
  };
}
