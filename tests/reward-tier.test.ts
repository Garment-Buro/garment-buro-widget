import assert from "node:assert/strict";
import test from "node:test";
import { rewardTierForPercent } from "../lib/reward-tier.ts";

test("reward tiers follow game rarity thresholds", () => {
  assert.equal(rewardTierForPercent(0), "white");
  assert.equal(rewardTierForPercent(2.9), "white");
  assert.equal(rewardTierForPercent(3), "green");
  assert.equal(rewardTierForPercent(5.9), "green");
  assert.equal(rewardTierForPercent(6), "blue");
  assert.equal(rewardTierForPercent(9.9), "blue");
  assert.equal(rewardTierForPercent(10), "orange");
  assert.equal(rewardTierForPercent(14), "orange");
});
