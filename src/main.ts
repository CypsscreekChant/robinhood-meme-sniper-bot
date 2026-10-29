import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { JsonRpcProvider, FetchRequest, getAddress } from 'ethers';
// Resolve project paths and .env independently of the calling directory.
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const { loadConfig } = await import('./config.js');
const { V2Dex } = await import('./dex/v2.js');
const { Store, acquireLock, LockError } = await import('./state.js');
const { Executor } = await import('./trading/executor.js');
const { tick } = await import('./engine.js');
const { checkGoPlus } = await import('./security/goplus.js');
const { getGoPlusAuth } = await import('./security/auth.js');
const { log, errorCode, startConsole, stopConsole, attachConsoleState, consolePhase } = await import('./log.js');
let release: (() => void) | undefined;
let provider: JsonRpcProvider | undefined;
try {
  const c = loadConfig();
  if (!process.argv[2]) startConsole(c);
  const request = new FetchRequest(c.rpc); request.timeout = 15000;
  provider = new JsonRpcProvider(request, undefined, {batchMaxCount: 1});
  const dex = new V2Dex(provider, c);
  await dex.preflight();
  if (process.argv[2] === 'check') {
    log('preflight_ok', {chainId: 4663, mode: c.mode, wallet: c.walletAddress, factory: c.factory, router: c.router, block: await provider.getBlockNumber()});
  } else if (process.argv[2] === 'token') {
    const token = getAddress(process.argv[3] || '');
    const pair = await dex.factory.getPair(token, c.weth);
    const pool = await dex.inspect(pair, token);
    log('token_report', {token, pair, pool, reasons: await checkGoPlus(token, pair, c.holder), note: '仅检查报告，不触发交易；不是安全保证'});
  } else {
    if (process.argv[2]) throw new Error('Unknown command');
    release = acquireLock(c.dir, c.mode);
    consolePhase('authenticating GoPlus');
    await getGoPlusAuth().getToken();
    const identity = [4663,c.factory,c.router,c.weth,c.walletAddress].join(':').toLowerCase();
    const store = new Store(c.dir, c.mode, identity);
    if (store.state.pending) throw new Error('Pending transaction journal: inspect data before restart');
    attachConsoleState(() => store.state);
    const executor = new Executor(dex, store);
    let running = true;
    process.once('SIGINT', () => {running = false; consolePhase('stopping');}); process.once('SIGTERM', () => {running = false; consolePhase('stopping');});
    log('started', {mode: c.mode, chainId: 4663, wallet: c.walletAddress, stopFile: path.resolve(c.dir, 'STOP')});
    while (running) {
      if (fs.existsSync(path.join(c.dir, 'STOP'))) { log('emergency_stop'); break; }
      try { consolePhase('scanning / monitoring'); await tick(dex, store, executor); if (running) consolePhase('listening'); }
      catch (error) {
        if (store.state.pending) { log('pending_transaction_halt', {pending: store.state.pending}); throw error; }
        consolePhase('retrying after error');
        log('cycle_failed', {code: errorCode(error)});
      }
      if (running) await new Promise(resolve => setTimeout(resolve, c.poll));
    }
  }
} catch (error) {
  log('fatal', {code: errorCode(error), hint: error instanceof LockError ? error.message : errorCode(error) === 'INVALID_PRIVATE_KEY' ? 'Please enter a valid private key in .env (PRIVATE_KEY). Paper mode does not send real transactions.' : 'Check .env, network, contracts, lock files, or pending transactions. See README.'});
  process.exitCode = 1;
} finally { stopConsole(); release?.(); provider?.destroy(); }
