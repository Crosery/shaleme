import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReportSummary } from '../types';
import { escapeHtml } from '../utils/text';

export function getDownloadsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const downloads = path.join(home, 'Downloads');
  if (fs.existsSync(downloads)) {
    return downloads;
  }
  return home;
}

export function generateReportHtml(summary: ReportSummary): string {
  const serialized = JSON.stringify(summary).replace(/</g, '\\u003c');

  // Featured models for top tier showcase
  const top1 = summary.modelRankings[0];
  const top2 = summary.modelRankings[1];
  const top3 = summary.modelRankings[2];

  // Build SVG timeline chart
  const timelinePoints = summary.dailyTimeline;
  let timelineSvg = '<div class="no-data">暂无时间线数据</div>';
  if (timelinePoints.length > 0) {
    const maxCount = Math.max(...timelinePoints.map((p) => p.count), 1);
    const width = 800;
    const height = 220;
    const padding = 40;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    const pointsCoords = timelinePoints.map((p, idx) => {
      const x = padding + (idx / Math.max(timelinePoints.length - 1, 1)) * chartW;
      const y = height - padding - (p.count / maxCount) * chartH;
      return { x, y, ...p };
    });

    const pathData = pointsCoords.reduce((acc, curr, idx) => {
      return idx === 0 ? `M ${curr.x} ${curr.y}` : `${acc} L ${curr.x} ${curr.y}`;
    }, '');

    const areaData =
      pointsCoords.length > 0
        ? `${pathData} L ${pointsCoords[pointsCoords.length - 1].x} ${height - padding} L ${pointsCoords[0].x} ${height - padding} Z`
        : '';

    timelineSvg = `
      <svg viewBox="0 0 ${width} ${height}" class="timeline-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaGradientLight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4f46e5" stop-opacity="0.18" />
            <stop offset="100%" stop-color="#4f46e5" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        <!-- Horizontal grid lines -->
        <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4,4" />
        <line x1="${padding}" y1="${padding + chartH / 2}" x2="${width - padding}" y2="${padding + chartH / 2}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4,4" />
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#cbd5e1" stroke-width="1.5" />

        <!-- Area & line -->
        <path d="${areaData}" fill="url(#areaGradientLight)" />
        <path d="${pathData}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Points -->
        ${pointsCoords
          .map(
            (pt) => `
          <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#ffffff" stroke="#4f46e5" stroke-width="2.5">
            <title>${pt.date}: ${pt.count} 次「你说得对」</title>
          </circle>
        `,
          )
          .join('')}
      </svg>
      <div class="timeline-labels">
        <span>${timelinePoints[0]?.date || ''}</span>
        <span>共 ${timelinePoints.length} 个样本观察日</span>
        <span>${timelinePoints[timelinePoints.length - 1]?.date || ''}</span>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SHALEME - AI 模型「你说得对」行为基准分析报告</title>
  <style>
    :root {
      --bg: #f8fafc;
      --bg-surface: #ffffff;
      --bg-subtle: #f1f5f9;
      --border: #e2e8f0;
      --border-strong: #cbd5e1;
      --text: #0f172a;
      --text-secondary: #475569;
      --text-muted: #64748b;
      --primary: #4f46e5;
      --primary-subtle: #eef2ff;
      --amber: #d97706;
      --amber-subtle: #fef3c7;
      --emerald: #059669;
      --emerald-subtle: #ecfdf5;
      --rose: #e11d48;
      --rose-subtle: #ffe4e6;
      --radius: 10px;
      --radius-sm: 6px;
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 4px 12px -2px rgba(15, 23, 42, 0.05);
      --shadow-lg: 0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.03);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      line-height: 1.5;
      padding: 40px 24px 100px;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      max-width: 1140px;
      margin: 0 auto;
    }

    /* Top Brand & Header */
    header {
      margin-bottom: 32px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 24px;
    }
    .brand-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--primary);
      background: var(--primary-subtle);
      padding: 4px 12px;
      border-radius: var(--radius-sm);
      margin-bottom: 12px;
    }
    h1 {
      font-size: 2.2rem;
      font-weight: 800;
      color: var(--text);
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    .subtitle {
      color: var(--text-secondary);
      font-size: 1.05rem;
      max-width: 760px;
      line-height: 1.6;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      margin-top: 16px;
      font-size: 0.82rem;
      color: var(--text-muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    /* Executive Metric Overview */
    .metrics-grid {
      display: grid;
      grid-template-columns: 1.4fr repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 36px;
    }
    .metric-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 22px;
      box-shadow: var(--shadow-sm);
    }
    .metric-card.highlight {
      border-color: #cbd5e1;
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      box-shadow: var(--shadow);
    }
    .metric-title {
      font-size: 0.78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .metric-value {
      font-size: 2.1rem;
      font-weight: 800;
      color: var(--text);
      letter-spacing: -0.02em;
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    .metric-value small {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-muted);
    }
    .metric-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 10px;
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
      font-weight: 700;
    }
    .metric-desc {
      font-size: 0.82rem;
      color: var(--text-muted);
      margin-top: 8px;
      line-height: 1.45;
    }

    /* Section Component */
    .section-title-wrap {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 16px;
      border-left: 3px solid var(--primary);
      padding-left: 12px;
    }
    .section-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.01em;
    }
    .section-meta {
      font-size: 0.82rem;
      color: var(--text-muted);
    }

    /* Redesigned Showcase Grid: Top 3 */
    .showcase-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 36px;
    }
    .showcase-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
    }
    .showcase-card.rank-1 {
      border-top: 4px solid var(--amber);
      background: linear-gradient(180deg, #fffdf8 0%, #ffffff 50%);
    }
    .showcase-card.rank-2 {
      border-top: 4px solid #64748b;
    }
    .showcase-card.rank-3 {
      border-top: 4px solid #94a3b8;
    }
    .showcase-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    .rank-indicator {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--bg-subtle);
      color: var(--text-secondary);
    }
    .rank-1 .rank-indicator {
      background: var(--amber-subtle);
      color: var(--amber);
    }
    .showcase-model {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 12px;
      word-break: break-all;
    }
    .showcase-stat-hero {
      font-size: 1.8rem;
      font-weight: 800;
      color: var(--text);
      display: flex;
      align-items: baseline;
      gap: 4px;
      margin-bottom: 12px;
    }
    .showcase-stat-hero small {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
    }
    .showcase-details {
      border-top: 1px solid var(--border);
      padding-top: 12px;
      margin-top: 12px;
      font-size: 0.82rem;
      color: var(--text-secondary);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .showcase-detail-row {
      display: flex;
      justify-content: space-between;
    }

    /* Benchmark Table */
    .table-container {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
      margin-bottom: 36px;
      overflow: hidden;
    }
    .table-toolbar {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #fafafa;
    }
    .filter-tabs {
      display: flex;
      gap: 8px;
    }
    .filter-tab {
      padding: 6px 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .filter-tab.active, .filter-tab:hover {
      background: var(--text);
      color: #fff;
      border-color: var(--text);
    }
    .search-input {
      border: 1px solid var(--border-strong);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      width: 260px;
      background: #fff;
      color: var(--text);
    }
    .search-input:focus {
      outline: none;
      border-color: var(--primary);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.88rem;
    }
    th {
      background: #f8fafc;
      padding: 12px 18px;
      font-size: 0.74rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    tbody tr:hover {
      background: #f8fafc;
    }
    .col-rank {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 700;
      color: var(--text-muted);
      width: 50px;
    }
    .col-model {
      font-weight: 700;
      color: var(--text);
    }
    .badge-harness {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--bg-subtle);
      color: var(--text-secondary);
      border: 1px solid #e2e8f0;
      margin-right: 4px;
    }
    .level-tag {
      display: inline-block;
      font-size: 0.74rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.02em;
    }
    .progress-track {
      height: 6px;
      background: var(--bg-subtle);
      border-radius: 3px;
      overflow: hidden;
      width: 90px;
      display: inline-block;
      vertical-align: middle;
      margin-left: 8px;
    }
    .progress-fill {
      height: 100%;
      border-radius: 3px;
    }

    /* Agent breakdown cards */
    .harness-matrix {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 36px;
    }
    .harness-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      box-shadow: var(--shadow-sm);
    }
    .harness-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 8px;
    }
    .harness-stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    .harness-stat-row strong {
      color: var(--text);
    }

    /* Timeline card */
    .timeline-box {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      box-shadow: var(--shadow-sm);
      margin-bottom: 36px;
    }
    .timeline-svg {
      width: 100%;
      height: 200px;
    }
    .timeline-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      font-family: ui-monospace, SFMono-Regular, monospace;
      color: var(--text-muted);
      margin-top: 8px;
    }

    /* Vocabulary section */
    .vocab-box {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      box-shadow: var(--shadow-sm);
      margin-bottom: 36px;
    }
    .vocab-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .vocab-chip {
      background: #fafafa;
      border: 1px solid var(--border);
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .vocab-chip:hover {
      border-color: var(--primary);
      background: var(--primary-subtle);
    }
    .vocab-count {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--primary);
      background: #ffffff;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid var(--border);
    }

    /* Quote cards */
    .quote-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 16px;
      margin-bottom: 40px;
    }
    .quote-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-left: 3px solid var(--amber);
      border-radius: var(--radius);
      padding: 18px 20px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .quote-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      font-size: 0.8rem;
    }
    .quote-body {
      color: var(--text-secondary);
      font-size: 0.88rem;
      line-height: 1.6;
      margin-bottom: 12px;
    }
    .quote-target {
      background: var(--amber-subtle);
      color: #92400e;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
    }
    .quote-footer {
      border-top: 1px solid #f1f5f9;
      padding-top: 10px;
      font-size: 0.74rem;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }

    /* Buttons */
    .button-bar {
      display: flex;
      justify-content: center;
      gap: 14px;
      margin-top: 40px;
    }
    .btn {
      padding: 11px 22px;
      border-radius: var(--radius-sm);
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-dark {
      background: var(--text);
      color: #fff;
    }
    .btn-dark:hover {
      background: #1e293b;
    }
    .btn-outline {
      background: #fff;
      color: var(--text);
      border: 1px solid var(--border-strong);
    }
    .btn-outline:hover {
      background: #f8fafc;
    }

    footer {
      margin-top: 60px;
      border-top: 1px solid var(--border);
      padding-top: 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.82rem;
    }

    @media (max-width: 860px) {
      .metrics-grid { grid-template-columns: 1fr; }
      .showcase-grid { grid-template-columns: 1fr; }
      .table-toolbar { flex-direction: column; gap: 12px; align-items: stretch; }
      .search-input { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand-eyebrow">SHALEME · MODEL BEHAVIOR BENCHMARK 2026</div>
      <h1>AI 模型「你说得对」行为基准分析报告</h1>
      <p class="subtitle">全面透视各大本地 Coding Agent 历史会话，量化各模型在面对用户质疑或交互时的顺从、妥协与附和倾向（Sycophancy Index / MDI）。</p>
      <div class="meta-row">
        <span>报告生成时间: ${summary.generatedDate}</span>
        <span>扫描有效会话: ${summary.totalSessionsScanned} 组</span>
        <span>纳入分析 Agent: ${summary.activeHarnessCount} 个平台</span>
      </div>
    </header>

    <!-- Executive Metrics -->
    <div class="metrics-grid">
      <div class="metric-card highlight">
        <div class="metric-title">综合行为倾向评级</div>
        <div class="metric-value">${summary.overallDroolLevel.name}</div>
        <div class="metric-chip" style="background:${summary.overallDroolLevel.color}15; color:${summary.overallDroolLevel.color}; border: 1px solid ${summary.overallDroolLevel.color}35;">
          ${summary.overallDroolLevel.badge}
        </div>
        <div class="metric-desc">${summary.overallDroolLevel.tagline}</div>
      </div>

      <div class="metric-card">
        <div class="metric-title">抓获「你说得对」频次</div>
        <div class="metric-value">${summary.totalDroolCount.toLocaleString()} <small>次</small></div>
        <div class="metric-desc">在所有分析样本中命中认同附和模式的总次数</div>
      </div>

      <div class="metric-card">
        <div class="metric-title">流口水指数 (MDI)</div>
        <div class="metric-value">${summary.overallDroolIndex} <small>‰</small></div>
        <div class="metric-desc">平均每 1000 次助手回复中出现认怂附和的频率</div>
      </div>

      <div class="metric-card">
        <div class="metric-title">分析消息样本量</div>
        <div class="metric-value">${summary.totalAssistantMessages.toLocaleString()} <small>条</small></div>
        <div class="metric-desc">来自各平台真实工程会话的模型回答总样本</div>
      </div>
    </div>

    <!-- Top Tier Featured Showcase -->
    ${
      top1
        ? `
    <div class="section-title-wrap">
      <div class="section-title">TOP TIER · 附和频次榜首模型</div>
      <div class="section-meta">根据触发绝对次数与频率联合定序</div>
    </div>
    <div class="showcase-grid">
      <div class="showcase-card rank-1">
        <div>
          <div class="showcase-top">
            <span class="rank-indicator">RANK 01</span>
            <span class="level-tag" style="background:${top1.droolLevel.color}15; color:${top1.droolLevel.color}; border:1px solid ${top1.droolLevel.color}35;">
              ${top1.droolLevel.badge}
            </span>
          </div>
          <div class="showcase-model">${escapeHtml(top1.model)}</div>
          <div class="showcase-stat-hero">
            ${top1.droolCount} <small>次「你说得对」</small>
          </div>
        </div>
        <div class="showcase-details">
          <div class="showcase-detail-row">
            <span>流口水指数 MDI:</span>
            <strong>${top1.droolIndex} ‰</strong>
          </div>
          <div class="showcase-detail-row">
            <span>触发概率:</span>
            <strong>${top1.droolRate}%</strong>
          </div>
          <div class="showcase-detail-row">
            <span>主导口头禅:</span>
            <strong>「${escapeHtml(top1.topPhrases[0]?.phrase || '无')}」</strong>
          </div>
          <div class="showcase-detail-row">
            <span>总样本量:</span>
            <span>${top1.totalMessages} 条</span>
          </div>
        </div>
      </div>

      ${
        top2
          ? `
      <div class="showcase-card rank-2">
        <div>
          <div class="showcase-top">
            <span class="rank-indicator">RANK 02</span>
            <span class="level-tag" style="background:${top2.droolLevel.color}15; color:${top2.droolLevel.color}; border:1px solid ${top2.droolLevel.color}35;">
              ${top2.droolLevel.badge}
            </span>
          </div>
          <div class="showcase-model">${escapeHtml(top2.model)}</div>
          <div class="showcase-stat-hero">
            ${top2.droolCount} <small>次「你说得对」</small>
          </div>
        </div>
        <div class="showcase-details">
          <div class="showcase-detail-row">
            <span>流口水指数 MDI:</span>
            <strong>${top2.droolIndex} ‰</strong>
          </div>
          <div class="showcase-detail-row">
            <span>触发概率:</span>
            <strong>${top2.droolRate}%</strong>
          </div>
          <div class="showcase-detail-row">
            <span>主导口头禅:</span>
            <strong>「${escapeHtml(top2.topPhrases[0]?.phrase || '无')}」</strong>
          </div>
          <div class="showcase-detail-row">
            <span>总样本量:</span>
            <span>${top2.totalMessages} 条</span>
          </div>
        </div>
      </div>`
          : '<div></div>'
      }

      ${
        top3
          ? `
      <div class="showcase-card rank-3">
        <div>
          <div class="showcase-top">
            <span class="rank-indicator">RANK 03</span>
            <span class="level-tag" style="background:${top3.droolLevel.color}15; color:${top3.droolLevel.color}; border:1px solid ${top3.droolLevel.color}35;">
              ${top3.droolLevel.badge}
            </span>
          </div>
          <div class="showcase-model">${escapeHtml(top3.model)}</div>
          <div class="showcase-stat-hero">
            ${top3.droolCount} <small>次「你说得对」</small>
          </div>
        </div>
        <div class="showcase-details">
          <div class="showcase-detail-row">
            <span>流口水指数 MDI:</span>
            <strong>${top3.droolIndex} ‰</strong>
          </div>
          <div class="showcase-detail-row">
            <span>触发概率:</span>
            <strong>${top3.droolRate}%</strong>
          </div>
          <div class="showcase-detail-row">
            <span>主导口头禅:</span>
            <strong>「${escapeHtml(top3.topPhrases[0]?.phrase || '无')}」</strong>
          </div>
          <div class="showcase-detail-row">
            <span>总样本量:</span>
            <span>${top3.totalMessages} 条</span>
          </div>
        </div>
      </div>`
          : '<div></div>'
      }
    </div>
    `
        : ''
    }

    <!-- Leaderboard Benchmark Matrix -->
    <div class="section-title-wrap">
      <div class="section-title">BENCHMARK MATRIX · 完整模型行为排行榜</div>
      <div class="section-meta">共 ${summary.modelRankings.length} 个模型纳入比对</div>
    </div>
    <div class="table-container">
      <div class="table-toolbar">
        <div class="filter-tabs">
          <button class="filter-tab active" onclick="setFilter('all', this)">全部模型</button>
          <button class="filter-tab" onclick="setFilter('high', this)">高频附和 (>10‰)</button>
          <button class="filter-tab" onclick="setFilter('low', this)">独立客观 (≤10‰)</button>
        </div>
        <input type="text" id="modelFilter" class="search-input" placeholder="输入模型名称过滤..." oninput="handleSearch()">
      </div>
      <table id="benchmarkTable">
        <thead>
          <tr>
            <th class="col-rank">#</th>
            <th>模型标识</th>
            <th>承载平台</th>
            <th style="text-align: right;">触发次数</th>
            <th style="text-align: right;">总样本条数</th>
            <th style="text-align: right;">触发率</th>
            <th>流口水指数 (MDI)</th>
            <th>倾向评级</th>
            <th>特征附和短语</th>
          </tr>
        </thead>
        <tbody>
          ${summary.modelRankings
            .map((m, idx) => {
              const rankStr = String(idx + 1).padStart(2, '0');
              const topP = m.topPhrases[0]?.phrase || '无';
              const maxMdi = Math.max(...summary.modelRankings.map((r) => r.droolIndex), 1);
              const barWidth = Math.min(100, Math.round((m.droolIndex / maxMdi) * 100));
              return `
            <tr data-model="${escapeHtml(m.model.toLowerCase())}" data-mdi="${m.droolIndex}">
              <td class="col-rank">${rankStr}</td>
              <td class="col-model">${escapeHtml(m.model)}</td>
              <td>
                ${m.harnesses.map((h) => `<span class="badge-harness">${escapeHtml(h)}</span>`).join('')}
              </td>
              <td style="text-align: right; font-weight: 700; color: var(--text);">${m.droolCount}</td>
              <td style="text-align: right; color: var(--text-muted); font-family: ui-monospace, monospace;">${m.totalMessages}</td>
              <td style="text-align: right; font-family: ui-monospace, monospace; color: var(--text-secondary);">${m.droolRate}%</td>
              <td>
                <span style="font-family: ui-monospace, monospace; font-weight: 700;">${m.droolIndex} ‰</span>
                <span class="progress-track">
                  <span class="progress-fill" style="width: ${barWidth}%; background: ${m.droolLevel.color};"></span>
                </span>
              </td>
              <td>
                <span class="level-tag" style="background:${m.droolLevel.color}15; color:${m.droolLevel.color}; border:1px solid ${m.droolLevel.color}35;">
                  ${m.droolLevel.badge}
                </span>
              </td>
              <td style="color: var(--text-secondary); font-size: 0.82rem;">「${escapeHtml(topP)}」</td>
            </tr>
            `;
            })
            .join('')}
        </tbody>
      </table>
    </div>

    <!-- Agent Harness Breakdown -->
    <div class="section-title-wrap">
      <div class="section-title">HARNESS ANALYSIS · 各 Agent 平台行为对比</div>
      <div class="section-meta">观察不同客户端在系统提示词与交互范式下的认同倾向</div>
    </div>
    <div class="harness-matrix">
      ${Object.values(summary.harnessStats)
        .filter((h) => h.messageCount > 0)
        .map((h) => {
          return `
        <div class="harness-card">
          <div class="harness-title">${escapeHtml(h.name)}</div>
          <div class="harness-stat-row">
            <span>认同触发数:</span>
            <strong>${h.droolCount} 次</strong>
          </div>
          <div class="harness-stat-row">
            <span>总样本量:</span>
            <span>${h.messageCount} 条</span>
          </div>
          <div class="harness-stat-row">
            <span>平台 MDI 指数:</span>
            <strong style="color: var(--primary);">${h.droolIndex} ‰</strong>
          </div>
        </div>
        `;
        })
        .join('')}
    </div>

    <!-- Timeline Chart -->
    <div class="section-title-wrap">
      <div class="section-title">HISTORICAL OBSERVATION · 时间序列分布</div>
      <div class="section-meta">每日命中「你说得对」频次走势</div>
    </div>
    <div class="timeline-box">
      ${timelineSvg}
    </div>

    <!-- Vocabulary Cloud -->
    <div class="section-title-wrap">
      <div class="section-title">SYCOPHANCY LEXICON · 特征附和短语聚集</div>
      <div class="section-meta">点击短语可筛选下方引用的名场面语录</div>
    </div>
    <div class="vocab-box">
      <div class="vocab-chips">
        ${summary.phraseCloud
          .map(
            (p) => `
          <div class="vocab-chip" onclick="filterByPhrase('${escapeHtml(p.text)}')">
            <span>${escapeHtml(p.text)}</span>
            <span class="vocab-count">${p.count}</span>
          </div>
        `,
          )
          .join('')}
      </div>
    </div>

    <!-- Citations / Hall of Shame -->
    <div class="section-title-wrap">
      <div class="section-title">CASE CITATIONS · 真实典型附和对话摘录</div>
      <div class="section-meta">模型在被质疑后快速反转或顺从认同的语境片段</div>
    </div>
    <div class="quote-grid" id="quotesGrid">
      ${summary.hallOfShame
        .map((match) => {
          const escapedText = escapeHtml(match.snippet);
          const highlighted = escapedText.replace(
            new RegExp(escapeHtml(match.phrase), 'gi'),
            `<span class="quote-target">$&</span>`,
          );
          return `
        <div class="quote-card" data-phrase="${escapeHtml(match.phrase.toLowerCase())}">
          <div class="quote-header">
            <span style="font-weight: 700; color: var(--text);">${escapeHtml(match.model)}</span>
            <span class="badge-harness">${escapeHtml(match.harness)}</span>
          </div>
          <div class="quote-body">${highlighted}</div>
          <div class="quote-footer">
            <span>模式: ${escapeHtml(match.phrase)}</span>
            <span>${new Date(match.timestamp).toLocaleDateString()}</span>
          </div>
        </div>
        `;
        })
        .join('')}
    </div>

    <!-- Export & Sharing -->
    <div class="button-bar">
      <button class="btn btn-dark" onclick="copySummaryText()">复制基准战报摘要</button>
      <button class="btn btn-outline" onclick="window.print()">打印 / 导出 PDF</button>
    </div>

    <footer>
      <p>SHALEME · AI 模型客观度与顺从行为基准分析 • 纯本地运行 • 零数据外传</p>
    </footer>
  </div>

  <script>
    const reportData = ${serialized};
    let currentFilterType = 'all';

    function setFilter(type, el) {
      currentFilterType = type;
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      applyFilters();
    }

    function handleSearch() {
      applyFilters();
    }

    function applyFilters() {
      const q = (document.getElementById('modelFilter').value || '').toLowerCase();
      const rows = document.querySelectorAll('#benchmarkTable tbody tr');

      rows.forEach(r => {
        const m = (r.getAttribute('data-model') || '').toLowerCase();
        const mdi = parseFloat(r.getAttribute('data-mdi') || '0');

        let matchFilter = true;
        if (currentFilterType === 'high') {
          matchFilter = mdi > 10;
        } else if (currentFilterType === 'low') {
          matchFilter = mdi <= 10;
        }

        const matchSearch = m.includes(q);
        r.style.display = (matchFilter && matchSearch) ? '' : 'none';
      });
    }

    function filterByPhrase(phrase) {
      const p = phrase.toLowerCase();
      const cards = document.querySelectorAll('#quotesGrid .quote-card');
      cards.forEach(c => {
        const cardPhrase = (c.getAttribute('data-phrase') || '').toLowerCase();
        c.style.display = cardPhrase.includes(p) ? '' : 'none';
      });
      document.getElementById('quotesGrid').scrollIntoView({ behavior: 'smooth' });
    }

    function copySummaryText() {
      const topModel = reportData.modelRankings[0]?.model || '未知';
      const topCount = reportData.modelRankings[0]?.droolCount || 0;
      const text = [
        '【SHALEME · AI 模型「你说得对」行为基准战报】',
        '--------------------------------------------',
        '• 总体判定分级: ' + reportData.overallDroolLevel.name,
        '• 抓获「你说得对」频次: ' + reportData.totalDroolCount + ' 次',
        '• 分析助手回复样本: ' + reportData.totalAssistantMessages + ' 条',
        '• 模型流口水指数 (MDI): ' + reportData.overallDroolIndex + ' ‰',
        '• 附和频次榜首模型: ' + topModel + ' (' + topCount + ' 次认怂附和)',
        '--------------------------------------------',
        '运行 npx shaleme 或 bunx shaleme 检验你的 AI 模型独立性与顺从倾向！'
      ].join('\\n');

      navigator.clipboard.writeText(text).then(() => {
        alert('战报摘要已成功复制到剪贴板！');
      }).catch(() => {
        alert(text);
      });
    }
  </script>
</body>
</html>`;
}

export function writeReportToFile(summary: ReportSummary, customPath?: string): string {
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

  const html = generateReportHtml(summary);
  fs.writeFileSync(targetPath, html, 'utf8');
  return targetPath;
}
