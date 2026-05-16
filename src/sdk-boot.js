import { loadOwlbearSdk } from "./obr.js";

window.doubleSidedCardsSdkReady = loadOwlbearSdk(20000);
window.doubleSidedCardsSdkReady.catch((error) => {
  console.error("Double-Sided Cards SDK boot error", error);
});
