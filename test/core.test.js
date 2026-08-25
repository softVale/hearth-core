import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Ledger } from '../src/ledger.js';
import { HearthCore } from '../src/core.js';

const make = (overrides = {}) => {
  const root = path.resolve('test/.tmp');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'hearth-core-'));
  const config = { deciderMode: 'demo', defaultDeferMs: 900_000, activeSilenceMs: 1_200_000, allowedActions: new Set(['silent','defer','note','webhook']), minActionGapMs: 300_000, dailyActionLimit: 12, webhookUrl: '', ...overrides };
  const ledger = new Ledger(dir);
  return { core: new HearthCore({ ledger, config }), ledger };
};

test('一次唤醒形成完整可关联流水', async () => {
  const { core, ledger } = make();
  const result = await core.wake({ reason: '测试念头', payload: { suggested_action: 'note' } });
  assert.equal(result.ok, true);
  const events = ledger.list();
  assert.deepEqual(events.map((e) => e.type).reverse(), ['trigger.received','sweep.started','arbitration.approved','observation.completed','decision.made','governor.allowed','action.completed']);
  assert.equal(new Set(events.filter((e) => e.cycle_id).map((e) => e.cycle_id)).size, 1);
});

test('未授权动作被治理层拦截并安全沉默', async () => {
  const { core, ledger } = make({ allowedActions: new Set(['silent']) });
  const result = await core.wake({ reason: '测试', payload: { suggested_action: 'note' } });
  assert.equal(result.gate.allowed, false);
  assert.equal(ledger.list().some((e) => e.type === 'governor.blocked'), true);
});

test('单轨 sweep 先过静默门，触发仍可在之后被仲裁', async () => {
  let now = Date.now();
  const { core, ledger } = make();
  core.now = () => now;
  core.trigger({ source: 'user_activity', reason: '用户刚刚还在聊天', payload: { active: true } });
  const blocked = await core.sweep();
  assert.equal(blocked.gate.allowed, false);
  now += 1_201_000;
  const approved = await core.sweep();
  assert.equal(approved.arbitration.should_act, true);
  assert.equal(ledger.list().filter((e) => e.type === 'action.completed').length, 1);
});
