import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, findFilesRecursively, forEachJsonLine, getHomeDir, querySqlite } from './base';

export class CodexAdapter extends BaseAdapter {
  readonly id: HarnessId = 'codex';
  readonly name = 'Codex';
  readonly icon = '🟢';
  readonly description = 'Codex CLI / Desktop 会话记录 (~/.codex)';

  private getCodexDir(): string {
    return path.join(getHomeDir(), '.codex');
  }

  async check(): Promise<boolean> {
    const dir = this.getCodexDir();
    return (
      fs.existsSync(path.join(dir, 'sessions')) ||
      fs.existsSync(path.join(dir, 'state_5.sqlite'))
    );
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const codexDir = this.getCodexDir();
    const sessionsDir = path.join(codexDir, 'sessions');
    const archivedDir = path.join(codexDir, 'archived_sessions');

    // Build threadId -> model mapping from state_5.sqlite if available
    const threadModels = new Map<string, string>();
    const dbPath = path.join(codexDir, 'state_5.sqlite');
    if (fs.existsSync(dbPath)) {
      try {
        const rows = querySqlite(dbPath, 'SELECT id, model FROM threads WHERE model IS NOT NULL');
        for (const row of rows) {
          if (row.id && row.model) {
            threadModels.set(String(row.id), String(row.model));
          }
        }
      } catch {
        // Fall back to jsonl parsing
      }
    }

    const files: string[] = [];
    if (fs.existsSync(sessionsDir)) {
      files.push(
        ...findFilesRecursively(sessionsDir, (_, name) => name.endsWith('.jsonl'), 6),
      );
    }
    if (fs.existsSync(archivedDir)) {
      files.push(
        ...findFilesRecursively(archivedDir, (_, name) => name.endsWith('.jsonl'), 6),
      );
    }

    let count = 0;
    for (const file of files) {
      const sessionId = path.basename(file, '.jsonl');
      let currentModel = threadModels.get(sessionId) || 'codex-model';
      const messagesInFile: ExtractedMessage[] = [];

      await forEachJsonLine(file, (data) => {
        // Track model from session_meta or turn_context
        if (data.type === 'session_meta' && data.payload?.model) {
          currentModel = data.payload.model;
        } else if (data.type === 'turn_context' && data.payload?.model) {
          currentModel = data.payload.model;
        }

        const payload = data.payload || {};
        const role = payload.role || data.role;
        const type = data.type;

        // Check if this is an assistant response
        const isAssistant =
          role === 'assistant' ||
          (type === 'response_item' && payload.type === 'message' && payload.role === 'assistant');

        if (!isAssistant) return;

        const rawTime = data.timestamp || payload.timestamp;
        const timestamp = rawTime ? new Date(rawTime).getTime() : Date.now();

        let text = '';
        const content = payload.content || data.content;

        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'string') {
              text += block + ' ';
            } else if (block && typeof block === 'object') {
              if (
                (block.type === 'output_text' || block.type === 'text') &&
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
          if (onProgress && count % 50 === 0) onProgress(count);
          messagesInFile.push({
            harness: this.id,
            sessionId,
            timestamp,
            model: currentModel,
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
