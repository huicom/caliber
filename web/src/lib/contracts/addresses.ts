// Arc Testnet contract addresses. Canonical source of truth lives in
// indexer/shared/chain-config.ts — these constants are convenience re-exports
// for the web bundle so client code doesn't pull in indexer dependencies.

export const AGENTIC_COMMERCE = '0x0747EEf0706327138c69792bF28Cd525089e4583';
export const USDC_CONTRACT = '0x3600000000000000000000000000000000000000';

// Redeployed 2026-05-22 (Wave M, methodology v2.0). RatingAttestation struct
// redesigned (tier+score+interactionCount+flags replace pdBps+lgdBps+confidence).
// CaliberEscrow bond formula switched to configurable tier-stepped table.
// Signer: 0xbF017698BB2c936D54a74DCABF68Df42800bAA84. Methodology v2.0.0.
// Previous v1.x deployments preserved at git tag methodology-v1.0.1-final.
export const RATING_VERIFIER = '0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8';
export const RATING_GATEWAY = '0x003234AAd031242052d7e580d337386f1B261b78';
export const CALIBER_ESCROW = '0xc76bb990E498ACace1ff6A83ea4CCDDa92485365';
