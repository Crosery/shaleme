/**
 * Leaderboard submission payload construction.
 *
 * The report embeds a payload of this shape so it can be exported as JSON or
 * POSTed to a leaderboard. This is the only place that decides what leaves the
 * user's machine, so it stays deliberately narrow: counts and model names, no
 * message text, no quotes, no paths, no identity. Identity comes from whichever
 * account the submitter authenticates with on the leaderboard side.
 */

import {
  LeaderboardReportPayload,
  ModelLeaderboardEntry,
  ReportSummary,
} from '../types';

export function buildLeaderboardPayload(summary: ReportSummary): LeaderboardReportPayload {
  const modelEntries: ModelLeaderboardEntry[] = summary.modelRankings.map((m) => ({
    model: m.model,
    droolCount: m.droolCount,
    totalMessages: m.totalMessages,
    mdi: m.droolIndex,
  }));

  return {
    version: summary.version,
    droolCount: summary.totalDroolCount,
    assistantMessages: summary.totalAssistantMessages,
    mdi: summary.overallDroolIndex,
    sessionsScanned: summary.totalSessionsScanned,
    modelCount: summary.modelRankings.length,
    modelEntries,
    generatedAt: summary.generatedAt,
  };
}
