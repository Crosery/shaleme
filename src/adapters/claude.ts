import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, findFilesRecursively, forEachJsonLine, getHomeDir } from './base';

export class ClaudeAdapter extends BaseAdapter {
  readonly id: HarnessId = 'claude';
  readonly name = 'Claude Code';
  readonly icon = '🟣';
  readonly description = 'Claude Code CLI 会话与项目记录 (~/.claude)';

  private getTranscriptsDir(): string {
    return path.join(getHomeDir(), '.claude/transcripts');
  }

  private getProjectsDir(): string {
    return path.join(getHomeDir(), '.claude/projects');
  }

  async check(): Promise<boolean> {
    return fs.existsSync(this.getTranscriptsDir()) || fs.existsSync(this.getProjectsDir());
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    const files: string[] = [];

    const transcriptsDir = this.getTranscriptsDir();
    if (fs.existsSync(transcriptsDir)) {
      files.push(
        ...findFilesRecursively(transcriptsDir, (_, name) => name.endsWith('.jsonl'), 2),
      );
    }

    const projectsDir = this.getProjectsDir();
    if (fs.existsSync(projectsDir)) {
      files.push(
        ...findFilesRecursively(projectsDir, (_, name) => name.endsWith('.jsonl'), 3),
      );
    }

    let emitted = 0;
    for (const file of files) {
      const sessionId = path.basename(file, '.jsonl');

      await forEachJsonLine(file, (data) => {
        // Claude assistant message structures:
        // 1. { type: "assistant", message: { model: "...", content: [{ type: "text", text: "..." }] } }
        // 2. { type: "assistant", text: "..." }
        // 3. { role: "assistant", content: "..." }
        const type = data.type || data.role;
        if (type !== 'assistant' && data.message?.role !== 'assistant') {
          return;
        }

        const msgObj = data.message || data;
        const model = msgObj.model || data.model || 'claude-code';
        const rawTime = data.timestamp || msgObj.timestamp;
        const timestamp = rawTime ? new Date(rawTime).getTime() : Date.now();

        let text = '';
        const content = msgObj.content ?? data.content;

        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'string') {
              text += block + ' ';
            } else if (block && typeof block === 'object') {
              if (block.type === 'text' && typeof block.text === 'string') {
                text += block.text + ' ';
              } else if (typeof block.content === 'string') {
                text += block.content + ' ';
              }
            }
          }
        }

        text = text.trim();
        if (text) {
          emitted++;
          if (onProgress && emitted % 20 === 0) onProgress(emitted);
          return {
            harness: this.id,
            sessionId,
            timestamp,
            model,
            text,
          };
        }
      });
    }

    // Now yield all from file pass
    // To allow true streaming through the async generator:
    for (const file of files) {
      const sessionId = path.basename(file, '.jsonl');
      const messagesInFile: ExtractedMessage[] = [];

      await forEachJsonLine(file, (data) => {
        const type = data.type || data.role;
        if (type !== 'assistant' && data.message?.role !== 'assistant') {
          return;
        }

        const msgObj = data.message || data;
        const model = msgObj.model || data.model || 'claude-code';
        const rawTime = data.timestamp || msgObj.timestamp;
        const timestamp = rawTime ? new Date(rawTime).getTime() : Date.now();

        let text = '';
        const content = msgObj.content ?? data.content;

        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'string') {
              text += block + ' ';
            } else if (block && typeof block === 'object') {
              if (block.type === 'text' && typeof block.text === 'string') {
                text += block.text + ' ';
              } else if (typeof block.content === 'string') {
                text += block.content + ' ';
              }
            }
          }
        }

        text = text.trim();
        if (text) {
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
