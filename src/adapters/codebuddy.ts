import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, findFilesRecursively, forEachJsonLine, getHomeDir, querySqlite } from './base';

export class CodeBuddyAdapter extends BaseAdapter {
  readonly id: HarnessId = 'codebuddy';
  readonly name = 'CodeBuddy / WorkBuddy';
  readonly icon = '🤖';
  readonly description = 'CodeBuddy & WorkBuddy 团队编码助手 (~/.workbuddy, ~/.codebuddy)';

  private getDirs(): string[] {
    const home = getHomeDir();
    return [path.join(home, '.workbuddy'), path.join(home, '.codebuddy')];
  }

  async check(): Promise<boolean> {
    return this.getDirs().some((d) => fs.existsSync(d));
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const dirs = this.getDirs();
    const sessionModels = new Map<string, string>();

    // Check workbuddy.db for model names
    const workbuddyDb = path.join(getHomeDir(), '.workbuddy/workbuddy.db');
    if (fs.existsSync(workbuddyDb)) {
      try {
        const rows = querySqlite(workbuddyDb, 'SELECT id, model FROM sessions WHERE model IS NOT NULL');
        for (const row of rows) {
          if (row.id && row.model) {
            sessionModels.set(String(row.id), String(row.model));
          }
        }
      } catch {
        // Fall back to jsonl parsing
      }
    }

    const files: string[] = [];
    for (const dir of dirs) {
      if (fs.existsSync(dir)) {
        files.push(
          ...findFilesRecursively(dir, (filePath, name) => {
            return name.endsWith('.jsonl') && (filePath.includes('/projects/') || filePath.includes('/sessions/'));
          }, 4),
        );
      }
    }

    let count = 0;
    for (const file of files) {
      const sessionId = path.basename(file, '.jsonl');
      const defaultModel = sessionModels.get(sessionId) || 'workbuddy-model';
      const messagesInFile: ExtractedMessage[] = [];

      await forEachJsonLine(file, (data) => {
        const role = data.role || data.type || data.message?.role;
        const isAssistant = role === 'assistant' || data.message?.role === 'assistant';
        if (!isAssistant) return;

        const model = data.model || data.message?.model || defaultModel;
        const rawTime = data.timestamp || data.message?.timestamp;
        const timestamp = typeof rawTime === 'number' ? rawTime : (rawTime ? new Date(rawTime).getTime() : Date.now());

        let text = '';
        const content = data.content ?? data.message?.content;

        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'string') {
              text += block + ' ';
            } else if (block && typeof block === 'object') {
              if (
                (block.type === 'text' || block.type === 'output_text') &&
                typeof block.text === 'string'
              ) {
                text += block.text + ' ';
              }
            }
          }
        }

        text = text.trim();
        if (text) {
          count++;
          if (onProgress && count % 20 === 0) onProgress(count);
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
