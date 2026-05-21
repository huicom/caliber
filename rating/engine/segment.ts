import type { AgentSegment } from './types';

const KNOWN_TYPES = new Set<AgentSegment>(['payment-relay', 'trading', 'service', 'validator']);

export function classifySegment(
  agentType: string | null,
  capabilities: string[] | null,
  validatorValidationCount: number,
): AgentSegment {
  if (agentType && KNOWN_TYPES.has(agentType as AgentSegment)) {
    return agentType as AgentSegment;
  }

  if (capabilities && capabilities.length > 0) {
    const lower = capabilities.map((c) => c.toLowerCase());
    if (lower.some((c) => c.includes('payment') || c.includes('transfer')))
      return 'payment-relay';
    if (lower.some((c) => c.includes('trade') || c.includes('swap')))
      return 'trading';
    if (lower.some((c) => c.includes('validate')))
      return 'validator';
  }

  if (validatorValidationCount >= 5) return 'validator';

  return 'service';
}
