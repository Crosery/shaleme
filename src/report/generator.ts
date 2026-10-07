import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DroolMatch, ModelStats, ReportSummary } from '../types';
import { escapeHtml, escapeRegex } from '../utils/text';

export function getDownloadsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const downloads = path.join(home, 'Downloads');
  if (fs.existsSync(downloads)) {
    return downloads;
  }
  return home;
}
export const DEFAULT_LEADERBOARD_ENDPOINT = 'https://shaleme.crosery.cc.cd/submit';

const ACCENT = '#4f46e5';
const LINE = '#e4e7ec';

function loadMascotDataUri(): string {
  const candidates = [
    path.join(__dirname, '..', 'data', 'mascot.jpg'),
    path.join(__dirname, '..', '..', 'data', 'mascot.jpg'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return `data:image/jpeg;base64,${fs.readFileSync(candidate).toString('base64')}`;
    }
  }
  return '';
}

function modelRow(m: ModelStats, rank: number, maxMdi: number): string {
  const rankStr = String(rank).padStart(2, '0');
  const topP = m.topPhrases[0]?.phrase || '无';
  const barWidth = Math.min(100, Math.round((m.droolIndex / maxMdi) * 100));
  return `
          <tr data-model="${escapeHtml(m.model.toLowerCase())}" data-sort-rank="${rank}" data-sort-mdi="${m.droolIndex}" data-sort-count="${m.droolCount}" data-sort-total="${m.totalMessages}" data-sort-rate="${m.droolRate}">
            <td class="col-rank num">${rankStr}</td>
            <td class="col-model">${escapeHtml(m.model)}</td>
            <td class="col-harness num">${m.harnesses.map(escapeHtml).join(', ')}</td>
            <td class="num strong right">${m.droolCount.toLocaleString()}</td>
            <td class="num muted right">${m.totalMessages.toLocaleString()}</td>
            <td class="num right">${m.droolRate}%</td>
            <td class="col-mdi">
              <span class="num strong">${m.droolIndex} ‰</span>
              <span class="mdi-bar"><span class="mdi-fill" style="width:${barWidth}%; background:${m.droolLevel.color};"></span></span>
            </td>
            <td class="col-level" style="color:${m.droolLevel.color}">${escapeHtml(m.droolLevel.name)}</td>
            <td class="col-phrase">「${escapeHtml(topP)}」</td>
          </tr>`;
}

function quoteCard(match: DroolMatch): string {
  const escapedText = escapeHtml(match.snippet);
  const safePhrasePattern = escapeRegex(escapeHtml(match.phrase));
  let highlighted = escapedText;
  try {
    highlighted = escapedText.replace(
      new RegExp(safePhrasePattern, 'gi'),
      `<span class="quote-target">$&</span>`,
    );
  } catch {
    // Fall back to the unhighlighted snippet when the phrase can't become a regex.
  }
  return `
        <article class="quote-card" data-phrase="${escapeHtml(match.phrase.toLowerCase())}">
          <p class="quote-body">${highlighted}</p>
          <footer class="quote-foot">
            <span class="quote-model">${escapeHtml(match.model)} · ${escapeHtml(match.harness)}</span>
            <span class="num">${new Date(match.timestamp).toLocaleDateString()}</span>
          </footer>
        </article>`;
}

export function generateReportHtml(summary: ReportSummary, leaderboardEndpoint?: string): string {
  const serialized = JSON.stringify(summary).replace(/</g, '\\u003c');
  // Like maleme's built-in submit_endpoint: the hosted leaderboard is the
  // default target, so a plain `npx shaleme` run can upload directly.
  // `--leaderboard ""` or SHALEME_LEADERBOARD_URL="" disables it; a non-empty
  // value overrides it (self-hosted instances).
  const endpoint = leaderboardEndpoint ?? process.env.SHALEME_LEADERBOARD_URL ?? DEFAULT_LEADERBOARD_ENDPOINT;

  const mascotDataUri = loadMascotDataUri();
  const mascotImg = mascotDataUri
    ? `<img class="masthead-mascot" src="${mascotDataUri}" alt="DeepSeek娘：漩涡眼流口水的 Q 版形象">`
    : '';
  const maxMdi = Math.max(...summary.modelRankings.map((r) => r.droolIndex), 1);
  const harnessRows = Object.values(summary.harnessStats).filter((h) => h.messageCount > 0);
  const maxHarnessMdi = Math.max(...harnessRows.map((h) => h.droolIndex), 1);

  // Build SVG timeline chart
  const timelinePoints = summary.dailyTimeline;
  let timelineSvg = '<p class="no-data">暂无时间线数据</p>';
  if (timelinePoints.length > 0) {
    const maxCount = Math.max(...timelinePoints.map((p) => p.count), 1);
    const width = 800;
    const height = 240;
    const paddingX = 28;
    const paddingY = 24;
    const chartW = width - paddingX * 2;
    const chartH = height - paddingY * 2;

    const pointsCoords = timelinePoints.map((p, idx) => {
      const x = paddingX + (idx / Math.max(timelinePoints.length - 1, 1)) * chartW;
      const y = height - paddingY - (p.count / maxCount) * chartH;
      return { x, y, ...p };
    });

    const pathData = pointsCoords.reduce((acc, curr, idx) => {
      return idx === 0 ? `M ${curr.x} ${curr.y}` : `${acc} L ${curr.x} ${curr.y}`;
    }, '');

    const areaData = `${pathData} L ${pointsCoords[pointsCoords.length - 1].x} ${height - paddingY} L ${pointsCoords[0].x} ${height - paddingY} Z`;

    timelineSvg = `
      <svg viewBox="0 0 ${width} ${height}" class="timeline-svg" role="img" aria-label="每日「你说得对」命中次数折线图">
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.14" />
            <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0.01" />
          </linearGradient>
        </defs>
        <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="${LINE}" stroke-width="1.5" />

        <path d="${areaData}" fill="url(#areaGradient)" />
        <path d="${pathData}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />

        ${pointsCoords
          .map(
            (pt) => `
          <circle class="tl-point" cx="${pt.x}" cy="${pt.y}" r="3" fill="#ffffff" stroke="${ACCENT}" stroke-width="2" data-date="${pt.date}" data-count="${pt.count}" />`,
          )
          .join('')}
      </svg>
      <div class="timeline-labels">
        <span class="num">${timelinePoints[0]?.date || ''}</span>
        <span class="num">${timelinePoints[timelinePoints.length - 1]?.date || ''}</span>
      </div>
      <div class="chart-tooltip" id="chartTooltip" hidden></div>
    `;
  }

  const modelRowsHtml = summary.modelRankings.map((m, idx) => modelRow(m, idx + 1, maxMdi)).join('');
  const harnessRowsHtml = harnessRows
    .map((h) => {
      const w = Math.min(100, Math.round((h.droolIndex / maxHarnessMdi) * 100));
      return `
        <li class="harness-row">
          <span class="harness-name">${escapeHtml(h.name)}</span>
          <span class="harness-track"><span class="harness-fill" style="width:${w}%;"></span></span>
          <span class="harness-num num">${h.droolIndex} ‰</span>
          <span class="harness-count num">${h.droolCount} / ${h.messageCount.toLocaleString()}</span>
        </li>`;
    })
    .join('');
  const phraseChipsHtml = summary.phraseCloud
    .map(
      (p) => `
          <button type="button" class="phrase-chip" data-phrase="${escapeHtml(p.text.toLowerCase())}" aria-pressed="false">
            <span class="phrase-text">${escapeHtml(p.text)}</span>
            <span class="phrase-count num">${p.count}</span>
          </button>`,
    )
    .join('');
  const quoteCardsHtml = summary.hallOfShame.map(quoteCard).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SHALEME - AI 模型「你说得对」行为基准分析报告</title>
  <meta name="description" content="扫描本机 Coding Agent 历史会话，量化各模型的顺从附和倾向（MDI 流口水指数）。">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%234f46e5'/%3E%3Ctext x='16' y='22' font-family='Georgia,serif' font-size='18' font-weight='700' fill='white' text-anchor='middle'%3ES%3C/text%3E%3C/svg%3E">
  <style>
    :root {
      /* color roles */
      --bg: #fafbfc;
      --surface: #ffffff;
      --surface-2: #f2f4f7;
      --line: ${LINE};
      --line-strong: #c9cfd8;
      --ink: #16181d;
      --ink-2: #4b5563;
      --ink-3: #8b93a1;
      --accent: ${ACCENT};
      --accent-strong: #4338ca;
      --accent-soft: #eef0fe;
      --danger: #be123c;
      --danger-soft: #ffe4e6;
      --success: #047857;

      /* type scale (1.25 ratio) */
      --fs-xs: 0.78rem;
      --fs-sm: 0.83rem;
      --fs-md: 0.89rem;
      --fs-base: 1rem;
      --fs-lg: 1.22rem;
      --fs-xl: 1.55rem;
      --fs-2xl: 2.05rem;
      --fs-3xl: clamp(1.75rem, 3.6vw, 2.5rem);

      /* spacing scale (4px rhythm) */
      --s-1: 4px;
      --s-2: 8px;
      --s-3: 12px;
      --s-4: 16px;
      --s-5: 24px;
      --s-6: 32px;
      --s-7: 48px;
      --s-8: 64px;

      /* shape + elevation */
      --r-control: 8px;
      --r-field: 10px;

      /* motion */
      --dur-fast: 0.14s;
      --dur-med: 0.2s;
      --dur-slow: 0.28s;
      --ease: cubic-bezier(0.22, 0.61, 0.36, 1);

      --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
      --font-serif: "Songti SC", "Noto Serif SC", "STSong", Georgia, serif;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html { scroll-behavior: smooth; }

    body {
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-sans);
      font-size: 16px;
      line-height: 1.7;
      padding: 0 24px 96px;
      -webkit-font-smoothing: antialiased;
    }

    .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .strong { font-weight: 700; color: var(--ink); }
    .muted { color: var(--ink-3); }
    .right { text-align: right; }

    .container { max-width: 1080px; margin: 0 auto; }

    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      border-radius: 4px;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }

    /* ---------- Masthead ---------- */
    .masthead {
      padding: 52px 0 36px;
      border-bottom: 1px solid var(--line);
    }
    .brand-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px 24px;
      margin-bottom: 20px;
    }
    .brand {
      font-family: var(--font-serif);
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    .brand .sub {
      font-family: var(--font-sans);
      font-size: 0.82rem;
      font-weight: 400;
      letter-spacing: 0;
      color: var(--ink-3);
      margin-left: 10px;
    }
    .meta { font-size: 0.82rem; color: var(--ink-3); }

    h1 {
      font-family: var(--font-serif);
      font-size: clamp(1.75rem, 3.6vw, 2.5rem);
      font-weight: 700;
      line-height: 1.35;
      letter-spacing: 0.01em;
    }
    h1 .hl { color: var(--accent-strong); }

    .masthead-main {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--s-5);
    }
    .masthead-mascot {
      width: 132px;
      height: auto;
      flex: none;
      mix-blend-mode: multiply;
    }

    /* ---------- Summary strip ---------- */
    .summary {
      display: grid;
      grid-template-columns: 1.3fr repeat(3, 1fr);
      gap: 0;
      padding: 36px 0 8px;
    }
    .sum-item {
      padding: 4px 28px;
      border-left: 1px solid var(--line);
    }
    .sum-item:first-child { padding-left: 0; border-left: none; }
    .sum-label { display: block; font-size: 0.82rem; color: var(--ink-3); margin-bottom: 6px; }
    .sum-value {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 2.05rem;
      font-weight: 700;
      line-height: 1.15;
      letter-spacing: -0.02em;
    }
    .sum-value small { font-family: var(--font-sans); font-size: 0.82rem; font-weight: 600; color: var(--ink-3); margin-left: 4px; letter-spacing: 0; }
    .sum-verdict {
      font-family: var(--font-serif);
      font-size: 2.05rem;
      font-weight: 700;
      line-height: 1.25;
    }
    .sum-note { display: block; margin-top: 4px; font-size: 0.82rem; color: var(--ink-3); }

    /* ---------- Sections ---------- */
    section { margin-top: 64px; }
    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px 24px;
      margin-bottom: 18px;
    }
    h2 { font-size: 1.22rem; font-weight: 700; letter-spacing: 0.01em; }
    .section-meta { font-size: 0.82rem; color: var(--ink-3); }

    /* ---------- Table ---------- */
    .table-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px 16px;
      margin-bottom: 14px;
    }
    .segmented {
      display: inline-flex;
      gap: var(--s-1);
      padding: var(--s-1);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--r-field);
    }
    .seg-btn {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--ink-2);
      font-family: inherit;
      font-size: var(--fs-sm);
      font-weight: 600;
      padding: var(--s-2) 14px;
      border-radius: var(--r-control);
      cursor: pointer;
      white-space: nowrap;
      transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
    }
    .seg-btn:hover { background: var(--accent-soft); color: var(--accent-strong); }
    .seg-btn:active { transform: scale(0.97); }
    .seg-btn[aria-pressed="true"] { background: var(--ink); color: #fff; }
    .seg-btn[aria-pressed="true"]:hover { background: #262b36; color: #fff; }
    .seg-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

    .search-wrap { position: relative; display: flex; align-items: center; }
    .search-input {
      appearance: none;
      width: 260px;
      max-width: 100%;
      padding: var(--s-3) 38px var(--s-3) 14px;
      border: 1px solid var(--line);
      border-radius: var(--r-control);
      background: var(--surface);
      color: var(--ink);
      font-family: inherit;
      font-size: var(--fs-md);
      transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    .search-input::placeholder { color: var(--ink-3); }
    .search-input:hover { border-color: var(--line-strong); }
    .search-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .search-input:disabled { background: var(--surface-2); color: var(--ink-3); cursor: not-allowed; }
    .search-clear {
      position: absolute;
      right: 6px;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--ink-3);
      font-size: 1.05rem;
      line-height: 1;
      cursor: pointer;
      display: none;
    }
    .search-clear:hover { background: var(--accent-soft); color: var(--ink); }
    .search-clear.show { display: block; }

    .result-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 0 2px 10px;
      font-size: 0.82rem;
      color: var(--ink-3);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.89rem;
      background: var(--surface);
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 5;
      background: var(--surface);
      text-align: left;
      font-size: 0.76rem;
      font-weight: 700;
      color: var(--ink-3);
      letter-spacing: 0.04em;
      padding: 11px 14px;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
    }
    thead.stuck th { box-shadow: 0 6px 12px -8px rgba(22, 24, 29, 0.16); }
    th.right { text-align: right; }
    .sort-btn {
      appearance: none;
      border: none;
      background: transparent;
      font: inherit;
      color: inherit;
      letter-spacing: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 2px;
      border-radius: 4px;
      transition: color 0.18s var(--ease);
    }
    .sort-btn:hover { color: var(--ink); }
    .sort-btn .arrow {
      width: 0;
      height: 0;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-bottom: 5px solid currentColor;
      opacity: 0.22;
      transition: transform 0.2s var(--ease), opacity 0.2s var(--ease);
    }
    th[aria-sort="descending"] .sort-btn .arrow { opacity: 1; transform: rotate(180deg); }
    th[aria-sort="ascending"] .sort-btn .arrow { opacity: 1; }

    tbody td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      vertical-align: middle;
    }
    tbody tr { transition: background 0.15s var(--ease); }
    tbody tr:hover { background: var(--accent-soft); }
    tbody tr:last-child td { border-bottom: none; }
    .col-rank { width: 48px; min-width: 48px; color: var(--ink-3); font-size: 0.82rem; }
    .col-model { font-weight: 700; color: var(--ink); min-width: 150px; white-space: nowrap; }
    .col-harness { color: var(--ink-3); font-size: 0.78rem; white-space: nowrap; }
    .col-mdi { min-width: 160px; }
    .col-level { font-size: 0.84rem; font-weight: 600; white-space: nowrap; }
    .col-phrase { color: var(--ink-2); font-size: 0.83rem; max-width: 200px; }
    .mdi-bar {
      display: block;
      height: 3px;
      margin-top: 6px;
      background: var(--line);
      border-radius: 999px;
      overflow: hidden;
    }
    .mdi-fill { display: block; height: 100%; border-radius: 999px; }
    .empty-state {
      display: none;
      padding: 40px 18px;
      text-align: center;
      color: var(--ink-3);
      font-size: 0.92rem;
    }
    .empty-state.show { display: block; }
    .empty-state .btn { margin-top: 14px; }

    /* ---------- Harness comparison ---------- */
    .harness-list {
      list-style: none;
      border-top: 1px solid var(--line);
    }
    .harness-row {
      display: grid;
      grid-template-columns: minmax(0, 210px) minmax(0, 1fr) 84px 120px;
      align-items: center;
      gap: 16px;
      padding: 13px 2px;
      border-bottom: 1px solid var(--line);
      transition: background 0.15s var(--ease);
    }
    .harness-row:hover { background: var(--accent-soft); }
    .harness-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .harness-track { height: 4px; background: var(--line); border-radius: 999px; overflow: hidden; }
    .harness-fill { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
    .harness-num { font-weight: 700; text-align: right; }
    .harness-count { color: var(--ink-3); font-size: 0.8rem; text-align: right; }

    /* ---------- Timeline ---------- */
    .chart-box { position: relative; padding: 8px 0 0; }
    .timeline-svg { display: block; width: 100%; height: auto; }
    .tl-point { transition: r 0.15s var(--ease), fill 0.15s var(--ease); cursor: pointer; }
    .tl-point:hover { r: 5.5; fill: var(--accent-soft); }
    .timeline-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 0.78rem;
      color: var(--ink-3);
    }
    .chart-tooltip {
      position: absolute;
      z-index: 10;
      pointer-events: none;
      background: var(--ink);
      color: #fff;
      padding: 7px 11px;
      border-radius: var(--r-control);
      font-size: 0.78rem;
      transform: translate(-50%, calc(-100% - 10px));
      white-space: nowrap;
    }

    /* ---------- Phrase chips ---------- */
    .phrase-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .phrase-chip {
      appearance: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 13px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 999px;
      font-family: inherit;
      font-size: 0.85rem;
      color: var(--ink-2);
      cursor: pointer;
      transition: border-color 0.18s var(--ease), color 0.18s var(--ease), background 0.18s var(--ease);
    }
    .phrase-chip:hover { border-color: var(--accent); color: var(--accent-strong); }
    .phrase-chip:active { transform: scale(0.97); }
    .phrase-chip[aria-pressed="true"] {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: var(--accent-strong);
      font-weight: 600;
    }
    .phrase-count { font-size: 0.76rem; color: var(--ink-3); }
    .phrase-chip[aria-pressed="true"] .phrase-count { color: var(--accent-strong); }

    /* ---------- Quotes ---------- */
    .quote-status { display: flex; align-items: center; gap: 12px; font-size: 0.84rem; color: var(--ink-3); }
    .text-btn {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--accent-strong);
      font-family: inherit;
      font-size: 0.84rem;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 6px;
      text-decoration: underline;
      text-underline-offset: 3px;
      transition: background var(--dur-fast) var(--ease), opacity var(--dur-fast) var(--ease);
    }
    .text-btn:hover { background: var(--accent-soft); }
    .text-btn:active { opacity: 0.7; }
    .text-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .quote-grid { columns: 2; column-gap: 32px; }
    .quote-card {
      break-inside: avoid;
      margin-bottom: 24px;
      padding-bottom: 22px;
      border-bottom: 1px solid var(--line);
    }
    .quote-body { color: var(--ink-2); font-size: 0.93rem; line-height: 1.9; }
    .quote-target {
      color: var(--accent-strong);
      font-weight: 700;
    }
    .quote-foot {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 10px;
      font-size: 0.78rem;
      color: var(--ink-3);
    }
    .quote-model { font-weight: 600; color: var(--ink-2); }

    /* ---------- Actions ---------- */
    .actions {
      margin-top: 56px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }
    .actions-hint { flex-basis: 100%; font-size: 0.78rem; color: var(--ink-3); }
    .btn {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--s-2);
      min-height: 40px;
      padding: var(--s-2) 18px;
      border-radius: var(--r-control);
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      font-family: inherit;
      font-size: var(--fs-md);
      font-weight: 600;
      cursor: pointer;
      transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
    }
    .btn:hover { border-color: var(--ink-3); }
    .btn:active { transform: scale(0.98); }
    .btn-primary { background: var(--ink); color: #fff; border-color: var(--ink); }
    .btn-primary:hover { background: #262b36; border-color: #262b36; }
    .btn-text {
      border-color: transparent;
      background: transparent;
      color: var(--accent-strong);
      padding-left: var(--s-2);
      padding-right: var(--s-2);
    }
    .btn-text:hover { border-color: transparent; background: var(--accent-soft); }
    .btn[disabled] { opacity: 0.5; cursor: not-allowed; transform: none; }
    .btn.loading { cursor: progress; opacity: 0.85; }
    .btn-upload {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      box-shadow: 0 1px 2px rgba(79, 70, 229, 0.35);
    }
    .btn-upload:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
    .brand-actions { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: flex-end; }
    .btn .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 999px;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ---------- Footer ---------- */
    footer.page-foot {
      margin-top: 64px;
      padding-top: 22px;
      border-top: 1px solid var(--line);
      color: var(--ink-3);
      font-size: 0.82rem;
      line-height: 1.8;
    }

    /* ---------- Overlays ---------- */
    .toast {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translate(-50%, 10px);
      z-index: 80;
      background: var(--ink);
      color: #fff;
      padding: 11px 18px;
      border-radius: 999px;
      font-size: 0.86rem;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--dur-med) var(--ease), transform var(--dur-med) var(--ease);
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .toast.error { background: var(--danger); }
    .toast.success { background: var(--success); }

    /* ---------- Tooltip (hover + keyboard focus) ---------- */
    [data-tip] { position: relative; }
    [data-tip]::after {
      content: attr(data-tip);
      position: absolute;
      left: 50%;
      bottom: calc(100% + 8px);
      transform: translate(-50%, 4px);
      z-index: 60;
      background: var(--ink);
      color: #fff;
      padding: 7px 11px;
      border-radius: var(--r-control);
      font-family: var(--font-sans);
      font-size: var(--fs-xs);
      font-weight: 500;
      letter-spacing: 0;
      line-height: 1.5;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
    }
    [data-tip]:hover::after,
    [data-tip]:focus-visible::after { opacity: 1; transform: translate(-50%, 0); }

    .back-top {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 70;
      width: 42px;
      height: 42px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink-2);
      font-size: 1.05rem;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
      transition: opacity var(--dur-med) var(--ease), transform var(--dur-med) var(--ease), border-color var(--dur-fast) var(--ease);
    }
    .back-top.show { opacity: 1; pointer-events: auto; transform: translateY(0); }
    .back-top:hover { border-color: var(--ink-3); }
    .back-top:active { transform: translateY(0) scale(0.96); }

    .no-data { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 0.92rem; }

    /* ---------- Responsive ---------- */
    @media (max-width: 900px) {
      .summary { grid-template-columns: 1fr 1fr; gap: 24px 0; }
      .sum-item:nth-child(3) { padding-left: 0; border-left: none; }
      .quote-grid { columns: 1; }
    }
    @media (max-width: 860px) {
      body { padding: 0 16px 80px; }
      .masthead { padding: 36px 0 28px; }
      .masthead-main { align-items: center; }
      .masthead-mascot { width: 84px; }
      section { margin-top: 52px; }
      .summary { grid-template-columns: 1fr 1fr; }
      .sum-value, .sum-verdict { font-size: 1.7rem; }
      .table-scroll { overflow-x: auto; }
      table { min-width: 860px; }
      .table-toolbar { flex-direction: column; align-items: stretch; }
      .segmented { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); width: 100%; }
      .seg-btn { width: 100%; }
      .search-input { width: 100%; }
      .harness-row { grid-template-columns: 1fr auto; grid-template-areas: "name num" "track count"; }
      .harness-name { grid-area: name; }
      .harness-num { grid-area: num; }
      .harness-track { grid-area: track; }
      .harness-count { grid-area: count; }
      .actions .btn { flex: 1 1 100%; }
    }

    /* ---------- Reduced motion ---------- */
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    /* ---------- Print ---------- */
    @media print {
      body { background: #fff; padding: 0; }
      .table-toolbar, .result-line, .actions, .brand-actions, .back-top, .toast { display: none !important; }
      .quote-card, .harness-list, table { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="container">
    <header class="masthead">
      <div class="brand-row">
        <div class="brand">SHALEME<span class="sub">傻了么</span></div>
        <div class="brand-actions">
          <div class="meta num">${summary.generatedDate} · ${summary.totalSessionsScanned.toLocaleString()} 组会话 · ${summary.activeHarnessCount} 个平台</div>
          <button type="button" class="btn btn-upload" data-upload-btn onclick="submitToLeaderboard()">↑ 上传到榜单</button>
        </div>
      </div>
      <div class="masthead-main">
        <h1>AI 模型<span class="hl">「你说得对」</span>行为基准分析报告</h1>
        ${mascotImg}
      </div>
    </header>

    <section class="summary" aria-label="总体统计">
      <div class="sum-item">
        <span class="sum-label">综合评级</span>
        <strong class="sum-verdict">${summary.overallDroolLevel.name}</strong>
        <span class="sum-note">${summary.overallDroolLevel.tagline}</span>
      </div>
      <div class="sum-item">
        <span class="sum-label">「你说得对」频次</span>
        <span class="sum-value">${summary.totalDroolCount.toLocaleString()}<small>次</small></span>
      </div>
      <div class="sum-item">
        <span class="sum-label" data-tip="每 1000 次助手回复中命中认怂附和的次数" tabindex="0">流口水指数 MDI</span>
        <span class="sum-value">${summary.overallDroolIndex}<small>‰</small></span>
      </div>
      <div class="sum-item">
        <span class="sum-label">助手回复样本</span>
        <span class="sum-value">${summary.totalAssistantMessages.toLocaleString()}<small>条</small></span>
      </div>
    </section>

    <section id="ranking">
      <div class="section-head">
        <h2>完整模型行为排行榜</h2>
        <span class="section-meta">共 ${summary.modelRankings.length} 个模型</span>
      </div>
      <div class="table-toolbar">
        <div class="segmented" role="group" aria-label="按附和倾向筛选模型">
          <button type="button" class="seg-btn" data-filter="all" aria-pressed="true" tabindex="0" onclick="setFilter('all', this)">全部模型</button>
          <button type="button" class="seg-btn" data-filter="high" aria-pressed="false" tabindex="-1" onclick="setFilter('high', this)">高频附和 (&gt;10‰)</button>
          <button type="button" class="seg-btn" data-filter="low" aria-pressed="false" tabindex="-1" onclick="setFilter('low', this)">独立客观 (≤10‰)</button>
        </div>
        <div class="search-wrap">
          <label class="visually-hidden" for="modelFilter">按模型名称搜索</label>
          <input type="text" id="modelFilter" class="search-input" placeholder="搜索模型名称" autocomplete="off" oninput="handleSearch()">
          <button type="button" class="search-clear" id="searchClear" aria-label="清除搜索" onclick="clearSearch()">×</button>
        </div>
      </div>
      <div class="result-line">
        <span id="resultCount" aria-live="polite">显示 ${summary.modelRankings.length} / ${summary.modelRankings.length} 个模型</span>
      </div>
      <div class="table-scroll">
        <table id="benchmarkTable">
          <thead id="tableHead">
            <tr>
              <th class="col-rank" aria-sort="descending"><button type="button" class="sort-btn" onclick="sortTable('rank', this)">#<span class="arrow"></span></button></th>
              <th>模型标识</th>
              <th class="col-harness">承载平台</th>
              <th class="right" aria-sort="none"><button type="button" class="sort-btn" onclick="sortTable('count', this)">触发次数<span class="arrow"></span></button></th>
              <th class="right" aria-sort="none"><button type="button" class="sort-btn" onclick="sortTable('total', this)">总样本条数<span class="arrow"></span></button></th>
              <th class="right" aria-sort="none"><button type="button" class="sort-btn" onclick="sortTable('rate', this)">触发率<span class="arrow"></span></button></th>
              <th class="col-mdi" aria-sort="none"><button type="button" class="sort-btn" data-tip="每 1000 次助手回复中命中认怂附和的次数" onclick="sortTable('mdi', this)">流口水指数 (MDI)<span class="arrow"></span></button></th>
              <th>倾向评级</th>
              <th class="col-phrase">特征附和短语</th>
            </tr>
          </thead>
          <tbody id="tableBody">
            ${modelRowsHtml}
          </tbody>
        </table>
      </div>
      <div class="empty-state" id="tableEmpty">
        <p>没有匹配当前筛选条件的模型。</p>
        <button type="button" class="btn" onclick="resetFilters()">查看全部模型</button>
      </div>
    </section>

    <section id="harness">
      <div class="section-head">
        <h2>各 Agent 平台行为对比</h2>
      </div>
      <ul class="harness-list">
        ${harnessRowsHtml}
      </ul>
    </section>

    <section id="timeline">
      <div class="section-head">
        <h2>时间序列分布</h2>
      </div>
      <div class="chart-box">
        ${timelineSvg}
      </div>
    </section>

    <section id="lexicon">
      <div class="section-head">
        <h2>特征附和短语</h2>
        <span class="section-meta">共 ${summary.phraseCloud.length} 个</span>
      </div>
      <div class="phrase-chips" id="phraseChips">
        ${phraseChipsHtml}
      </div>
    </section>

    <section id="quotes">
      <div class="section-head">
        <h2>附和对话摘录</h2>
        <div class="quote-status">
          <span id="quoteCount" aria-live="polite">显示 ${summary.hallOfShame.length} / ${summary.hallOfShame.length} 条</span>
          <button type="button" class="text-btn" id="clearPhraseBtn" hidden onclick="clearPhraseFilter()">清除筛选</button>
        </div>
      </div>
      <div class="quote-grid" id="quotesGrid">
        ${quoteCardsHtml}
      </div>
      <div class="empty-state" id="quotesEmpty">
        <p>该短语在摘录中没有对应片段。</p>
        <button type="button" class="btn" onclick="clearPhraseFilter()">查看全部摘录</button>
      </div>
    </section>

    <section class="actions" aria-label="导出与分享">
      <button type="button" class="btn btn-primary" id="copyBtn" onclick="copySummaryText()">复制战报摘要</button>
      <button type="button" class="btn" onclick="exportPayload()">导出成绩 JSON</button>
      <button type="button" class="btn" onclick="window.print()">打印 / 导出 PDF</button>
      <button type="button" class="btn" data-upload-btn onclick="submitToLeaderboard()">上传到榜单</button>
      <p class="actions-hint">上传仅含汇总计数，不含对话内容。</p>
    </section>

    <footer class="page-foot">
      <p>SHALEME · 分析全程在本机完成，只有点击「上传到榜单」时才发送汇总计数。</p>
    </footer>
  </main>

  <button type="button" class="back-top" id="backTop" aria-label="回到顶部" onclick="backToTop()">↑</button>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script>
    const reportData = ${serialized};
    const leaderboardEndpoint = ${JSON.stringify(endpoint)};
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let currentFilterType = 'all';
    let searchTimer = null;
    let activePhrase = '';

    /* ---------- toast ---------- */
    let toastTimer = null;
    function toast(message, type) {
      const el = document.getElementById('toast');
      el.textContent = message;
      el.className = 'toast show' + (type ? ' ' + type : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
    }

    /* ---------- table filter + search ---------- */
    function setFilter(type, el) {
      currentFilterType = type;
      document.querySelectorAll('.seg-btn').forEach(function (t) {
        t.setAttribute('aria-pressed', t === el ? 'true' : 'false');
        t.tabIndex = t === el ? 0 : -1;
      });
      applyFilters();
    }

    /* roving tabindex: arrows move + select, Home/End jump */
    document.querySelector('.segmented').addEventListener('keydown', function (e) {
      const items = Array.prototype.slice.call(this.querySelectorAll('.seg-btn'));
      const current = items.indexOf(document.activeElement);
      if (current === -1) return;
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % items.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      if (next === -1) return;
      e.preventDefault();
      items[next].focus();
      setFilter(items[next].getAttribute('data-filter'), items[next]);
    });

    function handleSearch() {
      const input = document.getElementById('modelFilter');
      document.getElementById('searchClear').classList.toggle('show', input.value.length > 0);
      if (composing) return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 140);
    }

    /* IME composition: don't filter mid-pinyin, apply on commit */
    let composing = false;
    document.getElementById('modelFilter').addEventListener('compositionstart', function () { composing = true; });
    document.getElementById('modelFilter').addEventListener('compositionend', function () {
      composing = false;
      handleSearch();
    });

    function clearSearch() {
      const input = document.getElementById('modelFilter');
      input.value = '';
      document.getElementById('searchClear').classList.remove('show');
      applyFilters();
      input.focus();
    }

    function resetFilters() {
      clearSearch();
      setFilter('all', document.querySelector('.seg-btn'));
    }

    function applyFilters() {
      const q = (document.getElementById('modelFilter').value || '').trim().toLowerCase();
      const rows = document.querySelectorAll('#tableBody tr');
      let shown = 0;

      rows.forEach(function (r) {
        const m = (r.getAttribute('data-model') || '').toLowerCase();
        const mdi = parseFloat(r.getAttribute('data-sort-mdi') || '0');

        let matchFilter = true;
        if (currentFilterType === 'high') {
          matchFilter = mdi > 10;
        } else if (currentFilterType === 'low') {
          matchFilter = mdi <= 10;
        }

        const matchSearch = q === '' || m.indexOf(q) !== -1;
        const visible = matchFilter && matchSearch;
        r.hidden = !visible;
        if (visible) shown += 1;
      });

      document.getElementById('resultCount').textContent = '显示 ' + shown + ' / ' + rows.length + ' 个模型';
      document.getElementById('tableEmpty').classList.toggle('show', shown === 0);
    }

    /* ---------- table sorting ---------- */
    let sortState = { key: 'rank', dir: 'desc' };
    function sortTable(key, btn) {
      const th = btn.closest('th');
      const dir = sortState.key === key && sortState.dir === 'desc' ? 'asc' : 'desc';
      sortState = { key: key, dir: dir };

      const head = document.getElementById('tableHead');
      head.querySelectorAll('th').forEach(function (h) {
        if (h.hasAttribute('aria-sort')) h.setAttribute('aria-sort', 'none');
      });
      th.setAttribute('aria-sort', dir === 'desc' ? 'descending' : 'ascending');

      const tbody = document.getElementById('tableBody');
      const rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      const attr = { rank: 'data-sort-rank', count: 'data-sort-count', total: 'data-sort-total', rate: 'data-sort-rate', mdi: 'data-sort-mdi' }[key];
      rows.sort(function (a, b) {
        const va = parseFloat(a.getAttribute(attr) || '0');
        const vb = parseFloat(b.getAttribute(attr) || '0');
        return dir === 'desc' ? vb - va : va - vb;
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
    }

    /* ---------- phrase filter on quotes ---------- */
    document.getElementById('phraseChips').addEventListener('click', function (e) {
      const btn = e.target.closest('.phrase-chip');
      if (btn) filterByPhrase(btn.getAttribute('data-phrase') || '', btn);
    });

    function filterByPhrase(phrase, el) {
      const p = phrase.toLowerCase();
      if (activePhrase === p) {
        clearPhraseFilter();
        return;
      }
      activePhrase = p;

      document.querySelectorAll('.phrase-chip').forEach(function (c) {
        c.setAttribute('aria-pressed', c === el ? 'true' : 'false');
      });

      const cards = document.querySelectorAll('#quotesGrid .quote-card');
      let shown = 0;
      cards.forEach(function (c) {
        const cardPhrase = (c.getAttribute('data-phrase') || '').toLowerCase();
        const visible = cardPhrase.indexOf(p) !== -1;
        c.hidden = !visible;
        if (visible) shown += 1;
      });

      document.getElementById('quoteCount').textContent = '显示 ' + shown + ' / ' + cards.length + ' 条';
      document.getElementById('clearPhraseBtn').hidden = false;
      document.getElementById('quotesEmpty').classList.toggle('show', shown === 0);

      document.getElementById('quotes').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }

    function clearPhraseFilter() {
      activePhrase = '';
      document.querySelectorAll('.phrase-chip').forEach(function (c) {
        c.setAttribute('aria-pressed', 'false');
      });
      const cards = document.querySelectorAll('#quotesGrid .quote-card');
      cards.forEach(function (c) { c.hidden = false; });
      document.getElementById('quoteCount').textContent = '显示 ' + cards.length + ' / ' + cards.length + ' 条';
      document.getElementById('clearPhraseBtn').hidden = true;
      document.getElementById('quotesEmpty').classList.remove('show');
    }

    /* ---------- export + share ---------- */
    function buildPayload() {
      return {
        version: reportData.version,
        droolCount: reportData.totalDroolCount,
        assistantMessages: reportData.totalAssistantMessages,
        mdi: reportData.overallDroolIndex,
        sessionsScanned: reportData.totalSessionsScanned,
        modelCount: reportData.modelRankings.length,
        modelEntries: reportData.modelRankings.map(function (m) {
          return {
            model: m.model,
            droolCount: m.droolCount,
            totalMessages: m.totalMessages,
            mdi: m.droolIndex,
          };
        }),
        harnessEntries: Object.values(reportData.harnessStats)
          .filter(function (h) { return h.messageCount > 0; })
          .map(function (h) {
            return {
              harness: h.name,
              droolCount: h.droolCount,
              totalMessages: h.messageCount,
              mdi: h.droolIndex,
            };
          }),
        generatedAt: reportData.generatedAt,
      };
    }

    function copySummaryText() {
      const topModel = reportData.modelRankings[0]?.model || '未知';
      const topCount = reportData.modelRankings[0]?.droolCount || 0;
      const text = [
        '【SHALEME · AI 模型「你说得对」行为基准战报】',
        '--------------------------------------------',
        '· 总体判定分级: ' + reportData.overallDroolLevel.name,
        '· 抓获「你说得对」频次: ' + reportData.totalDroolCount + ' 次',
        '· 分析助手回复样本: ' + reportData.totalAssistantMessages + ' 条',
        '· 模型流口水指数 (MDI): ' + reportData.overallDroolIndex + ' ‰',
        '· 附和频次榜首模型: ' + topModel + ' (' + topCount + ' 次认怂附和)',
        '--------------------------------------------',
        '运行 npx shaleme 或 bunx shaleme 检验你的 AI 模型独立性与顺从倾向！'
      ].join('\\n');

      const done = function () {
        toast('战报摘要已复制到剪贴板');
        const btn = document.getElementById('copyBtn');
        const original = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(function () { btn.textContent = original; }, 1600);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          fallbackCopy(text);
          done();
        });
      } else {
        fallbackCopy(text);
        done();
      }
    }

    function fallbackCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { toast('复制失败，请手动导出 JSON', 'error'); }
      document.body.removeChild(ta);
    }

    function exportPayload() {
      const payload = buildPayload();
      const text = JSON.stringify(payload, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shaleme-score.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('成绩 JSON 已导出');
    }

    function submitToLeaderboard() {
      if (!leaderboardEndpoint) {
        toast('本报告未配置榜单地址，请先导出成绩 JSON');
        return;
      }
      // masthead 和 actions 各有一个上传按钮，状态要同步，否则一个转圈一个可点。
      const btns = document.querySelectorAll('[data-upload-btn]');
      btns.forEach(function (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
        btn.setAttribute('aria-busy', 'true');
        btn.innerHTML = '<span class="spinner"></span>正在上传…';
      });
      const payload = buildPayload();
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = leaderboardEndpoint;
      // Submit as a single JSON field so the server never has to know the
      // individual metric names, the leaderboard owns that schema.
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = 'payload';
      field.value = JSON.stringify(payload);
      form.appendChild(field);
      document.body.appendChild(form);
      form.submit();
    }

    /* ---------- chart tooltip ---------- */
    (function initChartTooltip() {
      const tip = document.getElementById('chartTooltip');
      if (!tip) return;
      const box = document.querySelector('.chart-box');
      document.querySelectorAll('.tl-point').forEach(function (pt) {
        pt.addEventListener('mouseenter', function () {
          tip.textContent = pt.getAttribute('data-date') + ': ' + pt.getAttribute('data-count') + ' 次';
          const boxRect = box.getBoundingClientRect();
          const ptRect = pt.getBoundingClientRect();
          tip.style.left = (ptRect.left - boxRect.left + ptRect.width / 2) + 'px';
          tip.style.top = (ptRect.top - boxRect.top) + 'px';
          tip.hidden = false;
        });
        pt.addEventListener('mouseleave', function () { tip.hidden = true; });
      });
    })();

    /* ---------- sticky table head shadow ---------- */
    (function initStickyHead() {
      const head = document.getElementById('tableHead');
      const table = document.getElementById('benchmarkTable');
      if (!head || !table || !('IntersectionObserver' in window)) return;
      const sentinel = document.createElement('div');
      sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;';
      table.parentElement.insertBefore(sentinel, table);
      const io = new IntersectionObserver(function (entries) {
        head.classList.toggle('stuck', !entries[0].isIntersecting);
      });
      io.observe(sentinel);
    })();

    /* ---------- back to top ---------- */
    (function initBackTop() {
      const btn = document.getElementById('backTop');
      if (!('IntersectionObserver' in window)) return;
      const sentinel = document.createElement('div');
      sentinel.style.cssText = 'position:absolute;top:640px;height:1px;width:1px;';
      document.body.appendChild(sentinel);
      const io = new IntersectionObserver(function (entries) {
        btn.classList.toggle('show', !entries[0].isIntersecting);
      });
      io.observe(sentinel);
    })();

    function backToTop() {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    /* ---------- keyboard: Esc clears search ---------- */
    document.getElementById('modelFilter').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') clearSearch();
    });

    applyFilters();
  </script>
</body>
</html>`;
}

export function writeReportToFile(
  summary: ReportSummary,
  customPath?: string,
  leaderboardEndpoint?: string,
): string {
  let targetPath = customPath;
  if (!targetPath) {
    const downloads = getDownloadsDir();
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .replace(/\..+/, '');
    targetPath = path.join(downloads, `shaleme-report-${timestamp}.html`);
  }

  const html = generateReportHtml(summary, leaderboardEndpoint);
  fs.writeFileSync(targetPath, html, 'utf8');
  return targetPath;
}
