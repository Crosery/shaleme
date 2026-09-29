-- shaleme 榜单初始表结构。
--
-- 排名口径固定为 drool_count DESC, mdi DESC, assistant_messages DESC, updated_at ASC，
-- 下面的索引按同一顺序建，让榜单首页的 LIMIT 查询和 ROW_NUMBER() 都能走上索引。

-- 一人一行，按 github_id 去重；重复提交是 upsert 覆盖，不是新增行。
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  github_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  -- 命中「你说得对」类短语的总次数。
  drool_count INTEGER NOT NULL DEFAULT 0,
  -- 扫描到的 assistant 消息总数，即 MDI 的分母。可以为 0（此时服务端把 mdi 归零）。
  assistant_messages INTEGER NOT NULL DEFAULT 0,
  -- 每千条 assistant 消息的命中次数。
  mdi REAL NOT NULL DEFAULT 0,
  sessions_scanned INTEGER NOT NULL DEFAULT 0,
  model_count INTEGER NOT NULL DEFAULT 0,
  -- 提交方 CLI 的版本号，便于排查口径变化。
  version TEXT NOT NULL DEFAULT '',
  -- 报告生成时间，由客户端给出。
  generated_at INTEGER NOT NULL DEFAULT 0,
  -- 本行最后一次被写入的时间，由服务端给出，是排名次序的最后一级。
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS leaderboard_entries_rank_idx
  ON leaderboard_entries (drool_count DESC, mdi DESC, assistant_messages DESC, updated_at ASC);

-- 提交历史：每次成功提交追加一行，用于审计和「最近提交」展示。
CREATE TABLE IF NOT EXISTS leaderboard_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL,
  drool_count INTEGER NOT NULL,
  assistant_messages INTEGER NOT NULL,
  mdi REAL NOT NULL,
  sessions_scanned INTEGER NOT NULL DEFAULT 0,
  model_count INTEGER NOT NULL DEFAULT 0,
  version TEXT NOT NULL DEFAULT '',
  generated_at INTEGER NOT NULL DEFAULT 0,
  -- 规范化后的完整提交载荷，便于原样回放。
  payload_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS leaderboard_submissions_user_idx
  ON leaderboard_submissions (github_id, created_at DESC);

-- 跨站表单 POST 带来的未登录提交：先落库换一个短 TTL 的 token 写进 httpOnly cookie，
-- 走完 GitHub OAuth 后由回调消费。token 是一次性的，消费即删。
CREATE TABLE IF NOT EXISTS leaderboard_pending_submissions (
  token TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS leaderboard_pending_submissions_expires_idx
  ON leaderboard_pending_submissions (expires_at);

-- 每次提交附带的按模型明细，挂在 leaderboard_submissions.id 下。
CREATE TABLE IF NOT EXISTS leaderboard_submission_models (
  submission_id INTEGER NOT NULL,
  github_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  drool_count INTEGER NOT NULL DEFAULT 0,
  assistant_messages INTEGER NOT NULL DEFAULT 0,
  mdi REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (submission_id, model),
  FOREIGN KEY (submission_id) REFERENCES leaderboard_submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS leaderboard_submission_models_user_idx
  ON leaderboard_submission_models (github_id, created_at DESC);

-- 单模型榜的排序口径：同一模型下按 MDI 再按命中次数。
CREATE INDEX IF NOT EXISTS leaderboard_submission_models_model_idx
  ON leaderboard_submission_models (model, mdi DESC, drool_count DESC);
