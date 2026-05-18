import { loadOwlbearSdk } from "./obr.js";

window.doubleSidedCardsSdkReady = loadOwlbearSdk(20000);
window.doubleSidedCardsSdkReady.catch((error) => {
  console.error("Erro ao iniciar o SDK das Cartas Duplas", error);
});
