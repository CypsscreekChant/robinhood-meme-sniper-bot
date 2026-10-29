import fs from 'node:fs';
import path from 'node:path';
import { V2Dex } from './dex/v2.js';
import { Store, type Candidate } from './state.js';
import { Executor } from './trading/executor.js';
import { discover } from './watcher.js';
import { checkGoPlus } from './security/goplus.js';
import { exitReason, minimumOut } from './trading/rules.js';
import { errorCode, log } from './log.js';
export async function assess(dex: V2Dex, candidate: Candidate) {
  const c = dex.config;
  const block = await dex.provider.getBlock(candidate.block);
  if (!block || block.hash !== candidate.hash) return ['区块已重组'];
  const pool = await dex.inspect(candidate.pair, candidate.token);
  const reasons: string[] = [];
  if (pool.eth < c.liquidity) reasons.push('WETH 储备不足');
  // Conservative input/reserve bound, stronger than constant-product spot impact.
  if (c.buy * 10000n > pool.eth * BigInt(c.impact)) reasons.push('交易相对池子过大');
  if (pool.burnedBps < c.burned) reasons.push('已销毁 LP 比例不足（锁仓 LP 不算销毁）');
  if (reasons.length) return reasons;
  reasons.push(...await checkGoPlus(candidate.token, candidate.pair, c.holder));
  // Reverse quote alone is not proof of sellability; GoPlus is mandatory above.
  const buy = await dex.quote(c.buy, candidate.token, true);
  await dex.quote(buy, candidate.token, false);
  return reasons;
}
export async function tick(dex: V2Dex, store: Store, executor: Executor) {
  const c = dex.config, s = store.state;
  if (s.pending) throw new Error('Pending transaction journal: manual reconciliation required');
  let exitsHealthy = true;
  for (const position of [...s.positions]) {
    try {
      const quote = minimumOut(await dex.quote(BigInt(position.amount), position.token, false), c.slippage);
      const reason = exitReason(quote, BigInt(position.cost), (Date.now()-position.opened)/1000, c.takeProfit, c.stopLoss, c.hold);
      if (reason) await executor.sell(position, reason);
    } catch (error) {
      if (s.pending) throw error;
      exitsHealthy = false;
      log('exit_check_failed', {token: position.token, code: errorCode(error)});
    }
  }
  await discover(dex, store);
  s.candidates = s.candidates.filter(x => Date.now() - x.created <= c.ttl * 1000 && !s.seen.includes(x.token.toLowerCase()));
  store.save();
  if (!exitsHealthy) return; // No new exposure while exit monitoring is impaired.
  for (const candidate of s.candidates.filter(x => Date.now() >= x.next).slice(0, 1)) {
    if (Date.now() < candidate.next) continue;
    candidate.next = Date.now() + 30000; store.save();
    try {
      const reasons = await assess(dex, candidate);
      if (reasons.length) { log('candidate_rejected', {token: candidate.token, reasons}); continue; }
      if (Date.now()-candidate.created > c.ttl*1000) continue;
      // Refresh pool after the remote safety request, immediately before buying.
      const pool = await dex.inspect(candidate.pair, candidate.token);
      if (pool.eth < c.liquidity || pool.burnedBps < c.burned || c.buy*10000n > pool.eth*BigInt(c.impact)) continue;
      if (fs.existsSync(path.join(c.dir, 'STOP'))) return;
      await executor.buy(candidate);
    } catch (error) {
      if (s.pending) throw error;
      log('candidate_check_failed', {token: candidate.token, code: errorCode(error)});
    }
    break; // Bound API work per cycle; position monitoring has priority.
  }
}
