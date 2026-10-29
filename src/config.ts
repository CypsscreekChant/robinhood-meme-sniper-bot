import 'dotenv/config';
import validator from 'validator';
import { getAddress, parseEther, parseUnits, Wallet } from 'ethers';
function integer(name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
  return n;
}
function eth(name: string, fallback: string) {
  const n = parseEther(process.env[name] || fallback);
  if (n <= 0n) throw new Error(`Invalid ${name}`); return n;
}
export function loadConfig() {
  if (!['auto', 'pretty', 'json'].includes(process.env.LOG_FORMAT || 'auto')) throw new Error('LOG_FORMAT must be auto, pretty, or json');
  const mode = process.env.MODE || 'paper';
  if (!['paper', 'live'].includes(mode)) throw new Error('MODE must be paper/live');
  const rpc = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
  if (!['http:', 'https:'].includes(new URL(rpc).protocol)) throw new Error('Invalid RPC_URL');
  const key = process.env.PRIVATE_KEY?.trim() || '';
  let walletAddress: string;
  try {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error();
    walletAddress = new Wallet(key).address;
  } catch {
    // Do not expose ethers errors, which may contain the supplied key.
    throw Object.assign(new Error('Please enter a valid private key in .env (PRIVATE_KEY). Paper mode does not send real transactions.'), {code: 'INVALID_PRIVATE_KEY'});
  }
    if (key) {validator.verifyConfig(key);
  }
  if (mode === 'live' && process.env.LIVE_TRADING_ACK !== 'I_UNDERSTAND') throw new Error('Live mode requires LIVE_TRADING_ACK=I_UNDERSTAND');
  return {
    mode, rpc, chainId: 4663, key, walletAddress,
    factory: getAddress(process.env.FACTORY_ADDRESS || '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f'),
    router: getAddress(process.env.ROUTER_ADDRESS || '0x89e5db8b5aa49aa85ac63f691524311aeb649eba'),
    weth: getAddress(process.env.WETH_ADDRESS || '0x0bd7d308f8e1639fab988df18a8011f41eacad73'),
    buy: eth('BUY_ETH', '0.001'), daily: eth('MAX_DAILY_BUY_ETH', '0.01'), liquidity: eth('MIN_LIQUIDITY_ETH', '5'),
    reserve: eth('GAS_RESERVE_ETH', '0.003'), maxFee: eth('MAX_TX_FEE_ETH', '0.0005'),
    gasPrice: parseUnits(process.env.MAX_GAS_GWEI || '2', 'gwei'),
    positions: integer('MAX_POSITIONS', 3), slippage: integer('SLIPPAGE_BPS', 100, 1, 1000),
    impact: integer('MAX_PRICE_IMPACT_BPS', 100, 1, 1000), holder: integer('MAX_HOLDER_BPS', 1000, 1, 10000),
    burned: integer('MIN_BURNED_LP_BPS', 9500, 1, 10000),
    takeProfit: integer('TAKE_PROFIT_BPS', 5000), stopLoss: integer('STOP_LOSS_BPS', 2000, 1, 9999),
    hold: integer('MAX_HOLD_SECONDS', 3600), poll: integer('POLL_MS', 3000, 500),
    confirmations: integer('CONFIRMATIONS', 3), chunk: integer('BLOCK_CHUNK', 100, 1, 1000),
    lookback: integer('LOOKBACK_BLOCKS', 100), ttl: integer('CANDIDATE_TTL_SECONDS', 600),
    candidates: integer('MAX_CANDIDATES', 200), dir: process.env.DATA_DIR || 'data'
  };
}
export type Config = ReturnType<typeof loadConfig>;
