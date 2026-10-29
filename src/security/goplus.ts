import { getGoPlusAuth } from './auth.js';
import { evaluateRisk } from './policy.js';
export async function checkGoPlus(token: string, pair: string, holder: number) {
  const body = await getGoPlusAuth().securityReport(token);
  if (!body.result?.[token.toLowerCase()]) throw new Error('Security data unavailable');
  return evaluateRisk(body.result[token.toLowerCase()], holder, [pair.toLowerCase(), '0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);
}
