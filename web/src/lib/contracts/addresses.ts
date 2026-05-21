// Arc Testnet contract addresses. Canonical source of truth lives in
// indexer/shared/chain-config.ts — these constants are convenience re-exports
// for the web bundle so client code doesn't pull in indexer dependencies.

export const AGENTIC_COMMERCE = '0x0747EEf0706327138c69792bF28Cd525089e4583';
export const USDC_CONTRACT = '0x3600000000000000000000000000000000000000';

// Redeployed 2026-05-21 (Wave 2). RatingAttestation struct now includes
// uint16 lgdBps so CaliberEscrow can price the bond formula
// (budget × pd × lgd) from a single signed attestation. Signer:
// 0xbF017698BB2c936D54a74DCABF68Df42800bAA84. Methodology v1.0.0.
export const RATING_VERIFIER = '0x32C554edA5CDD2eb94F242ebf3f38820d3C53E29';
export const RATING_GATEWAY = '0xB4C1aF80Adb9F537985B93490a02eB229089259f';
export const CALIBER_ESCROW = '0x0193CB604BC0B4B8853EA45Dfdcd062aa1dc3DF6';
