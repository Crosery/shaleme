import fs from 'node:fs';
import path from 'node:path';
import { ExtractedMessage, HarnessId } from '../types';
import { BaseAdapter, findFilesRecursively, forEachJsonLine, getHomeDir } from './base';

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

  async *collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage> {
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

    let count = 0;
    // 1. Process JSONL session files
    for (const file of files) {
      const sessionId = path.basename(file, '.jsonl');
      let currentModel = 'pi-model';
      const messagesInFile: ExtractedMessage[] = [];

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
        const timestamp = typeof rawTime === 'number' ? rawTime : (rawTime ? new Date(rawTime).getTime() : Date.now());

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

    // 2. Process workflow runs
    const runsDir = path.join(piDir, 'workflows');
    if (fs.existsSync(runsDir)) {
      const runFiles = findFilesRecursively(runsDir, (_, name) => name.endsWith('.json') && !name.endsWith('.bak'), 5);
      for (const runFile of runFiles) {
        try {
          const content = fs.readFileSync(runFile, 'utf8');
          const data = JSON.parse(content);
          const runId = data.runId || path.basename(runFile, '.json');
          const journal = data.journal;

          if (Array.isArray(journal)) {
            for (const entry of journal) {
              if (entry && typeof entry.result === 'string') {
                count++;
                yield {
                  harness: this.id,
                  sessionId: runId,
                  timestamp: Date.now(),
                  model: 'pi-workflow-agent',
                  text: entry.result,
                };
              }
            }
          }
        } catch {
          // Ignore parse errors on individual workflow files
        }
      }
    }
  }
}
