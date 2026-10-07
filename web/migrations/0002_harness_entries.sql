-- Harness 榜：每次提交附带的按 Agent 平台明细，挂在 leaderboard_submissions.id 下。
-- 与 leaderboard_submission_models 同构：只存计数，不存对话内容。
-- harness 存展示名（Claude Code / Codex / OMP / Pi Agent / ...），跨 CLI 版本稳定。

CREATE TABLE IF NOT EXISTS leaderboard_submission_harnesses (
  submission_id INTEGER NOT NULL,
  github_id INTEGER NOT NULL,
  harness TEXT NOT NULL,
  drool_count INTEGER NOT NULL DEFAULT 0,
  assistant_messages INTEGER NOT NULL DEFAULT 0,
  mdi REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (submission_id, harness),
  FOREIGN KEY (submission_id) REFERENCES leaderboard_submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS leaderboard_submission_harnesses_user_idx
  ON leaderboard_submission_harnesses (github_id, created_at DESC);

CREATE INDEX IF NOT EXISTS leaderboard_submission_harnesses_harness_idx
  ON leaderboard_submission_harnesses (harness, mdi DESC, drool_count DESC);
