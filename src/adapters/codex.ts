import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import {
  AdapterWork,
  BaseAdapter,
  findFilesRecursively,
  forEachJsonLine,
  getHomeDir,
  querySqlite,
} from './base';

/**
 * Model names for codex live in `state_5.sqlite` keyed by thread id, while the
 * messages live in per-thread JSONL rollouts. The lookup is therefore built once
 * and passed to each file's parse as `context`.
 */
export interface CodexContext {
  threadModels: Record<string, string>;
}

export class CodexAdapter extends BaseAdapter {
  readonly id: HarnessId = 'codex';
  readonly name = 'Codex';
  readonly icon = 'Codex';
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

  private buildContext(): CodexContext {
    const threadModels: Record<string, string> = {};
    const dbPath = path.join(this.getCodexDir(), 'state_5.sqlite');
    if (fs.existsSync(dbPath)) {
      try {
        const rows = querySqlite(dbPath, 'SELECT id, model FROM threads WHERE model IS NOT NULL');
        for (const row of rows) {
          if (row.id && row.model) {
            threadModels[String(row.id)] = String(row.model);
          }
        }
      } catch {
        // Fall back to jsonl parsing
      }
    }
    return { threadModels };
  }

  private listFiles(): string[] {
    const codexDir = this.getCodexDir();
    const files: string[] = [];

    const sessionsDir = path.join(codexDir, 'sessions');
    if (fs.existsSync(sessionsDir)) {
      files.push(...findFilesRecursively(sessionsDir, (_, name) => name.endsWith('.jsonl'), 6));
    }

    const archivedDir = path.join(codexDir, 'archived_sessions');
    if (fs.existsSync(archivedDir)) {
      files.push(...findFilesRecursively(archivedDir, (_, name) => name.endsWith('.jsonl'), 6));
    }

    return files;
  }

  async listWork(): Promise<AdapterWork> {
    return { harness: this.id, files: this.listFiles(), context: this.buildContext() };
  }

  async parseFile(file: string, context?: CodexContext): Promise<ExtractedMessage[]> {
    const threadModels = context?.threadModels || {};

    // Extract thread UUID from rollout-2026-XX-XX-uuid.jsonl or filename
    const uuidMatch = file.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    const threadId = uuidMatch ? uuidMatch[0] : path.basename(file, '.jsonl');
    let currentModel = threadModels[threadId] || 'gpt-5.4';
    const messagesInFile: ExtractedMessage[] = [];

    await forEachJsonLine(file, (data) => {
      // Track model from session_meta or turn_context
      if (data.type === 'session_meta') {
        const metaId = data.payload?.id || data.payload?.session_id;
        if (metaId && threadModels[metaId]) {
          currentModel = threadModels[metaId];
        }
        if (data.payload?.model) {
          currentModel = data.payload.model;
        }
      } else if (data.type === 'turn_context') {
        const p = data.payload || {};
        if (p.model) {
          currentModel = p.model;
        } else if (p.collaboration_mode?.settings?.model) {
          currentModel = p.collaboration_mode.settings.model;
        } else if (p.info?.model) {
          currentModel = p.info.model;
        }
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
        messagesInFile.push({
          harness: this.id,
          sessionId: threadId,
          timestamp,
          model: currentModel,
          text,
        });
      }
    });

    return messagesInFile;
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const context = this.buildContext();
    let count = 0;
    for (const file of this.listFiles()) {
      for (const m of await this.parseFile(file, context)) {
        count++;
        if (onProgress && count % 50 === 0) onProgress(count);
        yield m;
      }
    }
  }
}
