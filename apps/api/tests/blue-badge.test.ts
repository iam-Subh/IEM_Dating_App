import { test } from "node:test";
import assert from "node:assert/strict";
import { blueBadge } from "../src/services/blue-badge";

test("the blue badge needs a valid college verification and a passed face check", () => {
  const passed = new Date("2026-10-01T00:00:00.000Z");
  assert.equal(blueBadge(true, passed), true);
  assert.equal(blueBadge(true, true), true);
  // College alone, face alone, or neither: no badge.
  assert.equal(blueBadge(true, null), false);
  assert.equal(blueBadge(true, false), false);
  assert.equal(blueBadge(false, passed), false);
  assert.equal(blueBadge(false, null), false);
  assert.equal(blueBadge(true, undefined), false);
});
