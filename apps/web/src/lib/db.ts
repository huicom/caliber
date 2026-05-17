// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (this: bigint): string {
  return this.toString();
};

export { db, sql } from '@arc-agents/db';
export * from '@arc-agents/db';
