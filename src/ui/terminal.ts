import {formatEther} from 'ethers';
import type {Config} from '../config.js';
import type {State} from '../state.js';

export type EventRecord = {time: string; event: string; details: Record<string, unknown>};
export interface View {
  config: Config; phase: string; started: number; now: number;
  cursor?: number; head?: number; scannedAt?: number; state?: State;
  events: EventRecord[]; counters: {pairs: number; rejected: number; buys: number; sells: number; errors: number};
}
export function clean(value: unknown): string {
  return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /private.?key|secret|authorization|access.?token|api.?token|app.?key|rpc.?url/i.test(k) ? '[REDACTED]' : redact(v)]));
  return typeof value === 'bigint' ? value.toString() : value;
}
const short = (s: string) => s.length > 20 ? `${s.slice(0,10)}...${s.slice(-8)}` : s;
const duration = (ms: number) => { const s=Math.max(0,Math.floor(ms/1000)); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
const units = (n: string | bigint) => formatEther(n);
function width(s: string) { return [...s].reduce((n,c)=>n+(/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff01-\uff60]/u.test(c)?2:1),0); }
function fit(s: string, limit: number) { let out='';for(const c of clean(s)){if(width(out+c)>limit-1)return out+'…';out+=c;}return out; }
export function eventText(record: EventRecord): string {
  const details=redact(record.details) as Record<string,unknown>;
  return `${new Date(record.time).toLocaleTimeString('en-GB',{hour12:false})}  ${record.event.toUpperCase()}  ` + Object.entries(details).map(([k,v])=>`${k}=${typeof v==='object'?JSON.stringify(v):clean(v)}`).join('  ');
}
export function renderDashboard(v: View, columns=100, rows=40, color=true): string {
  const w=Math.max(20,Math.min(106,columns-2));
  const paint=(s:string,n:number)=>color?`\x1b[${n}m${s}\x1b[0m`:s;
  const line=(text='',tone=37)=>paint('│ ',90)+paint(fit(text,w-4).padEnd(w-4-Math.max(0,width(fit(text,w-4))-fit(text,w-4).length)),tone)+paint(' │',90);
  const rule=()=>paint('├'+'─'.repeat(w-2)+'┤',90);
  const s=v.state,c=v.config;
  const spent=s?.day===new Date(v.now).toISOString().slice(0,10)?s.spent:'0';
  const age=v.scannedAt ? `${Math.floor((v.now-v.scannedAt)/1000)}s ago` : 'waiting for first scan';
  const stale=v.scannedAt && v.now-v.scannedAt>Math.max(c.poll*3,30000);
  const spin=['◐','◓','◑','◒'][Math.floor(v.now/1000)%4];
  const lines=[paint('╭'+'─'.repeat(w-2)+'╮',96),
    line('R / H     R O B I N H O O D   M E M E   S N I P E R',96),
    line('NEW POOLS  /  TOKEN SECURITY  /  DEFINED RISK',90),rule(),
    line(`${c.mode==='paper'?'PAPER MODE · NO REAL TRANSACTIONS':'LIVE MODE · REAL FUNDS'}     ${spin} ${v.phase.toUpperCase()}`,c.mode==='paper'?96:91),
    line(`Robinhood 4663  ·  Uniswap V2 / WETH  ·  Uptime ${duration(v.now-v.started)}`),
    line(`Wallet  ${c.walletAddress}`),rule(),
    line(`CHAIN     Scanned ${v.cursor ?? '—'}  /  Confirmed target ${v.head ?? '—'}`,96),
    line(`          Last scan ${age}${stale?' · DELAYED: check RPC / active operation':''}`,stale?93:90),
    line(`STRATEGY  Buy ${units(c.buy)} ETH  ·  Slippage ${c.slippage/100}%  ·  Min pool ${units(c.liquidity)} ETH`),
    line(`RISK      TP +${c.takeProfit/100}%  /  SL -${c.stopLoss/100}%  ·  Max hold ${c.hold}s`),
    line(`BUDGET    ${units(spent)} / ${units(c.daily)} ETH used today (UTC; entry principal)`),
    line(`QUEUE     ${s?.candidates.length ?? 0} candidates  ·  ${s?.positions.length ?? 0}/${c.positions} positions`),
    line(`SESSION   ${v.counters.pairs} pools  ·  ${v.counters.rejected} rejections  ·  ${v.counters.buys} buys  ·  ${v.counters.sells} sells  ·  ${v.counters.errors} errors`),rule()];
  if(s?.positions.length) {
    lines.push(line('OPEN POSITIONS  ·  Entry cost only; no live P&L',96));
    for(const p of s.positions.slice(0,Math.min(3,Math.max(0,rows-24)))) lines.push(line(`${short(p.token)}  ·  ${units(p.cost)} ETH  ·  held ${duration(v.now-p.opened)}`));
    lines.push(rule());
  }
  lines.push(line('RECENT EVENTS',96));
  const count=Math.max(1,Math.min(6,rows-lines.length-4));
  const events=v.events.slice(-count);
  if(!events.length)lines.push(line('Connecting to Robinhood Chain…',90));
  for(const e of events)lines.push(line(eventText(e),/fail|fatal|halt/.test(e.event)?91:/reject|stop/.test(e.event)?93:37));
  lines.push(rule(),line('Ctrl+C to stop  ·  Waiting for eligible pools is normal',90),paint('╰'+'─'.repeat(w-2)+'╯',96));
  if(rows<24 || columns<45) return [paint(`ROBINHOOD MEME SNIPER · ${c.mode.toUpperCase()} · ${v.phase}`,96),
    `Scanned: ${v.cursor??'—'} / ${v.head??'—'} · Last scan: ${age}`,
    `Candidates: ${s?.candidates.length??0} · Positions: ${s?.positions.length??0}/${c.positions}`,
    ...v.events.slice(-Math.max(0,rows-6)).map(eventText), 'Ctrl+C to stop'].slice(0,Math.max(1,rows-1)).map(x=>fit(x,columns-1)).join('\n');
  return lines.join('\n');
}
