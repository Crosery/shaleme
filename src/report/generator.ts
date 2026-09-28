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

  // Build podium items
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
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        <!-- Horizontal grid lines -->
        <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="rgba(255,255,255,0.07)" />
        <line x1="${padding}" y1="${padding + chartH / 2}" x2="${width - padding}" y2="${padding + chartH / 2}" stroke="rgba(255,255,255,0.07)" />
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(255,255,255,0.15)" />

        <!-- Area & line -->
        <path d="${areaData}" fill="url(#areaGradient)" />
        <path d="${pathData}" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Points -->
        ${pointsCoords
          .map(
            (pt) => `
          <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#fbbf24" stroke="#1e1e24" stroke-width="2">
            <title>${pt.date}: ${pt.count} 次「你说得对」</title>
          </circle>
        `,
          )
          .join('')}
      </svg>
      <div class="timeline-labels">
        <span>${timelinePoints[0]?.date || ''}</span>
        <span>共 ${timelinePoints.length} 天观测</span>
        <span>${timelinePoints[timelinePoints.length - 1]?.date || ''}</span>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>傻了么 (shaleme) - AI 模型流口水指数分析报告</title>
  <style>
    :root {
      --bg: #0b0f19;
      --bg-card: #131a2b;
      --bg-card-hover: #1a233a;
      --border: rgba(255, 255, 255, 0.08);
      --border-accent: rgba(245, 158, 11, 0.3);
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #f59e0b;
      --accent-glow: rgba(245, 158, 11, 0.2);
      --primary: #6366f1;
      --success: #10b981;
      --warning: #f97316;
      --danger: #ef4444;
      --radius: 14px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      line-height: 1.6;
      padding: 30px 20px 80px;
      min-height: 100vh;
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
    }

    /* Header */
    header {
      text-align: center;
      margin-bottom: 40px;
      position: relative;
    }
    .brand-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(245, 158, 11, 0.12);
      color: #fbbf24;
      padding: 6px 16px;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
      border: 1px solid rgba(245, 158, 11, 0.25);
      margin-bottom: 16px;
    }
    h1 {
      font-size: 2.8rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, #ffffff 40%, #fbbf24 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
      max-width: 650px;
      margin: 0 auto 20px;
    }
    .meta-bar {
      display: flex;
      justify-content: center;
      gap: 16px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    /* Master Score Grid */
    .score-grid {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 36px;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 22px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    }
    .card-master {
      background: linear-gradient(145deg, #182238 0%, #111827 100%);
      border: 1px solid var(--border-accent);
      box-shadow: 0 0 30px var(--accent-glow);
    }
    .card-title {
      font-size: 0.85rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .card-value {
      font-size: 2.2rem;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    .card-value small {
      font-size: 0.95rem;
      font-weight: 500;
      color: var(--text-muted);
    }
    .card-badge {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 700;
      background: ${summary.overallDroolLevel.color}22;
      color: ${summary.overallDroolLevel.color};
      border: 1px solid ${summary.overallDroolLevel.color}44;
    }
    .card-desc {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-top: 8px;
    }

    /* Section Headings */
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 1.4rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Podium */
    .podium-container {
      display: grid;
      grid-template-columns: 1fr 1.15fr 1fr;
      gap: 16px;
      align-items: flex-end;
      margin-bottom: 30px;
    }
    .podium-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px 20px;
      text-align: center;
      position: relative;
      transition: transform 0.2s ease;
    }
    .podium-card:hover {
      transform: translateY(-4px);
    }
    .podium-1 {
      border: 1px solid rgba(245, 158, 11, 0.4);
      background: linear-gradient(180deg, rgba(245, 158, 11, 0.12) 0%, var(--bg-card) 60%);
      box-shadow: 0 0 25px rgba(245, 158, 11, 0.2);
    }
    .podium-2 {
      border: 1px solid rgba(148, 163, 184, 0.3);
      background: linear-gradient(180deg, rgba(148, 163, 184, 0.08) 0%, var(--bg-card) 60%);
    }
    .podium-3 {
      border: 1px solid rgba(180, 83, 9, 0.3);
      background: linear-gradient(180deg, rgba(180, 83, 9, 0.08) 0%, var(--bg-card) 60%);
    }
    .podium-medal {
      font-size: 2.4rem;
      margin-bottom: 8px;
    }
    .podium-model {
      font-size: 1.25rem;
      font-weight: 700;
      color: #fff;
      word-break: break-all;
      margin-bottom: 8px;
    }
    .podium-count {
      font-size: 1.8rem;
      font-weight: 800;
      color: #fbbf24;
    }
    .podium-index {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    /* Table */
    .table-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 36px;
      overflow-x: auto;
    }
    .search-box {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      width: 260px;
      font-size: 0.9rem;
    }
    .search-box:focus {
      outline: none;
      border-color: var(--accent);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 14px;
      font-size: 0.95rem;
    }
    th {
      text-align: left;
      padding: 12px 14px;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    td {
      padding: 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    tr:hover td {
      background: var(--bg-card-hover);
    }
    .rank-cell {
      font-weight: 700;
      width: 45px;
    }
    .model-name {
      font-weight: 600;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .harness-badge {
      display: inline-block;
      font-size: 0.72rem;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }
    .level-chip {
      display: inline-block;
      font-size: 0.78rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 6px;
    }

    /* Harness grid */
    .harness-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 36px;
    }
    .harness-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
    }
    .harness-name {
      font-size: 0.95rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
    }
    .harness-stats-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .harness-bar {
      height: 6px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 10px;
    }
    .harness-bar-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
    }

    /* Timeline */
    .timeline-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 36px;
    }
    .timeline-svg {
      width: 100%;
      height: 220px;
    }
    .timeline-labels {
      display: flex;
      justify-content: space-between;
      color: var(--text-muted);
      font-size: 0.8rem;
      margin-top: 8px;
    }

    /* Phrase Cloud */
    .cloud-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 36px;
    }
    .cloud-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .cloud-chip {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 0.9rem;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .cloud-chip:hover {
      border-color: var(--accent);
      background: rgba(245, 158, 11, 0.1);
      transform: scale(1.04);
    }
    .cloud-count {
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--accent);
      background: rgba(245, 158, 11, 0.15);
      padding: 2px 7px;
      border-radius: 10px;
    }

    /* Hall of shame quotes */
    .shame-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
      margin-bottom: 40px;
    }
    .shame-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
      font-size: 0.9rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
    }
    .shame-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      font-size: 0.78rem;
    }
    .shame-quote {
      color: #cbd5e1;
      font-style: italic;
      line-height: 1.5;
      margin-bottom: 12px;
    }
    .highlight-phrase {
      background: rgba(245, 158, 11, 0.25);
      color: #fde68a;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 4px;
      font-style: normal;
    }
    .shame-footer {
      font-size: 0.75rem;
      color: var(--text-muted);
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 8px;
      display: flex;
      justify-content: space-between;
    }

    /* Action bar */
    .actions-bar {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-top: 40px;
    }
    .btn {
      padding: 12px 24px;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
    }
    .btn-primary {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: #111827;
      box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3);
    }
    .btn-primary:hover {
      box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4);
      transform: translateY(-2px);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      border: 1px solid var(--border);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.12);
    }

    footer {
      text-align: center;
      margin-top: 60px;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    @media (max-width: 800px) {
      .score-grid { grid-template-columns: 1fr; }
      .podium-container { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand-tag">🤤 傻了么 SHALEME 2026</div>
      <h1>AI 模型流口水指数分析报告</h1>
      <p class="subtitle">全面透视各大 Coding Agent 历史会话，量化各模型附和谄媚、光速点头说「你说得对」的赛博流口水程度</p>
      <div class="meta-bar">
        <span>🕒 生成时间: ${summary.generatedDate}</span>
        <span>📁 扫描会话: ${summary.totalSessionsScanned} 场</span>
        <span>🤖 活跃 Agent: ${summary.activeHarnessCount} 个平台</span>
      </div>
    </header>

    <!-- Master Score Cards -->
    <div class="score-grid">
      <div class="card card-master">
        <div class="card-title">综合流口水诊断</div>
        <div class="card-value">${summary.overallDroolLevel.badge}</div>
        <div class="card-badge">${summary.overallDroolLevel.name}</div>
        <div class="card-desc">${summary.overallDroolLevel.tagline}</div>
      </div>

      <div class="card">
        <div class="card-title">「你说得对」总计</div>
        <div class="card-value">${summary.totalDroolCount.toLocaleString()} <small>次</small></div>
        <div class="card-desc">在所有的助手消息中被抓获附和认同的次数</div>
      </div>

      <div class="card">
        <div class="card-title">流口水指数 (MDI)</div>
        <div class="card-value">${summary.overallDroolIndex} <small>‰</small></div>
        <div class="card-desc">平均每 1000 次模型问答中说「你说得对」的次数</div>
      </div>

      <div class="card">
        <div class="card-title">总分析消息</div>
        <div class="card-value">${summary.totalAssistantMessages.toLocaleString()} <small>条</small></div>
        <div class="card-desc">跨平台本地 Agent 的完整模型回复条数</div>
      </div>
    </div>

    <!-- Podium: Top 3 Models -->
    ${
      top1
        ? `
    <div class="section-header">
      <h2 class="section-title">🏆 赛博点头狂魔金榜 (Top 3)</h2>
    </div>
    <div class="podium-container">
      ${
        top2
          ? `
      <div class="podium-card podium-2">
        <div class="podium-medal">🥈</div>
        <div class="podium-model">${escapeHtml(top2.model)}</div>
        <div class="podium-count">${top2.droolCount} 次</div>
        <div class="podium-index">流口水指数: ${top2.droolIndex} ‰</div>
        <div class="card-badge" style="background:${top2.droolLevel.color}22; color:${top2.droolLevel.color}">${top2.droolLevel.badge}</div>
      </div>`
          : '<div></div>'
      }

      <div class="podium-card podium-1">
        <div class="podium-medal">👑 🥇</div>
        <div class="podium-model">${escapeHtml(top1.model)}</div>
        <div class="podium-count">${top1.droolCount} 次</div>
        <div class="podium-index">流口水指数: ${top1.droolIndex} ‰ (${top1.droolRate}% 概率秒怂)</div>
        <div class="card-badge" style="background:${top1.droolLevel.color}22; color:${top1.droolLevel.color}">${top1.droolLevel.badge}</div>
      </div>

      ${
        top3
          ? `
      <div class="podium-card podium-3">
        <div class="podium-medal">🥉</div>
        <div class="podium-model">${escapeHtml(top3.model)}</div>
        <div class="podium-count">${top3.droolCount} 次</div>
        <div class="podium-index">流口水指数: ${top3.droolIndex} ‰</div>
        <div class="card-badge" style="background:${top3.droolLevel.color}22; color:${top3.droolLevel.color}">${top3.droolLevel.badge}</div>
      </div>`
          : '<div></div>'
      }
    </div>
    `
        : ''
    }

    <!-- Leaderboard Table -->
    <div class="table-card">
      <div class="section-header" style="margin-bottom: 0;">
        <h2 class="section-title">📊 完整模型流口水排行榜</h2>
        <input type="text" id="modelFilter" class="search-box" placeholder="搜索模型名称..." oninput="filterTable()">
      </div>
      <table id="leaderboardTable">
        <thead>
          <tr>
            <th class="rank-cell">#</th>
            <th>模型名称</th>
            <th>支持 Harness</th>
            <th>流口水次数</th>
            <th>总问答数</th>
            <th>流口水指数</th>
            <th>谄媚等级</th>
            <th>最爱口头禅</th>
          </tr>
        </thead>
        <tbody>
          ${summary.modelRankings
            .map((m, idx) => {
              const topP = m.topPhrases[0]?.phrase || '无';
              return `
            <tr data-model="${escapeHtml(m.model.toLowerCase())}">
              <td class="rank-cell">${idx + 1}</td>
              <td>
                <div class="model-name">
                  <span>${escapeHtml(m.model)}</span>
                </div>
              </td>
              <td>
                ${m.harnesses.map((h) => `<span class="harness-badge">${h}</span>`).join(' ')}
              </td>
              <td style="font-weight: 700; color: #fbbf24;">${m.droolCount}</td>
              <td style="color: var(--text-muted);">${m.totalMessages}</td>
              <td style="font-weight: 600;">${m.droolIndex} ‰</td>
              <td>
                <span class="level-chip" style="background:${m.droolLevel.color}22; color:${m.droolLevel.color}; border: 1px solid ${m.droolLevel.color}44;">
                  ${m.droolLevel.badge}
                </span>
              </td>
              <td style="color: #cbd5e1;">「${escapeHtml(topP)}」</td>
            </tr>
            `;
            })
            .join('')}
        </tbody>
      </table>
    </div>

    <!-- Agent Harness Breakdown -->
    <div class="section-header">
      <h2 class="section-title">🎛️ 各大 Agent 平台谄媚度横评</h2>
    </div>
    <div class="harness-grid">
      ${Object.values(summary.harnessStats)
        .filter((h) => h.messageCount > 0)
        .map((h) => {
          const maxDrool = Math.max(
            ...Object.values(summary.harnessStats).map((s) => s.droolCount),
            1,
          );
          const percent = Math.min(100, Math.round((h.droolCount / maxDrool) * 100));
          return `
        <div class="harness-card">
          <div class="harness-name">${escapeHtml(h.name)}</div>
          <div class="harness-stats-row">
            <span>流口水次数</span>
            <strong style="color: #fbbf24;">${h.droolCount}</strong>
          </div>
          <div class="harness-stats-row">
            <span>分析消息量</span>
            <span>${h.messageCount}</span>
          </div>
          <div class="harness-stats-row">
            <span>流口水指数</span>
            <span>${h.droolIndex} ‰</span>
          </div>
          <div class="harness-bar">
            <div class="harness-bar-fill" style="width: ${percent}%;"></div>
          </div>
        </div>
        `;
        })
        .join('')}
    </div>

    <!-- Timeline Chart -->
    <div class="section-header">
      <h2 class="section-title">📈 历史每日「你说得对」点头趋势</h2>
    </div>
    <div class="timeline-card">
      ${timelineSvg}
    </div>

    <!-- Phrase Cloud -->
    <div class="section-header">
      <h2 class="section-title">💬 经典谄媚高频词云</h2>
    </div>
    <div class="cloud-card">
      <div class="cloud-chips">
        ${summary.phraseCloud
          .map(
            (p) => `
          <div class="cloud-chip" onclick="filterShame('${escapeHtml(p.text)}')">
            <span>${escapeHtml(p.text)}</span>
            <span class="cloud-count">${p.count}</span>
          </div>
        `,
          )
          .join('')}
      </div>
    </div>

    <!-- Hall of Shame -->
    <div class="section-header">
      <h2 class="section-title">🤤 认怂与流口水名场面摘录 (Hall of Shame)</h2>
    </div>
    <div class="shame-grid" id="shameGrid">
      ${summary.hallOfShame
        .map((match) => {
          const escapedText = escapeHtml(match.snippet);
          const highlighted = escapedText.replace(
            new RegExp(escapeHtml(match.phrase), 'gi'),
            `<span class="highlight-phrase">$&</span>`,
          );
          return `
        <div class="shame-card" data-phrase="${escapeHtml(match.phrase.toLowerCase())}">
          <div class="shame-header">
            <span style="font-weight: 600; color: #fff;">${escapeHtml(match.model)}</span>
            <span class="harness-badge">${match.harness}</span>
          </div>
          <div class="shame-quote">${highlighted}</div>
          <div class="shame-footer">
            <span>命中: ${escapeHtml(match.phrase)}</span>
            <span>${new Date(match.timestamp).toLocaleDateString()}</span>
          </div>
        </div>
        `;
        })
        .join('')}
    </div>

    <!-- Action Bar -->
    <div class="actions-bar">
      <button class="btn btn-primary" onclick="copyShareText()">📋 复制分析摘要</button>
      <button class="btn btn-secondary" onclick="window.print()">🖨️ 导出 PDF / 打印</button>
    </div>

    <footer>
      <p>Powered by <strong>shaleme</strong> • 致力于终结大模型谄媚与无脑附和 • Local-First & 0-Tracking</p>
    </footer>
  </div>

  <script>
    const reportData = ${serialized};

    function filterTable() {
      const q = document.getElementById('modelFilter').value.toLowerCase();
      const rows = document.querySelectorAll('#leaderboardTable tbody tr');
      rows.forEach(r => {
        const m = r.getAttribute('data-model') || '';
        r.style.display = m.includes(q) ? '' : 'none';
      });
    }

    function filterShame(phrase) {
      const p = phrase.toLowerCase();
      const cards = document.querySelectorAll('#shameGrid .shame-card');
      cards.forEach(c => {
        const cardPhrase = c.getAttribute('data-phrase') || '';
        c.style.display = cardPhrase.includes(p) ? '' : 'none';
      });
      // Scroll to shame section
      document.getElementById('shameGrid').scrollIntoView({ behavior: 'smooth' });
    }

    function copyShareText() {
      const topModel = reportData.modelRankings[0]?.model || '未知';
      const topCount = reportData.modelRankings[0]?.droolCount || 0;
      const text = [
        '【傻了么 shaleme】AI 模型流口水指数分析报告 🤤',
        '----------------------------------------',
        '• 综合谄媚等级: ' + reportData.overallDroolLevel.name,
        '• 累计抓获「你说得对」: ' + reportData.totalDroolCount + ' 次',
        '• 分析助手消息: ' + reportData.totalAssistantMessages + ' 条',
        '• 流口水指数 (MDI): ' + reportData.overallDroolIndex + ' ‰',
        '• 赛博点头狂魔榜首: ' + topModel + ' (' + topCount + ' 次认怂)',
        '----------------------------------------',
        '使用 npx shaleme 或 bunx shaleme 测测你的模型有多爱流口水！'
      ].join('\\n');

      navigator.clipboard.writeText(text).then(() => {
        alert('报告摘要已复制到剪贴板！可以直接粘贴分享到微信/推特/即刻/V2EX！');
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
