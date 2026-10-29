export function minimumOut(quote: bigint, slippage: number) {
  const result = quote * BigInt(10000 - slippage) / 10000n;
  if (result <= 0n) throw new Error('Zero minimum output'); return result;
}
export function exitReason(value: bigint, cost: bigint, age: number, tp: number, sl: number, maxAge: number) {
  if (value * 10000n >= cost * BigInt(10000 + tp)) return 'take-profit';
  if (value * 10000n <= cost * BigInt(10000 - sl)) return 'stop-loss';
  if (age >= maxAge) return 'max-hold'; return undefined;
}
