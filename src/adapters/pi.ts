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

export class PiAdapter extends BaseAdapter {
  readonly id: HarnessId = 'pi';
  readonly name = 'Pi Agent';
  readonly icon = '🥧';
  readonly description = 'Pi Harness 代理会话与工作流 (~/.pi)';

  private getPiDir(): string {
    return path.join(getHomeDir(), '.pi');
  }

  async check(): Promise<boolean> {
    const dir = this.getPiDir();
    return (
      fs.existsSync(path.join(dir, 'agent/sessions')) ||
      fs.existsSync(path.join(dir, 'sessions')) ||
      fs.existsSync(path.join(dir, 'workflows'))
    );
  }

  private listFiles(): string[] {
    const piDir = this.getPiDir();
    const files: string[] = [];

    const agentSessions = path.join(piDir, 'agent/sessions');
    if (fs.existsSync(agentSessions)) {
      files.push(...findFilesRecursively(agentSessions, (_, name) => name.endsWith('.jsonl'), 4));
    }

    const generalSessions = path.join(piDir, 'sessions');
    if (fs.existsSync(generalSessions)) {
      files.push(...findFilesRecursively(generalSessions, (_, name) => name.endsWith('.jsonl'), 4));
    }

    const runsDir = path.join(piDir, 'workflows');
    if (fs.existsSync(runsDir)) {
      files.push(
        ...findFilesRecursively(
          runsDir,
          (_, name) => name.endsWith('.json') && !name.endsWith('.bak'),
          5,
        ),
      );
    }

    return files;
  }

  async listWork(): Promise<AdapterWork> {
    return { harness: this.id, files: this.listFiles() };
  }

  /** Parse one file, dispatching on kind: workflow run JSON vs session JSONL. */
  async parseFile(file: string): Promise<ExtractedMessage[]> {
    return file.endsWith('.json') ? this.parseWorkflowRun(file) : this.parseSession(file);
  }

  private parseWorkflowRun(runFile: string): ExtractedMessage[] {
    const out: ExtractedMessage[] = [];
    try {
      const data = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      const runId = data.runId || path.basename(runFile, '.json');
      const journal = data.journal;

      if (Array.isArray(journal)) {
        for (const entry of journal) {
          if (entry && typeof entry.result === 'string') {
            out.push({
              harness: this.id,
              sessionId: runId,
              timestamp: Date.now(),
              model: 'pi-workflow-agent',
              text: entry.result,
            });
          }
        }
      }
    } catch {
      // Ignore parse errors on individual workflow files
    }
    return out;
  }

  private async parseSession(file: string): Promise<ExtractedMessage[]> {
    const sessionId = path.basename(file, '.jsonl');
    const messagesInFile: ExtractedMessage[] = [];
    let currentModel = 'pi-model';

    await forEachJsonLine(file, (data) => {
      if (data.type === 'model_change' && (data.modelId || data.model)) {
        currentModel = data.modelId || data.model;
      }

      if (data.type !== 'message' || !data.message) {
        return;
      }

      const msg = data.message;
      if (msg.role !== 'assistant') {
        return;
      }

      const model = msg.model || msg.modelId || currentModel;
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
        if (onProgress && count % 20 === 0) onProgress(count);
        yield m;
      }
    }
  }
}
