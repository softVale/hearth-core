import path from 'node:path';

const integer = (name, fallback, min = 0) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
};
export const config = {
  port: integer('PORT', 3520, 1),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  adminToken: process.env.ADMIN_TOKEN || '',
  deciderMode: process.env.DECIDER_MODE || 'demo',
  llmBaseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || 'gpt-4.1-mini',
  allowedActions: new Set((process.env.ALLOWED_ACTIONS || 'silent,defer,note,webhook').split(',').map((x) => x.trim()).filter(Boolean)),
  minActionGapMs: integer('MIN_ACTION_GAP_SECONDS', 1200, 0) * 1000,
  dailyActionLimit: integer('DAILY_ACTION_LIMIT', 12, 1),
  defaultDeferMs: integer('DEFAULT_DEFER_SECONDS', 900, 10) * 1000,
  sweepIntervalMs: integer('SWEEP_INTERVAL_SECONDS', 900, 10) * 1000,
  activeSilenceMs: integer('ACTIVE_SILENCE_SECONDS', 1200, 0) * 1000,
  webhookUrl: process.env.WEBHOOK_URL || '',
};
