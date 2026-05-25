async function getViewportCenter(OBR) {
  const [width, height] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);

  return OBR.viewport.inverseTransformPoint({
    x: width / 2,
    y: height / 2,
  });
}

async function getFeedbackPosition(OBR, anchorItems) {
  const itemIds = anchorItems
    .map((item) => item?.id)
    .filter((id) => typeof id === "string" && id.length);

  if (itemIds.length) {
    try {
      const bounds = await OBR.scene.items.getItemBounds(itemIds);

      return {
        x: bounds.center.x,
        y: bounds.min.y - Math.max(48, bounds.height * 0.12),
      };
    } catch {
      // Usa o centro da tela quando o item selecionado acabou de ser removido.
    }
  }

  return getViewportCenter(OBR);
}

function setRichText(label, message) {
  label.text.richText[0].children[0].text = message;
}

async function animateFeedback(OBR, label, startPosition) {
  const durationMs = 820;
  const distance = 72;
  const steps = 14;

  for (let step = 1; step <= steps; step += 1) {
    window.setTimeout(() => {
      const progress = step / steps;
      const eased = 1 - (1 - progress) ** 3;

      OBR.scene.local
        .updateItems(
          [label],
          (items) => {
            const item = items[0];

            if (!item) {
              return;
            }

            item.position = {
              x: startPosition.x,
              y: startPosition.y - distance * eased,
            };
            item.scale = {
              x: 1 + 0.05 * (1 - progress),
              y: 1 + 0.05 * (1 - progress),
            };
            item.style.backgroundOpacity = Math.max(0, 0.9 * (1 - progress));
            item.text.style.fillOpacity = Math.max(0, 1 - progress);
          },
          true,
        )
        .catch(() => {});
    }, Math.round((durationMs / steps) * step));
  }

  window.setTimeout(() => {
    OBR.scene.local.deleteItems([label.id]).catch(() => {});
  }, durationMs + 80);
}

export async function showActionFeedback(OBR, buildLabel, message, anchorItems = []) {
  try {
    const position = await getFeedbackPosition(OBR, anchorItems);
    const label = buildLabel()
      .name(`Cartas Duplas: ${message}`)
      .plainText(message)
      .position(position)
      .fontSize(28)
      .fontWeight(800)
      .fillColor("#ffffff")
      .strokeColor("#0a0f14")
      .strokeOpacity(0.55)
      .strokeWidth(2)
      .lineHeight(1.1)
      .padding(10)
      .backgroundColor("#8f1f1a")
      .backgroundOpacity(0.9)
      .cornerRadius(10)
      .pointerDirection("DOWN")
      .pointerWidth(12)
      .pointerHeight(10)
      .disableHit(true)
      .build();

    setRichText(label, message);
    await OBR.scene.local.addItems([label]);
    await animateFeedback(OBR, label, position);
  } catch (error) {
    console.warn("Nao consegui mostrar a animacao da acao", error);
    await OBR.notification.show(message, "SUCCESS").catch(() => {});
  }
}
