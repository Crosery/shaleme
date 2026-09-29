/**
 * 榜单侧的类型定义。
 *
 * `LeaderboardReportPayload` 必须和 CLI 侧的 `src/types.ts` 保持一致：它是唯一的
 * 上传契约，字段名对不上就是静默丢数据，改动时两边一起改。
 */

export type Viewer = {
  githubId: number;
  login: string;
  displayName: string;
  avatarUrl: string;
  profileUrl: string;
};

/** 提交载荷里的单模型行，对应 CLI 的 ModelLeaderboardEntry。 */
export type ModelEntry = {
  model: string;
  droolCount: number;
  totalMessages: number;
  mdi: number;
};

/**
 * 报告页「上传到榜单」POST 上来的 JSON，字段与 CLI 的
 * `LeaderboardReportPayload` 一一对应。
 */
export type LeaderboardReportPayload = {
  version: string;
  /** 命中「你说得对」类短语的总次数。 */
  droolCount: number;
  /** 扫描到的 assistant 消息总数，MDI 的分母。 */
  assistantMessages: number;
  /** 每千条 assistant 消息的命中次数。 */
  mdi: number;
  sessionsScanned: number;
  modelCount: number;
  modelEntries: ModelEntry[];
  generatedAt: number;
};

export type LeaderboardEntry = {
  rank: number;
  githubId: number;
  login: string;
  displayName: string;
  avatarUrl: string;
  profileUrl: string;
  droolCount: number;
  assistantMessages: number;
  mdi: number;
  sessionsScanned: number;
  modelCount: number;
  updatedAt: number;
};

export type LeaderboardProfile = LeaderboardEntry & {
  version: string;
  generatedAt: number;
  submittedAt: number;
};

/** 个人页用：名次与计数来自 entries 行，模型明细来自最近一次提交的载荷。 */
export type LeaderboardProfileWithReport = LeaderboardProfile & {
  report: LeaderboardReportPayload;
};

export type LeaderboardSummary = {
  participants: number;
  totalDrool: number;
  totalAssistantMessages: number;
  averageMdi: number;
};

/** 单模型榜的一行：同一个人在同一模型上只留最好的一次，rank 是该模型内的名次。 */
export type ModelLeaderboardEntry = {
  rank: number;
  model: string;
  login: string;
  displayName: string;
  avatarUrl: string;
  droolCount: number;
  assistantMessages: number;
  mdi: number;
};

export type ModelLeaderboardGroup = {
  model: string;
  rows: ModelLeaderboardEntry[];
};

export type HottestModel = {
  model: string;
  droolCount: number;
  assistantMessages: number;
  mdi: number;
  contributors: number;
};

export type ModelDashboard = {
  /** 模型维度的面板，每个模型内按 MDI 排名。 */
  modelGroups: ModelLeaderboardGroup[];
  /** 把所有人在同一模型上的数据汇总后重算 MDI，衡量模型本身的倾向。 */
  hottestModels: HottestModel[];
};
