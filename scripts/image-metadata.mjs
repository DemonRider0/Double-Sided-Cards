import { open } from "node:fs/promises";
import path from "node:path";

const MIME_BY_EXTENSION = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function readImageMetadata(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXTENSION.get(extension);

  if (extension !== ".png" && extension !== ".apng") {
    return mime ? { mime } : {};
  }

  const header = Buffer.alloc(24);
  const file = await open(filePath, "r");
  try {
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (
      bytesRead !== header.length ||
      !header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
      header.toString("ascii", 12, 16) !== "IHDR"
    ) {
      throw new Error(`PNG invalido ou sem cabecalho IHDR: ${filePath}`);
    }

    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    if (!width || !height) {
      throw new Error(`PNG sem dimensoes validas: ${filePath}`);
    }

    return {
      width,
      height,
      mime: extension === ".apng" ? "image/apng" : "image/png",
    };
  } finally {
    await file.close();
  }
}

export async function createManifestAsset(filePath, publicPath) {
  return {
    path: publicPath,
    ...(await readImageMetadata(filePath)),
  };
}
