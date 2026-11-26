const DIRECTION_BUTTONS = [
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
];

export function getGamepadDirection(gamepad) {
  for (const [buttonIndex, direction] of DIRECTION_BUTTONS) {
    if (gamepad.buttons[buttonIndex]?.pressed) return direction;
  }

  const horizontal = gamepad.axes[0] || 0;
  const vertical = gamepad.axes[1] || 0;
  if (Math.max(Math.abs(horizontal), Math.abs(vertical)) < 0.55) return null;
  if (Math.abs(horizontal) > Math.abs(vertical)) {
    return horizontal < 0 ? "left" : "right";
  }
  return vertical < 0 ? "up" : "down";
}

export function findDirectionalTarget(current, candidates, direction) {
  const available = candidates.filter((candidate) => candidate !== current);
  if (!available.length) return null;
  if (!current || !candidates.includes(current)) return available[0];

  const origin = current.getBoundingClientRect();
  const originX = origin.left + origin.width / 2;
  const originY = origin.top + origin.height / 2;
  const isHorizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const ranked = available
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const primary = isHorizontal ? (x - originX) * sign : (y - originY) * sign;
      const cross = isHorizontal ? Math.abs(y - originY) : Math.abs(x - originX);
      return { candidate, primary, cross };
    })
    .filter(({ primary }) => primary > 1)
    .sort((a, b) => a.primary + a.cross * 2 - (b.primary + b.cross * 2));

  if (ranked.length) return ranked[0].candidate;

  return available
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const edge = direction === "right"
        ? x
        : direction === "left"
          ? -x
          : direction === "down"
            ? y
            : -y;
      const cross = isHorizontal ? Math.abs(y - originY) : Math.abs(x - originX);
      return { candidate, edge, cross };
    })
    .sort((a, b) => a.edge - b.edge || a.cross - b.cross)[0].candidate;
}
