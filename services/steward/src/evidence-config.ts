// Env config for WS-2 evidence issuance. Lazily read + cached. Returns null when
// EVIDENCE_REGISTRY_ADDRESS is unset (evidence issuance is then a no-op — the
// pipeline keeps working, it just doesn't record on-chain evidence).

import type { Address, Hex } from 'viem';

export interface EvidenceConfig {
  /** EvidenceRegistry contract on Arc Testnet. */
  registry: Address;
  /** Arc Testnet RPC. */
  rpcUrl: string;
  chainId: number;
  /** The rating signer key — the registry's signer() expects its signature. */
  signerKey: Hex;
  /** Gas payer for attest() (permissionless; gas payer ≠ signer is fine). */
  gasKey: Hex;
}

let _cfg: EvidenceConfig | null | undefined;

function key(name: string): Hex | null {
  const v = process.env[name]?.trim();
  if (!v) return null;
  return (v.startsWith('0x') ? v : `0x${v}`) as Hex;
}

export function evidenceConfig(): EvidenceConfig | null {
  if (_cfg !== undefined) return _cfg;

  const registry = process.env.EVIDENCE_REGISTRY_ADDRESS?.trim();
  const signerKey = key('RATING_SIGNER_PRIVATE_KEY');
  // Gas: prefer STEWARD_PRIVATE_KEY (the checkbook wallet, already funded on Arc);
  // fall back to DEPLOYER_PRIVATE_KEY.
  const gasKey = key('STEWARD_PRIVATE_KEY') ?? key('DEPLOYER_PRIVATE_KEY');
  const rpcUrl = process.env.ARC_RPC_URL?.trim();
  const chainId = Number(process.env.ARC_CHAIN_ID ?? '5042002');

  if (!registry || !signerKey || !gasKey || !rpcUrl) {
    if (registry && (!signerKey || !gasKey || !rpcUrl)) {
      console.warn(
        '[steward:evidence] EVIDENCE_REGISTRY_ADDRESS set but a dependency is missing ' +
          `(signerKey=${!!signerKey} gasKey=${!!gasKey} rpcUrl=${!!rpcUrl}) — evidence disabled`,
      );
    }
    _cfg = null;
    return _cfg;
  }

  _cfg = {
    registry: registry as Address,
    rpcUrl,
    chainId,
    signerKey,
    gasKey,
  };
  return _cfg;
}
