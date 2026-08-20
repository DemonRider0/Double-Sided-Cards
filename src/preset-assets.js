import { getMimeFromUrl } from "./card-data.js";
import { getConfiguredAssetResolver } from "./asset-resolver.js";

const ITEM_LAYERS = new Set([
  "DRAWING",
  "PROP",
  "MOUNT",
  "CHARACTER",
  "ATTACHMENT",
  "NOTE",
  "TEXT",
]);

function isExternalUrl(value) {
  return /^(https?:|data:|blob:)/i.test(value);
}

export function normalizePresetLayer(value) {
  return ITEM_LAYERS.has(value) ? value : "PROP";
}

export function resolvePresetAssetUrl(asset) {
  const result = getConfiguredAssetResolver().resolve(asset);
  return result.resolved ? result.value.url || result.value : "";
}

export function getPresetNameFromPath(path, fallback) {
  if (!path || typeof path !== "string") {
    return fallback;
  }

  try {
    const pathname = isExternalUrl(path) ? new URL(path).pathname : path;
    const filename = pathname.split("/").filter(Boolean).pop();

    if (!filename) {
      return fallback;
    }

    return decodeURIComponent(filename.replace(/\.[^.]+$/, "")) || fallback;
  } catch {
    return fallback;
  }
}

export function normalizePresetAsset(value, fallbackName) {
  if (typeof value === "string") {
    return {
      name: getPresetNameFromPath(value, fallbackName),
      path: value,
    };
  }

  if (!value || typeof value !== "object") {
    return {
      name: fallbackName,
      path: "",
    };
  }

  return {
    name: value.name || getPresetNameFromPath(value.path || value.url, fallbackName),
    assetId: value.assetId,
    path: value.path || value.url || "",
    width: value.width,
    height: value.height,
    mime: value.mime,
  };
}

function readImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error(`Imagem sem tamanho valido: ${url}`));
        return;
      }

      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => reject(new Error(`Nao consegui carregar a imagem: ${url}`));
    image.src = url;
  });
}

export async function buildPresetFace(asset, missingAssetMessage) {
  const resolved = getConfiguredAssetResolver().resolve(asset);
  const value = resolved.resolved ? resolved.value : null;
  const url = value?.url || "";

  if (!url) {
    throw new Error(missingAssetMessage);
  }

  const dimensions =
    Number.isFinite(value.width) && Number.isFinite(value.height)
      ? { width: value.width, height: value.height }
      : await readImage(url);

  return {
    assetId: resolved.canonicalId,
    url,
    width: dimensions.width,
    height: dimensions.height,
    mime: value.mime || getMimeFromUrl(url),
  };
}

export function isPresetAssetReady(asset) {
  return getConfiguredAssetResolver().isReady(asset);
}

export function isPresetAssetConfigured(asset) {
  return Boolean(
    asset &&
      typeof asset === "object" &&
      ((typeof asset.assetId === "string" && asset.assetId.trim()) ||
        (typeof asset.path === "string" && asset.path.trim()) ||
        (typeof asset.url === "string" && asset.url.trim())),
  );
}
