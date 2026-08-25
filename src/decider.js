const ACTIONS = ['silent', 'defer', 'note', 'webhook'];

function normalize(value, fallbackMs) {
  const action = ACTIONS.includes(value?.action) ? value.action : 'silent';
  return {
    action,
    reason: String(value?.reason || '没有足够理由打扰').slice(0, 500),
    content: String(value?.content || '').slice(0, 2000),
    defer_ms: Math.max(10_000, Math.min(86_400_000, Number(value?.defer_ms) || fallbackMs)),
  };
}
export async function decide({ trigger, observations, config }) {
  if (config.deciderMode !== 'openai-compatible') {
    const requested = trigger.payload?.suggested_action;
    return normalize({
      action: ACTIONS.includes(requested) ? requested : 'note',
      reason: '演示决策器：记录念头，但默认不向外发送',
      content: trigger.payload?.message || trigger.reason,
    }, config.defaultDeferMs);
  }
  if (!config.llmApiKey) throw new Error('LLM_API_KEY 未配置');
  const response = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.llmApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.llmModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是主动唤醒决策器。只输出 JSON。action 只能是 silent、defer、note、webhook。允许保持沉默；只有充分理由才能选择对外 webhook。字段：action, reason, content, defer_ms。' },
        { role: 'user', content: JSON.stringify({ trigger, observations }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status}`);
  const json = await response.json();
  return normalize(JSON.parse(json.choices?.[0]?.message?.content || '{}'), config.defaultDeferMs);
}
