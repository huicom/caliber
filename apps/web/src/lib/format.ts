export function truncateAddress(addr: string, chars = 4): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 2 + chars)}...${addr.slice(-chars)}`;
}

export function formatUSDC(raw: string | number | bigint, decimals = 2): string {
  const value = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function arcscanTxUrl(hash: string): string {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

export function arcscanAddressUrl(addr: string): string {
  return `https://testnet.arcscan.app/address/${addr}`;
}
