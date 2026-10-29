import { Contract, JsonRpcProvider, ZeroAddress } from 'ethers';
import { factoryAbi, pairAbi, routerAbi } from '../abi.js';
import type { Config } from '../config.js';
export class V2Dex {
  factory: Contract; router: Contract;
  constructor(public provider: JsonRpcProvider, public config: Config) {
    this.factory = new Contract(config.factory, factoryAbi, provider);
    this.router = new Contract(config.router, routerAbi, provider);
  }
  async preflight() {
    if (Number((await this.provider.getNetwork()).chainId) !== 4663) throw new Error('Wrong chain');
    for (const a of [this.config.factory, this.config.router, this.config.weth]) if (await this.provider.getCode(a) === '0x') throw new Error('Missing contract');
    if ((await this.router.factory()).toLowerCase() !== this.config.factory.toLowerCase() || (await this.router.WETH()).toLowerCase() !== this.config.weth.toLowerCase()) throw new Error('Router mismatch');
  }
  async inspect(pair: string, token: string) {
    const p = new Contract(pair, pairAbi, this.provider);
    const [t0, t1, factory, reserves, supply, burned0, burned1] = await Promise.all([p.token0(), p.token1(), p.factory(), p.getReserves(), p.totalSupply(), p.balanceOf(ZeroAddress), p.balanceOf('0x000000000000000000000000000000000000dEaD')]);
    const lower = [t0.toLowerCase(), t1.toLowerCase()];
    if (!lower.includes(token.toLowerCase()) || !lower.includes(this.config.weth.toLowerCase()) || factory.toLowerCase() !== this.config.factory.toLowerCase() || (await this.factory.getPair(token, this.config.weth)).toLowerCase() !== pair.toLowerCase()) throw new Error('Pair mismatch');
    if (await this.provider.getCode(token) === '0x') throw new Error('Missing token');
    return { eth: BigInt(reserves[t0.toLowerCase() === this.config.weth.toLowerCase() ? 0 : 1]), burnedBps: supply > 0n ? (burned0 + burned1) * 10000n / supply : 0n };
  }
  async quote(amount: bigint, token: string, buy: boolean) {
    const path = buy ? [this.config.weth, token] : [token, this.config.weth];
    const amounts = await this.router.getAmountsOut(amount, path); const out = BigInt(amounts[1]);
    if (out <= 0n) throw new Error('Empty quote'); return out;
  }
}
