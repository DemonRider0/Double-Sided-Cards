import { CARD_CATEGORY_KEY } from "./selection-board.js";

const DIVINITY_GRID_WIDTH = 2;
const DIVINITY_GRID_HEIGHT = 3;
const DIVINITY_ORIGIN = {
  x: 390,
  y: 395,
};
const EPSILON = 0.0001;

export function isDivinityCategoryItem(item) {
  return item?.metadata?.[CARD_CATEGORY_KEY]?.category === "divinity";
}

export function getDivinityGridData(face) {
  const dpi = Math.max(1, face.width / DIVINITY_GRID_WIDTH);

  return {
    dpi,
    offset: { ...DIVINITY_ORIGIN },
  };
}

export function getDivinityScale(face) {
  const dpi = Math.max(1, face.width / DIVINITY_GRID_WIDTH);

  return {
    x: 1,
    y: (DIVINITY_GRID_HEIGHT * dpi) / Math.max(1, face.height),
  };
}

function almostEqual(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= EPSILON;
}

export function needsDivinitySizing(item, face = item?.image) {
  if (!isDivinityCategoryItem(item) || !face?.width || !face?.height) {
    return false;
  }

  const grid = getDivinityGridData(face);
  const scale = getDivinityScale(face);

  return !(
    almostEqual(item.grid?.dpi, grid.dpi) &&
    almostEqual(item.grid?.offset?.x, grid.offset.x) &&
    almostEqual(item.grid?.offset?.y, grid.offset.y) &&
    almostEqual(item.scale?.x, scale.x) &&
    almostEqual(item.scale?.y, scale.y)
  );
}

export function applyDivinitySizing(item, face = item?.image) {
  if (!isDivinityCategoryItem(item) || !face?.width || !face?.height) {
    return false;
  }

  const changed = needsDivinitySizing(item, face);
  item.grid = getDivinityGridData(face);
  item.scale = getDivinityScale(face);
  return changed;
}
