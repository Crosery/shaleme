import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, findFilesRecursively, getHomeDir } from './base';

export class ClineAdapter extends BaseAdapter {
  readonly id: HarnessId = 'cline';
  readonly name = 'Cline / Roo Code';
  readonly icon = '🧭';
  readonly description = 'VSCode & Cursor 中的 Cline / Roo Code 任务历史';

  private getCandidateDirs(): string[] {
    const home = getHomeDir();
    const dirs: string[] = [];

    // macOS paths
    dirs.push(
      path.join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks'),
      path.join(home, 'Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/tasks'),
      path.join(home, 'Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks'),
      path.join(home, '.cline/tasks'),
    );

    // Linux paths
    dirs.push(
      path.join(home, '.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks'),
      path.join(home, '.config/Cursor/User/globalStorage/saoudrizwan.claude-dev/tasks'),
      path.join(home, '.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks'),
    );

    // Windows paths
    if (process.env.APPDATA) {
      dirs.push(
        path.join(process.env.APPDATA, 'Code/User/globalStorage/saoudrizwan.claude-dev/tasks'),
        path.join(process.env.APPDATA, 'Cursor/User/globalStorage/saoudrizwan.claude-dev/tasks'),
        path.join(process.env.APPDATA, 'Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks'),
      );
    }

    return dirs.filter((d) => fs.existsSync(d));
  }

  async check(): Promise<boolean> {
    return this.getCandidateDirs().length > 0;
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const candidateDirs = this.getCandidateDirs();
    let count = 0;

    for (const dir of candidateDirs) {
      const historyFiles = findFilesRecursively(
        dir,
        (_, name) => name === 'api_conversation_history.json' || name === 'ui_messages.json',
        3,
      );

      for (const file of historyFiles) {
        const taskId = path.basename(path.dirname(file));
        try {
          const raw = fs.readFileSync(file, 'utf8');
          const data = JSON.parse(raw);
          if (!Array.isArray(data)) continue;

          for (const item of data) {
            // 1. api_conversation_history.json format
            if (item.role === 'assistant') {
              let text = '';
              const content = item.content;
              if (typeof content === 'string') {
                text = content;
              } else if (Array.isArray(content)) {
                for (const b of content) {
                  if (typeof b === 'string') text += b + ' ';
                  else if (b && b.type === 'text') text += b.text + ' ';
                }
              }
              text = text.trim();
              if (text) {
                count++;
                if (onProgress && count % 20 === 0) onProgress(count);
                yield {
                  harness: this.id,
                  sessionId: taskId,
                  timestamp: item.ts || Date.now(),
                  model: item.model || 'cline-model',
                  text,
                };
              }
            }

            // 2. ui_messages.json format
            if (item.type === 'say' && item.say === 'text' && typeof item.text === 'string') {
              count++;
              if (onProgress && count % 20 === 0) onProgress(count);
              yield {
                harness: this.id,
                sessionId: taskId,
                timestamp: item.ts || Date.now(),
                model: 'cline-model',
                text: item.text,
              };
            }
          }
        } catch {
          // Ignore individual corrupted task files
        }
      }
    }
  }
}
