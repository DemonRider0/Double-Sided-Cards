import OBR, { buildImage, buildLabel } from "@owlbear-rodeo/sdk";
export * from "./card-data.js";

export function isInOwlbearFrame() {
  return window.parent !== window;
}

export async function loadOwlbearSdk(timeoutMs = 5000) {
  if (!isInOwlbearFrame() || !OBR.isAvailable) {
    throw new Error("Esta página precisa estar aberta dentro do Owlbear Rodeo.");
  }

  if (OBR.isReady) {
    return { OBR, sdk: { buildImage, buildLabel } };
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("O Owlbear não respondeu a tempo."));
      }
    }, timeoutMs);

    OBR.onReady(() => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve();
      }
    });
  });

  return { OBR, sdk: { buildImage, buildLabel } };
}
