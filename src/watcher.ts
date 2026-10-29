import { EventLog } from 'ethers';
import { V2Dex } from './dex/v2.js';
import { Store } from './state.js';
import { log, scanProgress } from './log.js';
export async function discover(dex: V2Dex, store: Store) {
  const c = dex.config, s = store.state;
  const head = await dex.provider.getBlockNumber() - c.confirmations;
  if (s.cursor < 0) s.cursor = Math.max(0, head - c.lookback);
  if (head <= s.cursor) { scanProgress(s.cursor, head); return; }
  const end = Math.min(head, s.cursor + c.chunk);
  const events = await dex.factory.queryFilter(dex.factory.filters.PairCreated(), s.cursor + 1, end);
  for (const event of events) {
    if (!(event instanceof EventLog)) continue;
    const [a, b, pair] = event.args as unknown as [string, string, string];
    const token = a.toLowerCase() === c.weth.toLowerCase() ? b : b.toLowerCase() === c.weth.toLowerCase() ? a : undefined;
    if (!token || s.seen.includes(token.toLowerCase()) || s.candidates.some(x => x.pair === pair)) continue;
    const block = await dex.provider.getBlock(event.blockNumber);
    if (!block || block.hash !== event.blockHash || Date.now() - block.timestamp * 1000 > c.ttl * 1000) continue;
    if (s.candidates.length >= c.candidates) { log('candidate_queue_full', {pair}); continue; }
    s.candidates.push({pair, token, block: event.blockNumber, hash: event.blockHash, created: block.timestamp * 1000, next: 0});
    log('new_pair', {pair, token, block: event.blockNumber});
  }
  s.cursor = end; store.save(); scanProgress(end, head);
}
