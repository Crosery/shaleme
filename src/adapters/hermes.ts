import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, findFilesRecursively, getHomeDir } from './base';

export class HermesAdapter extends BaseAdapter {
  readonly id: HarnessId = 'hermes';
  readonly name = 'Hermes';
  readonly icon = '🪽';
  readonly description = 'Hermes Agent 独立环境与会话转储 (~/.hermes)';

  private getHermesDir(): string {
    return path.join(getHomeDir(), '.hermes');
  }

  async check(): Promise<boolean> {
    return fs.existsSync(this.getHermesDir());
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const sessionsDir = path.join(this.getHermesDir(), 'sessions');
    if (!fs.existsSync(sessionsDir)) return;

    const files = findFilesRecursively(sessionsDir, (_, name) => name.endsWith('.json'), 2);
    let count = 0;

    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const data = JSON.parse(raw);
        const sessionId = data.session_id || path.basename(file, '.json');
        const model = data.model || 'hermes-model';

        // 1. Check messages array
        if (Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            if (msg && msg.role === 'assistant') {
              let text = '';
              if (typeof msg.content === 'string') {
                text = msg.content;
              } else if (Array.isArray(msg.content)) {
                for (const b of msg.content) {
                  if (typeof b === 'string') text += b + ' ';
                  else if (b?.type === 'text') text += b.text + ' ';
                }
              }
              text = text.trim();
              if (text) {
                count++;
                if (onProgress && count % 10 === 0) onProgress(count);
                yield {
                  harness: this.id,
                  sessionId,
                  timestamp: data.last_updated ? new Date(data.last_updated).getTime() : Date.now(),
                  model,
                  text,
                };
              }
            }
          }
        }

        // 2. Check request_dump or response items
        if (data.response && typeof data.response === 'object') {
          const resp = data.response;
          const choices = resp.choices || [];
          for (const c of choices) {
            const msg = c.message;
            if (msg && msg.role === 'assistant' && typeof msg.content === 'string') {
              count++;
              yield {
                harness: this.id,
                sessionId,
                timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
                model: resp.model || model,
                text: msg.content.trim(),
              };
            }
          }
        }
      } catch {
        // Ignore single parse error
      }
    }
  }
}
