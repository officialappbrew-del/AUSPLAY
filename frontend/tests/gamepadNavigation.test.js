import assert from "node:assert/strict";
import test from "node:test";
import { findDirectionalTarget, getGamepadDirection } from "../src/gamepadNavigation.js";

test("reads d-pad direction before analog stick input", () => {
  const gamepad = {
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: index === 14 })),
    axes: [0, -1],
  };

  assert.equal(getGamepadDirection(gamepad), "left");
});

test("ignores small stick movement and resolves the dominant axis", () => {
  const gamepad = { buttons: [], axes: [0.2, 0.1] };
  assert.equal(getGamepadDirection(gamepad), null);

  gamepad.axes = [-0.8, 0.3];
  assert.equal(getGamepadDirection(gamepad), "left");
});

test("moves focus toward the nearest control in the requested direction", () => {
  const control = (left, top) => ({
    getBoundingClientRect: () => ({ left, top, width: 40, height: 40 }),
  });
  const current = control(0, 0);
  const nearRight = control(60, 0);
  const down = control(0, 60);
  const farRight = control(120, 0);

  assert.equal(
    findDirectionalTarget(current, [current, nearRight, down, farRight], "right"),
    nearRight,
  );
  assert.equal(findDirectionalTarget(current, [current, nearRight, down], "down"), down);
});
