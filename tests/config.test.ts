import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { loadConfig } from '../src/config.js';
import { Executor } from '../src/trading/executor.js';

// Public deterministic fixture; never a user credential or a funded wallet.
const fixture = '0x' + '1'.repeat(64);
function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const saved = {...process.env};
  try {
    // Isolate tests from the user's local .env and shell settings.
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
    run();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
test('valid private key is required for default paper and explicit modes', () => {
  for (const MODE of [undefined, 'paper', 'live']) {
    for (const PRIVATE_KEY of [undefined, '', ' ', 'invalid-secret', '0x'+'0'.repeat(64), '0x'+'f'.repeat(64), new Wallet(fixture).address]) {
      withEnv({MODE, PRIVATE_KEY, LIVE_TRADING_ACK:'I_UNDERSTAND'}, () => {
        assert.throws(loadConfig, (error: any) => error.code === 'INVALID_PRIVATE_KEY' && error.message === 'Please enter a valid private key in .env (PRIVATE_KEY). Paper mode does not send real transactions.' && !('value' in error));
      });
    }
  }
});
test('valid fixture derives the same wallet in both modes; live still needs acknowledgment', () => {
  for (const MODE of ['paper','live']) withEnv({MODE, PRIVATE_KEY:fixture, LIVE_TRADING_ACK:'I_UNDERSTAND'}, () => {
    const c=loadConfig(); assert.equal(c.key,fixture); assert.equal(c.walletAddress,new Wallet(fixture).address);
  });
  withEnv({PRIVATE_KEY:fixture}, () => assert.equal(loadConfig().mode,'paper'));
  withEnv({MODE:'live',PRIVATE_KEY:fixture}, () => assert.throws(loadConfig,/LIVE_TRADING_ACK/));
});
test('paper has no signer even with a valid key; transaction entry point cannot broadcast', async () => {
  let signed=0, broadcast=0;
  const ex=new Executor({config:{mode:'paper',key:fixture},provider:{broadcastTransaction:()=>{broadcast++;}}} as any, {} as any);
  assert.equal(ex.wallet,undefined);
  // Even an accidentally attached signer must not bypass the mode check.
  ex.wallet={signTransaction:()=>{signed++;}} as any;
  await assert.rejects(ex.transact('test',{}),/Live execution is disabled/);
  assert.equal(signed,0); assert.equal(broadcast,0);
});
