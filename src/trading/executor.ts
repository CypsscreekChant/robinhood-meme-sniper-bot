import { Contract, Wallet, keccak256, type TransactionRequest } from 'ethers';
import { tokenAbi } from '../abi.js';
import { V2Dex } from '../dex/v2.js';
import { Store, type Candidate, type Position } from '../state.js';
import { minimumOut } from './rules.js';
import { log } from '../log.js';
export class Executor {
  wallet?: Wallet;
  constructor(public dex: V2Dex, public store: Store) {
    if (dex.config.mode === 'live') this.wallet = new Wallet(dex.config.key, dex.provider);
  }
  async transact(kind: string, request: TransactionRequest) {
    if (this.dex.config.mode !== 'live' || !this.wallet) throw new Error('Live execution is disabled');
    const c = this.dex.config;
    const fees = await this.dex.provider.getFeeData();
    const gasPrice = fees.gasPrice;
    if (!gasPrice || gasPrice <= 0n || gasPrice > c.gasPrice) throw new Error('Gas price limit');
    const gasLimit = (await this.wallet.estimateGas(request)) * 120n / 100n;
    if (gasPrice * gasLimit > c.maxFee) throw new Error('Transaction fee limit');
    if (await this.dex.provider.getBalance(this.wallet.address) < BigInt(request.value?.toString() || '0') + gasLimit * gasPrice + c.reserve) throw new Error('Insufficient gas reserve');
    const nonce = await this.dex.provider.getTransactionCount(this.wallet.address, 'pending');
    if (nonce !== await this.dex.provider.getTransactionCount(this.wallet.address, 'latest')) throw new Error('Wallet has pending transactions');
    const raw = await this.wallet.signTransaction({...request, nonce, chainId: 4663, type: 0, gasLimit, gasPrice});
    // Persist hash before broadcasting. An ambiguous result always blocks further trading.
    this.store.state.pending = {kind, hash: keccak256(raw), time: Date.now()}; this.store.save();
    const sent = await this.dex.provider.broadcastTransaction(raw);
    log('transaction_submitted', {kind, hash: sent.hash});
    const receipt = await this.dex.provider.waitForTransaction(sent.hash, c.confirmations, 120000);
    if (!receipt || receipt.status !== 1) throw new Error('Transaction unresolved or reverted: inspect pending journal');
    return receipt;
  }
  async buy(candidate: Candidate) {
    const c = this.dex.config, s = this.store.state;
    if (c.mode === 'live' && !this.wallet) throw new Error('No live signer');
    this.store.daily();
    if (s.pending || s.positions.length >= c.positions || BigInt(s.spent) + c.buy > c.daily || s.seen.includes(candidate.token.toLowerCase())) return false;
    const quote = await this.dex.quote(c.buy, candidate.token, true);
    const amountMin = minimumOut(quote, c.slippage);
    let received = amountMin; // Conservative paper entry; not a transaction simulation.
    if (c.mode === 'live' && this.wallet) {
      const token = new Contract(candidate.token, tokenAbi, this.dex.provider);
      const before = BigInt(await token.balanceOf(this.wallet.address));
      const router = this.dex.router.connect(this.wallet) as Contract;
      const args = [amountMin, [c.weth, candidate.token], this.wallet.address, Math.floor(Date.now()/1000) + 120];
      await router.swapExactETHForTokens.staticCall(...args, {value: c.buy});
      await this.transact('buy:' + candidate.token, await router.swapExactETHForTokens.populateTransaction(...args, {value: c.buy}));
      received = BigInt(await token.balanceOf(this.wallet.address)) - before;
      if (received < amountMin) throw new Error('Unexpected received balance; pending journal retained');
    }
    s.positions.push({pair: candidate.pair, token: candidate.token, amount: received.toString(), cost: c.buy.toString(), opened: Date.now()});
    s.spent = (BigInt(s.spent) + c.buy).toString(); s.seen.push(candidate.token.toLowerCase());
    delete s.pending; this.store.save();
    log('buy', {mode: c.mode, token: candidate.token, amount: received, costWei: c.buy}); return true;
  }
  async sell(position: Position, reason: string) {
    const c = this.dex.config, s = this.store.state;
    if (c.mode === 'live' && !this.wallet) throw new Error('No live signer');
    let amount = BigInt(position.amount);
    if (c.mode === 'live' && this.wallet) {
      const token = new Contract(position.token, tokenAbi, this.wallet);
      const balance = BigInt(await token.balanceOf(this.wallet.address));
      if (balance < amount) throw new Error('Position balance mismatch');
      if (BigInt(await token.allowance(this.wallet.address, c.router)) < amount) {
        if (BigInt(await token.allowance(this.wallet.address, c.router)) !== 0n) {
          await this.transact('approve-reset:' + position.token, await token.approve.populateTransaction(c.router, 0n));
          delete s.pending; this.store.save();
        }
        await this.transact('approve:' + position.token, await token.approve.populateTransaction(c.router, amount));
        delete s.pending; this.store.save();
      }
    }
    const quote = await this.dex.quote(amount, position.token, false);
    const min = minimumOut(quote, c.slippage);
    if (c.mode === 'live' && this.wallet) {
      const router = this.dex.router.connect(this.wallet) as Contract;
      const args = [amount, min, [position.token, c.weth], this.wallet.address, Math.floor(Date.now()/1000) + 120];
      await router.swapExactTokensForETH.staticCall(...args);
      await this.transact('sell:' + position.token, await router.swapExactTokensForETH.populateTransaction(...args));
    }
    s.positions = s.positions.filter(p => p !== position); delete s.pending; this.store.save();
    log('sell', {mode: c.mode, token: position.token, reason, quotedMinimumWei: min, costWei: position.cost});
  }
}
