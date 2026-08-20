import { stat } from "node:fs/promises";

import sharp from "sharp";

export const PRIVATE_RUNTIME_WEBP_OPTIONS = Object.freeze({
  quality: 95,
  alphaQuality: 100,
  effort: 6,
  smartSubsample: true,
});
export const PRIVATE_RUNTIME_MIN_SAVING_BYTES = 4096;
export const PRIVATE_RUNTIME_MIN_SAVING_RATIO = 0.01;

export function isUsefulRuntimeReduction(originalSize, optimizedSize) {
  const saving = originalSize - optimizedSize;
  return (
    saving >= PRIVATE_RUNTIME_MIN_SAVING_BYTES &&
    saving / originalSize >= PRIVATE_RUNTIME_MIN_SAVING_RATIO
  );
}

export async function optimizePngForRuntime(input) {
  const sourceSize =
    typeof input === "string" ? (await stat(input)).size : Buffer.byteLength(input);
  const sourceMetadata = await sharp(input, { failOn: "error" }).metadata();
  if (sourceMetadata.format !== "png") {
    throw new Error("A otimização WebP aceita apenas uma fonte PNG.");
  }
  const candidate = await sharp(input, { failOn: "error" })
    .webp(PRIVATE_RUNTIME_WEBP_OPTIONS)
    .toBuffer();
  const converted = isUsefulRuntimeReduction(sourceSize, candidate.length);
  return {
    converted,
    bytes: converted ? candidate : null,
    sourceSize,
    runtimeSize: converted ? candidate.length : sourceSize,
    sourceMetadata,
  };
}
