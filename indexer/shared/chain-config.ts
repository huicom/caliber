export interface ChainConfig {
  id: string;
  chainId: number;
  name: string;
  rpcUrl: string;
  rpcWs: string;
  contracts: {
    identityRegistry: `0x${string}`;
    reputationRegistry: `0x${string}`;
    validationRegistry: `0x${string}`;
    agenticCommerce: `0x${string}`;
    usdcContract: `0x${string}`;
    ratingVerifier: `0x${string}`;
    ratingGateway: `0x${string}`;
  };
  deploymentBlock: bigint;
}

const MISSING_SENTINEL = '' as `0x${string}`;

export const CHAINS: Record<string, ChainConfig> = {
  arc: {
    id: 'arc',
    chainId: 5042002,
    name: 'Arc Testnet',
    rpcUrl: process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network',
    rpcWs: process.env.ARC_RPC_WS ?? 'wss://rpc.testnet.arc.network',
    contracts: {
      identityRegistry:
        '0x8004A818BFB912233c491871b3d84c89A494BD9e',
      reputationRegistry:
        '0x8004B663056A597Dffe9eCcC1965A193B7388713',
      validationRegistry:
        '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
      agenticCommerce: '0x0747EEf0706327138c69792bF28Cd525089e4583',
      usdcContract: '0x3600000000000000000000000000000000000000',
      // Redeployed 2026-05-21 with EIP-712 name=Caliber. Previous v1: verifier 0x32d5…cdC6, gateway 0x3B7f…7682 (deprecated) via contracts/script/Deploy.s.sol.
      // Signer: 0xbF017698BB2c936D54a74DCABF68Df42800bAA84. Methodology v1.0.0.
      ratingVerifier: '0xbc5942F89AFDf3d62b5c73B946258A0Dcb1Aa6cb',
      ratingGateway: '0x87230cfa52DbfBC4a81167F1dFa9eDA04B754837',
    },
    deploymentBlock: BigInt(process.env.DEPLOYMENT_BLOCK ?? '0'),
  },
  // TODO: Add Base chain config when ERC-8004 is deployed there
};

export const BASE_CONFIG: ChainConfig = {
  id: 'base',
  chainId: 8453,
  name: 'Base',
  rpcUrl:
    process.env.BASE_RPC_URL ??
    (console.warn('BASE_RPC_URL not set — Base spike scripts will fail'),
    ''),
  rpcWs: process.env.BASE_RPC_WS ?? '',
  contracts: {
    identityRegistry:
      '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry:
      '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    validationRegistry: MISSING_SENTINEL,
    agenticCommerce: MISSING_SENTINEL,
    usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    ratingVerifier: MISSING_SENTINEL,
    ratingGateway: MISSING_SENTINEL,
  },
  deploymentBlock: 0n,
};
