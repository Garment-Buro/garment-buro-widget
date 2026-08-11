export type RewardTier = "white" | "green" | "blue" | "orange";

export function rewardTierForPercent(percent: number): RewardTier {
  const value = Number.isFinite(percent) ? Math.max(0, percent) : 0;
  if (value < 3) return "white";
  if (value < 6) return "green";
  if (value < 10) return "blue";
  return "orange";
}
