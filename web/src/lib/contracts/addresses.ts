// Arc Testnet contract addresses. Canonical source of truth lives in
// indexer/shared/chain-config.ts — these constants are convenience re-exports
// for the web bundle so client code doesn't pull in indexer dependencies.

export const AGENTIC_COMMERCE = '0x0747EEf0706327138c69792bF28Cd525089e4583';
export const USDC_CONTRACT = '0x3600000000000000000000000000000000000000';

// Redeployed 2026-05-21 with EIP-712 name=Caliber.
// Signer: 0xbF017698BB2c936D54a74DCABF68Df42800bAA84. Methodology v1.0.0.
export const RATING_VERIFIER = '0xbc5942F89AFDf3d62b5c73B946258A0Dcb1Aa6cb';
export const RATING_GATEWAY = '0x87230cfa52DbfBC4a81167F1dFa9eDA04B754837';
