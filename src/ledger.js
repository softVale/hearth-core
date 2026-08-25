import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class Ledger {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'events.jsonl');
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '', { mode: 0o600 });
  }

  append(type, data = {}, links = {}) {
    const event = {
      id: crypto.randomUUID(),
      type,
      at: new Date().toISOString(),
      trigger_id: links.triggerId || null,
      cycle_id: links.cycleId || null,
      data,
    };
    fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`);
    return event;
  }

  list(limit = 100) {
    const text = fs.readFileSync(this.file, 'utf8').trim();
    if (!text) return [];
    return text.split('\n').slice(-Math.min(500, Math.max(1, limit))).reverse().map((line) => JSON.parse(line));
  }
}
