import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, findFilesRecursively, getHomeDir, querySqlite } from './base';

export class CursorAdapter extends BaseAdapter {
  readonly id: HarnessId = 'cursor';
  readonly name = 'Cursor';
  readonly icon = '🖱️';
  readonly description = 'Cursor 编辑器本地 Workspace Storage (~/Library/.../Cursor)';

  private getWorkspaceStorageDir(): string | null {
    const home = getHomeDir();
    const candidates = [
      path.join(home, 'Library/Application Support/Cursor/User/workspaceStorage'),
      path.join(home, '.config/Cursor/User/workspaceStorage'),
    ];
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'Cursor/User/workspaceStorage'));
    }

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  async check(): Promise<boolean> {
    const dir = this.getWorkspaceStorageDir();
    return dir !== null && fs.existsSync(dir);
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const storageDir = this.getWorkspaceStorageDir();
    if (!storageDir) return;

    const dbFiles = findFilesRecursively(storageDir, (_, name) => name === 'state.vscdb', 3);
    let count = 0;

    for (const dbPath of dbFiles) {
      const workspaceId = path.basename(path.dirname(dbPath));
      try {
        const rows = querySqlite(
          dbPath,
          "SELECT key, value FROM ItemTable WHERE key LIKE '%chat%' OR key LIKE '%composer%'",
        );

        for (const row of rows) {
          if (!row.value || typeof row.value !== 'string') continue;
          try {
            const data = JSON.parse(row.value);
            // Search for conversations or composer data
            const candidates: any[] = [];
            if (Array.isArray(data)) candidates.push(...data);
            else if (typeof data === 'object') {
              if (Array.isArray(data.tabs)) candidates.push(...data.tabs);
              if (Array.isArray(data.allComposers)) candidates.push(...data.allComposers);
              if (Array.isArray(data.conversations)) candidates.push(...data.conversations);
            }

            for (const item of candidates) {
              const bubbles = item.bubbles || item.messages || [];
              const model = item.modelType || item.selectedModel || 'cursor-model';

              for (const b of bubbles) {
                const isAssistant = b.type === 'ai' || b.speaker === 'ai' || b.role === 'assistant';
                if (!isAssistant) continue;

                let text = '';
                if (typeof b.text === 'string') text = b.text;
                else if (typeof b.rawText === 'string') text = b.rawText;
                else if (typeof b.content === 'string') text = b.content;

                text = text.trim();
                if (text) {
                  count++;
                  if (onProgress && count % 20 === 0) onProgress(count);
                  yield {
                    harness: this.id,
                    sessionId: workspaceId,
                    timestamp: b.timestamp || Date.now(),
                    model,
                    text,
                  };
                }
              }
            }
          } catch {
            // Ignore JSON decode error for single item
          }
        }
      } catch {
        // Ignore sqlite error for single workspace
      }
    }
  }
}
