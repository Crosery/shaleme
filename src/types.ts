export type HarnessId =
  | 'claude'
  | 'codex'
  | 'omp'
  | 'pi'
  | 'codebuddy'
  | 'cline'
  | 'openclaw'
  | 'hermes'
  | 'cursor'
  | 'opencode'
  | 'other';

export interface HarnessInfo {
  id: HarnessId;
  name: string;
  icon: string;
  description: string;
  available: boolean;
}

export interface ExtractedMessage {
  harness: HarnessId;
  sessionId: string;
  timestamp: number;
  model: string;
  text: string;
}

export type SycophancyCategory =
  | 'direct_agree'        // 直接认同 / 无脑附和: "你说得对", "你说的对"
  | 'exaggerated_praise'  // 极度谄媚 / 夸张赞同: "你说得完全正确", "你说得太对了"
  | 'instant_surrender'   // 光速认错 / 甩锅自己: "是我疏忽了", "确实是我搞错了"
  | 'blind_compliance'    // 盲从顺从 / 听你的: "你说...我就...", "按你说的办", "听你的"
  | 'polite_rephrase'     // 借坡下驴 / 礼貌附和: "正如你所说", "正如你指出的"
  | 'english_concession'; // 英文认怂: "you're right", "apologies, you are right"

export interface LexiconEntry {
  phrase: string;
  category: SycophancyCategory;
  regex: RegExp;
}

export interface DroolMatch {
  harness: HarnessId;
  sessionId: string;
  timestamp: number;
  model: string;
  phrase: string;
  category: SycophancyCategory;
  snippet: string;
}

export interface DroolLevelInfo {
  level: number;       // 0 ~ 4
  name: string;        // "口水失禁 (Stage 4)"
  badge: string;       // "🤤 口水失禁"
  tagline: string;     // 一句话诊断
  color: string;       // Hex or CSS color
}

export interface ModelStats {
  model: string;
  normalizedModel: string;
  droolCount: number;
  totalMessages: number;
  droolRate: number;        // (droolCount / totalMessages) * 100
  droolIndex: number;       // (droolCount / totalMessages) * 1000, or raw frequency if messages are unknown
  droolLevel: DroolLevelInfo;
  topPhrases: { phrase: string; count: number }[];
  harnesses: HarnessId[];
}

export interface HarnessStats {
  harness: HarnessId;
  name: string;
  droolCount: number;
  messageCount: number;
  droolIndex: number;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface ReportSummary {
  version: string;
  generatedAt: number;
  generatedDate: string;
  totalDroolCount: number;
  totalAssistantMessages: number;
  totalSessionsScanned: number;
  activeHarnessCount: number;
  overallDroolRate: number;
  overallDroolIndex: number;
  overallDroolLevel: DroolLevelInfo;
  modelRankings: ModelStats[];
  harnessStats: Record<HarnessId, HarnessStats>;
  dailyTimeline: DailyPoint[];
  phraseCloud: { text: string; count: number; category: SycophancyCategory }[];
  hallOfShame: DroolMatch[];
}
