export const riskFields = ['is_honeypot','cannot_buy','cannot_sell_all','is_proxy','is_mintable','hidden_owner','can_take_back_ownership','owner_change_balance','selfdestruct','external_call','transfer_pausable','is_blacklisted','is_whitelisted','slippage_modifiable','personal_slippage_modifiable','trading_cooldown'];
export function evaluateRisk(data: Record<string, unknown>, maxHolderBps: number, exclusions: string[]) {
  const reasons: string[] = [];
  if (data.is_open_source !== '1') reasons.push('源码未验证或未知');
  for (const field of riskFields) if (data[field] !== '0') reasons.push(`${field}: 风险或数据缺失`);
  for (const field of ['buy_tax','sell_tax']) {
    const v = data[field];
    if (typeof v !== 'string' || !/^0(?:\.0+)?$/.test(v)) reasons.push(`${field}: 仅允许明确零税代币`);
  }
  if (!Array.isArray(data.holders) || data.holders.length === 0) reasons.push('持有人数据缺失');
  else for (const h of data.holders) {
    if (!h || typeof h.address !== 'string' || typeof h.percent !== 'string' || !/^\d+(?:\.\d+)?$/.test(h.percent) || Number(h.percent) > 1) { reasons.push('持有人数据无效'); continue; }
    if (!exclusions.includes(h.address.toLowerCase()) && Number(h.percent) * 10000 > maxHolderBps) reasons.push('大户集中度超限');
  }
  return reasons;
}
