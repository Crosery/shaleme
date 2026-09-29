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

  private listFiles(): string[] {
    const sessionsDir = this.getSessionsDir();
    if (!fs.existsSync(sessionsDir)) return [];
    return findFilesRecursively(sessionsDir, (_, name) => name.endsWith('.jsonl'), 4);
  }

  async listWork(): Promise<AdapterWork> {
    return { harness: this.id, files: this.listFiles() };
  }

  /**
   * Parse one session file. `model_change` entries are self-contained per file,
   * so the running model carries within the file and nothing crosses files.
   */
  async parseFile(file: string): Promise<ExtractedMessage[]> {
    const sessionId = path.basename(file, '.jsonl');
    const messagesInFile: ExtractedMessage[] = [];
    let currentModel = 'omp-model';

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
      const timestamp =
        typeof rawTime === 'number' ? rawTime : rawTime ? new Date(rawTime).getTime() : Date.now();

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
    let count = 0;
    for (const file of this.listFiles()) {
      for (const m of await this.parseFile(file)) {
        count++;
        if (onProgress && count % 50 === 0) onProgress(count);
        yield m;
      }
    }
  }
}
