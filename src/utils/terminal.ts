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

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class RealtimeProgressBar {
  private frameIndex = 0;
  private timer: NodeJS.Timeout | null = null;
  private currentName = '';
  private currentCount = 0;
  private currentMatches = 0;
  private active = false;

  start(name: string) {
    this.currentName = name;
    this.currentCount = 0;
    this.currentMatches = 0;
    this.active = true;
    this.render();

    if (!this.timer) {
      this.timer = setInterval(() => {
        if (this.active) {
          this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
          this.render();
        }
      }, 70);
    }
  }

  update(count: number, matches: number) {
    this.currentCount = count;
    this.currentMatches = matches;
    this.render();
  }

  stop(finalMessage: string) {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (process.stdout.isTTY) {
      process.stdout.write(`\r\x1b[2K${finalMessage}\n`);
    } else {
      console.log(finalMessage);
    }
  }

  private render() {
    if (!this.active || !process.stdout.isTTY) return;
    const spinner = c.cyan(SPINNER_FRAMES[this.frameIndex]);
    const nameStr = c.bold(this.currentName.padEnd(22));
    const countStr = c.dim(`已读取 ${this.currentCount.toLocaleString()} 条`);
    const matchStr =
      this.currentMatches > 0
        ? c.brightYellow(`命中 ${this.currentMatches} 次`)
        : c.dim(`命中 0 次`);

    // Dynamic mini progress bar
    const barWidth = 14;
    const pulsePos = (this.frameIndex * 2) % (barWidth + 4);
    let barStr = '';
    for (let i = 0; i < barWidth; i++) {
      if (Math.abs(i - pulsePos) <= 1) {
        barStr += c.cyan('━');
      } else {
        barStr += c.gray('─');
      }
    }

    process.stdout.write(
      `\r\x1b[2K  ${spinner} ${nameStr} [${barStr}] ${countStr} | ${matchStr}`,
    );
  }
}
