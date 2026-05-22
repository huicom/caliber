// Caliber Rating v2.0 — Step 2.1 credibility weighting (methodology §"Smoothing for small samples").
//
// Bühlmann credibility theory: blend an individual rate with the population
// mean using a sample-size-aware weight. Standard actuarial smoothing from
// the 1960s. Right tool for sparse on-chain data.
//
//   credibility weight Z = n / (n + k)
//   smoothed_rate = Z * individual_rate + (1 - Z) * population_rate
//
// k = credibility constant (tuning parameter):
//   - small k (e.g. 5): individual rate dominates quickly
//   - large k (e.g. 50): heavy anchor to population mean for sparse n
// k = 20 is the v2.0 launch default for completion rates. An agent with
// 20 resolved jobs gets 50% weight on their own rate; 100 resolved jobs gets
// ~83% weight. Tunable; documented in methodology Appendix F when changed.

export const DEFAULT_CREDIBILITY_CONSTANT_K = 20;

export function credibilityWeight(n: number, k: number = DEFAULT_CREDIBILITY_CONSTANT_K): number {
  if (n <= 0) return 0;
  return n / (n + k);
}

export function credibilityBlend(
  individualRate: number,
  populationRate: number,
  n: number,
  k: number = DEFAULT_CREDIBILITY_CONSTANT_K,
): number {
  const z = credibilityWeight(n, k);
  return z * individualRate + (1 - z) * populationRate;
}
