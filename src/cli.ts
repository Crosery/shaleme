import { detectAvailableAdapters, runUnifiedScan } from './adapters';
import { SycophancyDetector } from './detector';
import { generateReportHtml, writeReportToFile } from './report/generator';
import { openInBrowser } from './report/open';
import { HarnessId } from './types';
import { c, printBanner, RealtimeProgressBar } from './utils/terminal';

// Suppress SQLite experimental warning from node:sqlite on Node 22/24
if (typeof process !== 'undefined' && process.emitWarning) {
  const origEmit = process.emitWarning;
  process.emitWarning = (warning: any, ...args: any[]) => {
    if (typeof warning === 'string' && warning.includes('SQLite is an experimental feature')) {
      return;
    }
    if (
      warning &&
      typeof warning === 'object' &&
      warning.message &&
      warning.message.includes('SQLite is an experimental feature')
    ) {
      return;
    }
    return (origEmit as any).call(process, warning, ...args);
  };
}

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printBanner();
    console.log(`
${c.bold('用法:')}
  npx shaleme [选项]
  bunx shaleme [选项]
  shaleme [选项]

${c.bold('选项:')}
  --no-open          分析完成后不自动在浏览器中打开 HTML 报告
  --out <path>       自定义生成的 HTML 报告路径 (默认生成在 ~/Downloads/)
  --json             仅输出纯 JSON 统计数据（适合脚本或管道）
  --harness <names>  限定分析特定的 Agent Harness (逗号分隔，如 claude,codex,omp,pi)
  --help, -h         显示帮助信息
  --version, -v      显示版本号

${c.bold('支持的 Agent 平台:')}
  • claude           Claude Code CLI (~/.claude)
  • codex            Codex CLI / Desktop (~/.codex)
  • omp              Oh My Prompt (~/.omp)
  • pi               Pi Agent Harness (~/.pi)
  • codebuddy        CodeBuddy / WorkBuddy (~/.workbuddy, ~/.codebuddy)
  • cline            Cline / Roo Code (VSCode & Cursor globalStorage)
  • openclaw         OpenClaw 自主代理 (~/.openclaw)
  • hermes           Hermes Agent (~/.hermes)
  • cursor           Cursor 编辑器 (Workspace Storage)
  • opencode         OpenCode (~/.local/share/opencode)
    `);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('shaleme v0.1.0');
    process.exit(0);
  }

  const isJson = args.includes('--json');
  const noOpen = args.includes('--no-open');

  let customOut: string | undefined;
  const outIdx = args.indexOf('--out');
  if (outIdx !== -1 && args[outIdx + 1]) {
    customOut = args[outIdx + 1];
  }

  let selectedHarnesses: HarnessId[] | undefined;
  const harnessIdx = args.indexOf('--harness');
  if (harnessIdx !== -1 && args[harnessIdx + 1]) {
    selectedHarnesses = args[harnessIdx + 1].split(',').map((s) => s.trim().toLowerCase()) as HarnessId[];
  }

  if (!isJson) {
    printBanner();
    console.log(c.dim('  正在检测本机已安装的 Coding Agent 平台...\n'));
  }

  const available = await detectAvailableAdapters();
  const activeList = available.filter((a) => a.available);

  if (!isJson) {
    for (const h of available) {
      const status = h.available
        ? c.green('[已发现会话]')
        : c.gray('[未检测到数据]');
      console.log(`  ${c.cyan(h.id.toUpperCase().padEnd(10))} ${c.bold(h.name.padEnd(26))} ${status}`);
    }
    console.log('');
  }

  if (activeList.length === 0) {
    if (isJson) {
      console.log(JSON.stringify({ error: 'No active agent harnesses found on this machine' }));
    } else {
      console.log(c.yellow('! 未在当前机器的主目录中检测到任何支持的 Agent 会话数据。'));
      console.log(c.dim('支持检测 ~/.claude, ~/.codex, ~/.omp, ~/.pi, ~/.workbuddy, Cline, Hermes, Cursor 等。\n'));
    }
    process.exit(0);
  }

  if (!isJson) {
    console.log(c.cyan('>>> 开始深度扫描 AI 会话并统计「你说得对」行为基准...\n'));
  }

  const detector = new SycophancyDetector();
  const progressBar = new RealtimeProgressBar();

  const summary = await runUnifiedScan(
    {
      harnesses: selectedHarnesses,
      onHarnessStart: (h, name) => {
        if (!isJson) {
          progressBar.start(name);
        }
      },
      onProgress: (h, count, matchCount) => {
        if (!isJson) {
          progressBar.update(count, matchCount);
        }
      },
      onHarnessEnd: (h, name, msgCount, matchCount) => {
        if (!isJson) {
          const matchStr =
            matchCount > 0 ? c.brightYellow(`${matchCount} 次「你说得对」`) : c.dim('0 次');
          progressBar.stop(
            `  ${c.green('[OK]')} ${c.bold(name.padEnd(24))} 分析了 ${c.bold(String(msgCount).padStart(5))} 条回复，发现 ${matchStr}`,
          );
        }
      },
    },
    detector,
  );

  if (isJson) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  console.log('\n' + c.bold('──────────────── 统计战报 (SHALEME BENCHMARK) ────────────────'));
  console.log(`  综合行为倾向:    ${summary.overallDroolLevel.badge} (${c.bold(summary.overallDroolLevel.name)})`);
  console.log(`  诊断评价:        ${c.dim(summary.overallDroolLevel.tagline)}`);
  console.log(`  抓获认同总数:    ${c.brightYellow(c.bold(String(summary.totalDroolCount)))} 次`);
  console.log(`  分析助手消息:    ${summary.totalAssistantMessages} 条`);
  console.log(`  流口水指数 (MDI): ${c.cyan(String(summary.overallDroolIndex))} ‰ (每千次回答说「你说得对」的频次)`);
  console.log(c.bold('───────────────────────────────────────────────────────────────\n'));

  // Print Top 5 Models
  console.log(c.bold('TOP 5 附和榜首模型:'));
  const topModels = summary.modelRankings.slice(0, 5);
  if (topModels.length === 0) {
    console.log(c.gray('  (未发现模型命中「你说得对」或暂无对话消息)'));
  } else {
    for (let i = 0; i < topModels.length; i++) {
      const m = topModels[i];
      const rankTag = `[#0${i + 1}]`;
      console.log(
        `  ${c.cyan(rankTag)} ${c.bold(m.model.padEnd(28))} ${c.brightYellow(String(m.droolCount).padStart(3))} 次  ` +
          `[MDI: ${String(m.droolIndex).padStart(5)} ‰]  [${m.droolLevel.badge}]`,
      );
    }
  }

  // Print Top Phrases
  console.log('\n' + c.bold('特征附和口头禅 Top 5:'));
  const topPhrases = summary.phraseCloud.slice(0, 5);
  if (topPhrases.length === 0) {
    console.log(c.gray('  (无)'));
  } else {
    for (const p of topPhrases) {
      console.log(`  • 「${c.cyan(p.text)}」: ${c.bold(String(p.count))} 次`);
    }
  }

  // Write HTML report
  const reportPath = writeReportToFile(summary, customOut);
  console.log('\n' + c.green(`Standalone HTML 报告已生成至:`));
  console.log(`   ${c.bold(reportPath)}\n`);

  if (!noOpen) {
    console.log(c.dim('正在使用系统默认浏览器打开报告...'));
    await openInBrowser(reportPath);
  }
}

// Automatically invoke if executed directly
if (require.main === module || (typeof Bun !== 'undefined' && Bun.main === import.meta.path)) {
  runCli().catch((err) => {
    console.error(c.red('运行出错:'), err);
    process.exit(1);
  });
}
