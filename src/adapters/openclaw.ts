import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, findFilesRecursively, forEachJsonLine, getHomeDir } from './base';

export class OpenClawAdapter extends BaseAdapter {
  readonly id: HarnessId = 'openclaw';
  readonly name = 'OpenClaw';
  readonly icon = '🦞';
  readonly description = 'OpenClaw 自主代理与执行记录 (~/.openclaw)';

  private getDirs(): string[] {
    const home = getHomeDir();
    return [path.join(home, '.openclaw'), path.join(home, '.claw')].filter((d) => fs.existsSync(d));
  }

  async check(): Promise<boolean> {
    return this.getDirs().length > 0;
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const dirs = this.getDirs();
    let count = 0;

    for (const dir of dirs) {
      const files = findFilesRecursively(dir, (_, name) => name.endsWith('.json') || name.endsWith('.jsonl'), 4);

      for (const file of files) {
        const sessionId = path.basename(file, path.extname(file));

        if (file.endsWith('.jsonl')) {
          const messagesInFile: ExtractedMessage[] = [];
          await forEachJsonLine(file, (data) => {
            const role = data.role || data.type;
            if (role !== 'assistant') return;

            const model = data.model || 'openclaw-model';
            let text = '';
            if (typeof data.content === 'string') text = data.content;
            else if (typeof data.text === 'string') text = data.text;

            text = text.trim();
            if (text) {
              count++;
              if (onProgress && count % 10 === 0) onProgress(count);
              messagesInFile.push({
                harness: this.id,
                sessionId,
                timestamp: data.timestamp || Date.now(),
                model,
                text,
              });
            }
          });
          for (const m of messagesInFile) yield m;
        } else {
          // JSON
          try {
            const raw = fs.readFileSync(file, 'utf8');
            const data = JSON.parse(raw);
            const messages = Array.isArray(data) ? data : data.messages || data.history || [];

            for (const item of messages) {
              if (item && (item.role === 'assistant' || item.type === 'assistant')) {
                let text = '';
                if (typeof item.content === 'string') text = item.content;
                else if (typeof item.text === 'string') text = item.text;

                text = text.trim();
                if (text) {
                  count++;
                  if (onProgress && count % 10 === 0) onProgress(count);
                  yield {
                    harness: this.id,
                    sessionId,
                    timestamp: item.timestamp || Date.now(),
                    model: item.model || data.model || 'openclaw-model',
                    text,
                  };
                }
              }
            }
          } catch {
            // Ignore corrupted JSON
          }
        }
      }
    }
  }
}
