import crypto from 'node:crypto';
import { decide } from './decider.js';

export class HearthCore {
  constructor({ ledger, config, now = () => Date.now() }) {
    this.ledger = ledger;
    this.config = config;
    this.now = now;
  }

  async wake({ source = 'manual', reason = '', payload = {} } = {}) {
    const cycleId = crypto.randomUUID();
    const trigger = this.ledger.append('trigger.received', { source, reason: String(reason).slice(0, 500), payload }, { cycleId });
    const observations = [{ source: 'trigger', summary: reason || '手动唤醒' }];
    this.ledger.append('observation.completed', { observations }, { triggerId: trigger.id, cycleId });

    let decision;
    try {
      decision = await decide({ trigger: trigger.data, observations, config: this.config });
      this.ledger.append('decision.made', decision, { triggerId: trigger.id, cycleId });
    } catch (error) {
      decision = { action: 'silent', reason: `决策失败，安全降级为沉默：${error.message}`, content: '' };
      this.ledger.append('decision.failed', decision, { triggerId: trigger.id, cycleId });
    }

    const gate = this.#govern(decision.action);
    this.ledger.append(gate.allowed ? 'governor.allowed' : 'governor.blocked', gate, { triggerId: trigger.id, cycleId });
    const result = gate.allowed
      ? await this.#execute(decision)
      : { ok: true, action: 'silent', outcome: gate.reason };
    this.ledger.append(result.ok ? 'action.completed' : 'action.failed', result, { triggerId: trigger.id, cycleId });
    return { ok: result.ok, cycle_id: cycleId, decision, gate, result };
  }

  #govern(action) {
    if (!this.config.allowedActions.has(action)) return { allowed: false, reason: `动作 ${action} 未获授权` };
    if (action === 'silent' || action === 'defer') return { allowed: true, reason: '非打扰动作' };
    const actions = this.ledger.list(500).filter((e) => e.type === 'action.completed' && !['silent', 'defer'].includes(e.data.action));
    const latest = actions[0];
    if (latest && this.now() - Date.parse(latest.at) < this.config.minActionGapMs) return { allowed: false, reason: '全局冷却中' };
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (actions.filter((e) => e.at.startsWith(today)).length >= this.config.dailyActionLimit) return { allowed: false, reason: '达到每日主动上限' };
    return { allowed: true, reason: '通过权限、冷却和每日上限检查' };
  }

  async #execute(decision) {
    if (decision.action === 'silent') return { ok: true, action: 'silent', outcome: decision.reason };
    if (decision.action === 'defer') return { ok: true, action: 'defer', outcome: `延后 ${decision.defer_ms}ms` };
    if (decision.action === 'note') return { ok: true, action: 'note', outcome: '念头已留在事件流水中', content: decision.content };
    if (decision.action === 'webhook') {
      if (!this.config.webhookUrl) return { ok: false, action: 'webhook', outcome: 'WEBHOOK_URL 未配置' };
      try {
        const response = await fetch(this.config.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: decision.content, reason: decision.reason }) });
        return { ok: response.ok, action: 'webhook', outcome: `HTTP ${response.status}` };
      } catch (error) {
        return { ok: false, action: 'webhook', outcome: error.message };
      }
    }
    return { ok: false, action: decision.action, outcome: '未知动作' };
  }
}
