export interface ChainConfig {
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
  };
  deploymentBlock: bigint;
}

export const CHAINS: Record<string, ChainConfig> = {
  arc: {
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
    },
    deploymentBlock: BigInt(process.env.DEPLOYMENT_BLOCK ?? '0'),
  },
  // TODO: Add Base chain config when ERC-8004 is deployed there
};
