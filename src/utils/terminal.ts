// Lightweight ANSI color styling with zero dependencies

const hasColors = process.stdout.isTTY && !process.env.NO_COLOR;

export const c = {
  reset: (s: string) => (hasColors ? `\x1b[0m${s}\x1b[0m` : s),
  bold: (s: string) => (hasColors ? `\x1b[1m${s}\x1b[22m` : s),
  dim: (s: string) => (hasColors ? `\x1b[2m${s}\x1b[22m` : s),
  cyan: (s: string) => (hasColors ? `\x1b[36m${s}\x1b[39m` : s),
  yellow: (s: string) => (hasColors ? `\x1b[33m${s}\x1b[39m` : s),
  green: (s: string) => (hasColors ? `\x1b[32m${s}\x1b[39m` : s),
  red: (s: string) => (hasColors ? `\x1b[31m${s}\x1b[39m` : s),
  magenta: (s: string) => (hasColors ? `\x1b[35m${s}\x1b[39m` : s),
  blue: (s: string) => (hasColors ? `\x1b[34m${s}\x1b[39m` : s),
  gray: (s: string) => (hasColors ? `\x1b[90m${s}\x1b[39m` : s),
  brightYellow: (s: string) => (hasColors ? `\x1b[93m${s}\x1b[39m` : s),
};

export function printBanner(): void {
  console.log(
    c.cyan(`
  ███████╗██╗  ██╗ █████╗ ██╗     ███████╗███╗   ███╗███████╗
  ██╔════╝██║  ██║██╔══██╗██║     ██╔════╝████╗ ████║██╔════╝
  ███████╗███████║███████║██║     █████╗  ██╔████╔██║█████╗
  ╚════██║██╔══██║██╔══██║██║     ██╔══╝  ██║╚██╔╝██║██╔══╝
  ███████║██║  ██║██║  ██║███████╗███████╗██║ ╚═╝ ██║███████╗
  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝     ╚═╝╚══════╝
    SHALEME (傻了么) - AI 模型「你说得对」行为基准排行榜
  `),
  );
}

export function formatProgressBar(current: number, total: number, width = 30): string {
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  const filled = Math.round(width * ratio);
  const empty = width - filled;
  const bar = c.brightYellow('━'.repeat(filled)) + c.gray('─'.repeat(empty));
  const percent = Math.round(ratio * 100);
  return `[${bar}] ${percent}%`;
}
