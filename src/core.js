import crypto from 'node:crypto';
import { arbitrate, decideAction } from './decider.js';

export class HearthCore {
  constructor({ ledger, config, now = () => Date.now() }) {
    this.ledger = ledger; this.config = config; this.now = now; this.running = false;
  }

  trigger({ source = 'manual', reason = '', payload = {} } = {}) {
    return this.ledger.append('trigger.received', { source, reason: String(reason).slice(0, 500), payload });
  }

  async wake(input = {}) {
    const trigger = this.trigger(input);
    return this.sweep({ force: true, triggerIds: [trigger.id] });
  }

  async sweep({ force = false, triggerIds = null } = {}) {
    if (this.running) return { ok: false, skipped: true, reason: '已有仲裁正在运行' };
    this.running = true;
    const cycleId = crypto.randomUUID();
    try {
      const pending = this.#pendingTriggers(triggerIds);
      this.ledger.append('sweep.started', { pending_count: pending.length, forced: force }, { cycleId });
      if (!pending.length) return this.#pass(cycleId, [], '没有尚未处理的新触发');
      const gate = this.#preArbitrationGate(force);
      if (!gate.allowed) {
        this.ledger.append('governor.blocked', { ...gate, trigger_ids: pending.map((x) => x.id) }, { cycleId });
        return { ok: true, cycle_id: cycleId, skipped: true, gate };
      }
      let arbitration;
      try {
        arbitration = await arbitrate({ triggers: pending, recentEvents: this.ledger.list(30), config: this.config });
        this.ledger.append(arbitration.should_act ? 'arbitration.approved' : 'arbitration.passed',
          { ...arbitration, trigger_ids: pending.map((x) => x.id) }, { cycleId });
      } catch (error) {
        return this.#pass(cycleId, pending, `仲裁失败，安全保持安静：${error.message}`, 'arbitration.failed');
      }
      if (!arbitration.should_act) return { ok: true, cycle_id: cycleId, arbitration, skipped: true };
      const observations = pending.map((x) => ({ source: x.data.source, summary: x.data.reason }));
      this.ledger.append('observation.completed', { observations }, { cycleId });
      let decision;
      try {
        decision = await decideAction({ arbitration, triggers: pending, config: this.config });
        this.ledger.append('decision.made', decision, { cycleId });
      } catch (error) {
        decision = { action: 'silent', reason: `动作决策失败：${error.message}`, content: '' };
        this.ledger.append('decision.failed', decision, { cycleId });
      }
      const actionGate = this.#governAction(decision.action);
      this.ledger.append(actionGate.allowed ? 'governor.allowed' : 'governor.blocked', actionGate, { cycleId });
      const result = actionGate.allowed ? await this.#execute(decision) : { ok: true, action: 'silent', outcome: actionGate.reason };
      this.ledger.append(result.ok ? 'action.completed' : 'action.failed', result, { cycleId });
      return { ok: result.ok, cycle_id: cycleId, arbitration, decision, gate: actionGate, result };
    } finally { this.running = false; }
  }

  #pendingTriggers(onlyIds) {
    const events = this.ledger.list(500);
    const consumed = new Set(events.filter((e) => e.type.startsWith('arbitration.')).flatMap((e) => e.data.trigger_ids || []));
    const allowed = onlyIds ? new Set(onlyIds) : null;
    return events.filter((e) => e.type === 'trigger.received' && !consumed.has(e.id) && (!allowed || allowed.has(e.id))).reverse();
  }

  #preArbitrationGate(force) {
    if (force) return { allowed: true, reason: '手动强制仲裁（仍不能绕过动作权限）' };
    const events = this.ledger.list(500);
    const lastActivity = events.find((e) => e.type === 'trigger.received' && (e.data.source === 'user_activity' || e.data.payload?.active === true));
    if (lastActivity && this.now() - Date.parse(lastActivity.at) < this.config.activeSilenceMs) return { allowed: false, reason: '最近仍有用户活动，进入静默门' };
    const lastWrite = events.find((e) => e.type === 'action.completed' && !['silent', 'defer'].includes(e.data.action));
    if (lastWrite && this.now() - Date.parse(lastWrite.at) < this.config.minActionGapMs) return { allowed: false, reason: '写入动作冷却中' };
    return { allowed: true, reason: '进入全局仲裁' };
  }

  #pass(cycleId, triggers, reason, type = 'arbitration.passed') {
    const arbitration = { should_act: false, suggested_action: 'silent', reason, trigger_ids: triggers.map((x) => x.id) };
    this.ledger.append(type, arbitration, { cycleId });
    return { ok: true, cycle_id: cycleId, arbitration, skipped: true };
  }

  #governAction(action) {
    if (!this.config.allowedActions.has(action)) return { allowed: false, reason: `动作 ${action} 未获授权` };
    if (action === 'silent' || action === 'defer') return { allowed: true, reason: '非打扰动作' };
    const actions = this.ledger.list(500).filter((e) => e.type === 'action.completed' && !['silent', 'defer'].includes(e.data.action));
    const latest = actions[0];
    if (latest && this.now() - Date.parse(latest.at) < this.config.minActionGapMs) return { allowed: false, reason: '写入动作冷却中' };
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (actions.filter((e) => e.at.startsWith(today)).length >= this.config.dailyActionLimit) return { allowed: false, reason: '达到每日主动上限' };
    return { allowed: true, reason: '通过动作权限、冷却和每日上限检查' };
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
      } catch (error) { return { ok: false, action: 'webhook', outcome: error.message }; }
    }
    return { ok: false, action: decision.action, outcome: '未知动作' };
  }
}
