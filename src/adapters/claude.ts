import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import {
  AdapterWork,
  BaseAdapter,
  findFilesRecursively,
  forEachJsonLine,
  getHomeDir,
} from './base';

export class ClaudeAdapter extends BaseAdapter {
  readonly id: HarnessId = 'claude';
  readonly name = 'Claude Code';
  readonly icon = 'Claude';
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

  private listFiles(): string[] {
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
        ...findFilesRecursively(
          projectsDir,
          (filePath, name) => {
            if (!name.endsWith('.jsonl')) return false;
            // Ignore self-referential shaleme / current workspace dev sessions to avoid counting our own explanation text
            if (filePath.includes('-Users-crosery-work-file-tmp') || filePath.includes('shaleme')) {
              return false;
            }
            return true;
          },
          3,
        ),
      );
    }

    return files;
  }

  async listWork(): Promise<AdapterWork> {
    return { harness: this.id, files: this.listFiles() };
  }

  /** Parse one transcript file. Session id comes from the filename, so this is self-contained. */
  async parseFile(file: string): Promise<ExtractedMessage[]> {
    const sessionId = path.basename(file, '.jsonl');
    const messagesInFile: ExtractedMessage[] = [];

    await forEachJsonLine(file, (data) => {
      const type = data.type || data.role;
      if (type !== 'assistant' && data.message?.role !== 'assistant') {
        return;
      }

      const msgObj = data.message || data;
      const model = msgObj.model || data.model || 'claude-code';
      if (model.startsWith('<') || model === 'synthetic') {
        return;
      }

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

    return messagesInFile;
  }

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
    let emitted = 0;
    for (const file of this.listFiles()) {
      for (const m of await this.parseFile(file)) {
        emitted++;
        if (onProgress && emitted % 50 === 0) onProgress(emitted);
        yield m;
      }
    }
  }
}
