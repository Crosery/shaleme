import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, findFilesRecursively, forEachJsonLine, getHomeDir } from './base';

export class OmpAdapter extends BaseAdapter {
  readonly id: HarnessId = 'omp';
  readonly name = 'OMP (Oh My Prompt)';
  readonly icon = '⚡';
  readonly description = 'Oh My Prompt 架构与会话历史 (~/.omp)';

  private getSessionsDir(): string {
    return path.join(getHomeDir(), '.omp/agent/sessions');
  }

  async check(): Promise<boolean> {
    return fs.existsSync(this.getSessionsDir());
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const sessionsDir = this.getSessionsDir();
    if (!fs.existsSync(sessionsDir)) return;

    const files = findFilesRecursively(sessionsDir, (_, name) => name.endsWith('.jsonl'), 4);
    let count = 0;

    for (const file of files) {
      const sessionId = path.basename(file, '.jsonl');
      let currentModel = 'omp-model';
      const messagesInFile: ExtractedMessage[] = [];

      await forEachJsonLine(file, (data) => {
        if (data.type === 'model_change' && data.model) {
          currentModel = data.model;
        }

        if (data.type !== 'message' || !data.message) {
          return;
        }

        const msg = data.message;
        if (msg.role !== 'assistant') {
          return;
        }

        const model = msg.model || currentModel;
        const rawTime = msg.timestamp || data.timestamp;
        const timestamp = typeof rawTime === 'number' ? rawTime : (rawTime ? new Date(rawTime).getTime() : Date.now());

        let text = '';
        const content = msg.content;

        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'string') {
              text += block + ' ';
            } else if (block && typeof block === 'object') {
              // We focus on text responses to the user, not hidden internal thinking
              if (block.type === 'text' && typeof block.text === 'string') {
                text += block.text + ' ';
              }
            }
          }
        }

        text = text.trim();
        if (text) {
          count++;
          if (onProgress && count % 50 === 0) onProgress(count);
          messagesInFile.push({
            harness: this.id,
            sessionId,
            timestamp,
            model,
            text,
          });
        }
      });

      for (const m of messagesInFile) {
        yield m;
      }
    }
  }
}
