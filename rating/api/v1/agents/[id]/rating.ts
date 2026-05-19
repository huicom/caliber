// Placeholder — returns mock rating data. Real implementation on Friday.
// In the Next.js API route, this will be wired as:
//   /api/rating/v1/agents/[id]/route.ts
export const mockRating = {
  agentId: '14176',
  tier: 'Arc-BBB',
  pd: 0.032,
  lgd: 0.45,
  ead: 1250.0,
  computedAt: new Date().toISOString(),
  _note: 'MOCK — real rating engine not implemented yet',
};
