const ACTIONS = ['silent', 'defer', 'note', 'webhook'];
const extractJson = (text) => JSON.parse(String(text || '').match(/\{[\s\S]*\}/)?.[0] || '{}');

async function callModel({ config, system, input, maxTokens = 300 }) {
  if (!config.llmApiKey) throw new Error('LLM_API_KEY 未配置');
  const response = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.llmApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.llmModel, temperature: 0.2, max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] }),
  });
  if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status}`);
  const json = await response.json();
  return extractJson(json.choices?.[0]?.message?.content);
}

export async function arbitrate({ triggers, recentEvents, config }) {
  if (config.deciderMode !== 'openai-compatible') {
    const latest = triggers.at(-1);
    return { should_act: triggers.length > 0, suggested_action: latest?.data?.payload?.suggested_action || 'note',
      reason: triggers.length ? '演示仲裁器：发现尚未处理的新触发' : '没有新的触发，保持安静' };
  }
  const value = await callModel({ config, maxTokens: 180,
    system: '你是主动节奏仲裁器。只判断现在是否值得行动，不写最终内容。宁缺毋滥；没有新由头、最近已做过相似动作或信息不足时保持安静。只输出 JSON：{"should_act":true或false,"suggested_action":"silent|defer|note|webhook","reason":"简短理由"}。',
    input: { triggers, recent_events: recentEvents } });
  const suggested = ACTIONS.includes(value.suggested_action) ? value.suggested_action : 'silent';
  return { should_act: value.should_act === true && suggested !== 'silent', suggested_action: suggested,
    reason: String(value.reason || '没有足够理由行动').slice(0, 500) };
}

export async function decideAction({ arbitration, triggers, config }) {
  if (config.deciderMode !== 'openai-compatible') {
    const latest = triggers.at(-1);
    return normalize({ action: arbitration.suggested_action, reason: arbitration.reason,
      content: latest?.data?.payload?.message || latest?.data?.reason || arbitration.reason }, config.defaultDeferMs);
  }
  const value = await callModel({ config,
    system: '全局仲裁已经批准本轮行动。现在选择具体动作并产生内容。action 只能是 silent、defer、note、webhook；建议不是命令，你仍可选择沉默。只输出 JSON：{"action":"...","reason":"...","content":"...","defer_ms":900000}。',
    input: { arbitration, triggers } });
  return normalize(value, config.defaultDeferMs);
}

function normalize(value, fallbackMs) {
  const action = ACTIONS.includes(value?.action) ? value.action : 'silent';
  return { action, reason: String(value?.reason || '没有足够理由打扰').slice(0, 500),
    content: String(value?.content || '').slice(0, 2000),
    defer_ms: Math.max(10_000, Math.min(86_400_000, Number(value?.defer_ms) || fallbackMs)) };
}
