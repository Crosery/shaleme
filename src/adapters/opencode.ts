import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, getHomeDir, querySqlite } from './base';

export class OpenCodeAdapter extends BaseAdapter {
  readonly id: HarnessId = 'opencode';
  readonly name = 'OpenCode';
  readonly icon = '🌐';
  readonly description = 'OpenCode 本地 SQLite 历史库 (~/.local/share/opencode)';

  private getDbPath(): string | null {
    const home = getHomeDir();
    const candidates = [
      path.join(home, '.local/share/opencode/opencode.db'),
    ];
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'opencode/opencode.db'));
    }

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  async check(): Promise<boolean> {
    const db = this.getDbPath();
    return db !== null && fs.existsSync(db);
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const dbPath = this.getDbPath();
    if (!dbPath) return;

    try {
      // Query messages that are from assistant
      const rows = querySqlite(
        dbPath,
        `SELECT m.id, m.session_id, m.time_created, m.data as msg_data, p.data as part_data
         FROM message m
         JOIN part p ON m.id = p.message_id
         ORDER BY m.time_created ASC`,
      );

      let count = 0;
      for (const row of rows) {
        try {
          const msgData = JSON.parse(row.msg_data || '{}');
          if (msgData.role !== 'assistant') continue;

          const partData = JSON.parse(row.part_data || '{}');
          let text = '';
          if (partData.type === 'text' && typeof partData.text === 'string') {
            text = partData.text;
          } else if (typeof partData.content === 'string') {
            text = partData.content;
          }

          text = text.trim();
          if (text) {
            count++;
            if (onProgress && count % 20 === 0) onProgress(count);
            yield {
              harness: this.id,
              sessionId: String(row.session_id),
              timestamp: Number(row.time_created) || Date.now(),
              model: msgData.model || 'opencode-model',
              text,
            };
          }
        } catch {
          // Ignore json parse error
        }
      }
    } catch {
      // Ignore DB error
    }
  }
}
