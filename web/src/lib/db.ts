/**
 * D1 数据访问层。
 *
 * 所有 SQL 集中在这里，页面和 API 路由只调函数。榜单名次统一由
 * ROW_NUMBER() OVER (ORDER BY drool_count DESC, mdi DESC, assistant_messages DESC, updated_at ASC)
 * 算出，改动排序口径时只改 SQL 常量，不要散落到各个页面。
 */

import { env } from 'cloudflare:workers';
import { parseStoredPayload } from './report';
import type {
  LeaderboardEntry,
  LeaderboardProfileWithReport,
  LeaderboardReportPayload,
  LeaderboardSummary,
  ModelDashboard,
  ModelLeaderboardEntry,
  ModelLeaderboardGroup,
  Viewer,
} from './types';

/**
 * 名次口径。四处地方用它，必须完全一致：
 * 列表查询的 ORDER BY、ROW_NUMBER() 的窗口、以及 0001_init.sql 里的索引。
 */
const RANK_ORDER_SQL = 'drool_count DESC, mdi DESC, assistant_messages DESC, updated_at ASC';

const ENTRY_COLUMNS_SQL = `
  github_id AS githubId,
  login,
  display_name AS displayName,
  avatar_url AS avatarUrl,
  profile_url AS profileUrl,
  drool_count AS droolCount,
  assistant_messages AS assistantMessages,
  mdi,
  sessions_scanned AS sessionsScanned,
  model_count AS modelCount,
  updated_at AS updatedAt
`;

type LeaderboardRow = Omit<LeaderboardEntry, 'rank'>;

type LeaderboardProfileRow = LeaderboardRow & {
  rank: number;
  version: string;
  generatedAt: number;
  payloadJson: string | null;
  submittedAt: number | null;
};

type SummaryRow = {
  participants: number;
  totalDrool: number;
  totalAssistantMessages: number;
  averageMdi: number;
};

type PendingSubmissionRow = {
  payloadJson: string;
};

type ModelLeaderboardRow = Omit<ModelLeaderboardEntry, 'rank'> & { rank: number };

type HottestModelRow = {
  model: string;
  droolCount: number;
  assistantMessages: number;
  mdi: number;
  contributors: number;
};

function getDatabase() {
  if (!env.DB) {
    throw new Error('D1 binding DB is missing.');
  }

  return env.DB;
}

export function hasDatabaseBinding() {
  return Boolean(env.DB);
}

export async function listLeaderboard(limit = 100) {
  const database = getDatabase();
  const result = await database
    .prepare(
      `
        SELECT ${ENTRY_COLUMNS_SQL}
        FROM leaderboard_entries
        ORDER BY ${RANK_ORDER_SQL}
        LIMIT ?
      `,
    )
    .bind(limit)
    .all<LeaderboardRow>();

  return result.results.map((row, index) => ({
    rank: index + 1,
    ...row,
  })) satisfies LeaderboardEntry[];
}

export async function getLeaderboardSummary() {
  const database = getDatabase();
  const row = await database
    .prepare(
      `
        SELECT
          COUNT(*) AS participants,
          COALESCE(SUM(drool_count), 0) AS totalDrool,
          COALESCE(SUM(assistant_messages), 0) AS totalAssistantMessages,
          COALESCE(AVG(mdi), 0) AS averageMdi
        FROM leaderboard_entries
      `,
    )
    .first<SummaryRow>();

  return {
    participants: Number(row?.participants || 0),
    totalDrool: Number(row?.totalDrool || 0),
    totalAssistantMessages: Number(row?.totalAssistantMessages || 0),
    averageMdi: Number(row?.averageMdi || 0),
  } satisfies LeaderboardSummary;
}

/**
 * 单个人的名次 + 最近一次提交。
 *
 * 名次必须整表算：只取自己那一行是算不出「第几名」的。数据量大了再考虑物化，
 * 现在这个规模（一行一个人）没问题。
 */
async function getLeaderboardProfileByPredicate(
  predicateSql: string,
  predicateValue: number | string,
) {
  const database = getDatabase();
  const row = await database
    .prepare(
      `
        WITH ranked_entries AS (
          SELECT
            github_id,
            login,
            display_name,
            avatar_url,
            profile_url,
            drool_count,
            assistant_messages,
            mdi,
            sessions_scanned,
            model_count,
            version,
            generated_at,
            updated_at,
            ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER_SQL}) AS rank
          FROM leaderboard_entries
        )
        SELECT
          ranked_entries.rank AS rank,
          ranked_entries.github_id AS githubId,
          ranked_entries.login AS login,
          ranked_entries.display_name AS displayName,
          ranked_entries.avatar_url AS avatarUrl,
          ranked_entries.profile_url AS profileUrl,
          ranked_entries.drool_count AS droolCount,
          ranked_entries.assistant_messages AS assistantMessages,
          ranked_entries.mdi AS mdi,
          ranked_entries.sessions_scanned AS sessionsScanned,
          ranked_entries.model_count AS modelCount,
          ranked_entries.updated_at AS updatedAt,
          ranked_entries.version AS version,
          ranked_entries.generated_at AS generatedAt,
          latest.payload_json AS payloadJson,
          latest.created_at AS submittedAt
        FROM ranked_entries
        LEFT JOIN leaderboard_submissions AS latest
          ON latest.id = (
            SELECT id
            FROM leaderboard_submissions
            WHERE github_id = ranked_entries.github_id
            ORDER BY created_at DESC
            LIMIT 1
          )
        WHERE ${predicateSql}
      `,
    )
    .bind(predicateValue)
    .first<LeaderboardProfileRow>();

  if (!row) {
    return null;
  }

  return {
    rank: row.rank,
    githubId: row.githubId,
    login: row.login,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    profileUrl: row.profileUrl,
    droolCount: row.droolCount,
    assistantMessages: row.assistantMessages,
    mdi: row.mdi,
    sessionsScanned: row.sessionsScanned,
    modelCount: row.modelCount,
    updatedAt: row.updatedAt,
    version: row.version,
    generatedAt: row.generatedAt,
    submittedAt: row.submittedAt ?? row.updatedAt,
    report: parseStoredPayload(row.payloadJson),
  } satisfies LeaderboardProfileWithReport;
}

export async function getLeaderboardProfileByLogin(login: string) {
  return getLeaderboardProfileByPredicate('ranked_entries.login = ? COLLATE NOCASE', login);
}

export async function getLeaderboardProfileByGithubId(githubId: number) {
  return getLeaderboardProfileByPredicate('ranked_entries.github_id = ?', githubId);
}

export async function getViewerEntry(githubId: number) {
  const database = getDatabase();
  const row = await database
    .prepare(
      `
        SELECT ${ENTRY_COLUMNS_SQL}
        FROM leaderboard_entries
        WHERE github_id = ?
      `,
    )
    .bind(githubId)
    .first<LeaderboardRow>();

  return row ?? null;
}

/**
 * 单模型榜：同一个人在同一模型上可能留了多条历史记录，先按「本人最好的一次」去重，
 * 再在每个模型内部按 MDI 排名。
 *
 * 注意 PARTITION BY 用 model + github_id 而不是只用 github_id：同一次提交里的模型名
 * 是唯一的，但不同次提交的模型名可能因为版本升级而变，按 github_id 单独分区会错杀。
 */
export async function getModelDashboard(rowsPerModel = 20, hottestModelsLimit = 12) {
  const database = getDatabase();

  const topModelsResult = await database
    .prepare(
      `
        WITH best_per_user AS (
          SELECT
            m.model AS model,
            m.github_id AS githubId,
            m.drool_count AS droolCount,
            m.assistant_messages AS assistantMessages,
            m.mdi AS mdi,
            e.login AS login,
            e.display_name AS displayName,
            e.avatar_url AS avatarUrl,
            ROW_NUMBER() OVER (
              PARTITION BY m.model, m.github_id
              ORDER BY m.mdi DESC, m.drool_count DESC, m.created_at ASC
            ) AS user_rank
          FROM leaderboard_submission_models AS m
          JOIN leaderboard_entries AS e ON e.github_id = m.github_id
        ),
        ranked AS (
          SELECT
            model,
            login,
            displayName,
            avatarUrl,
            droolCount,
            assistantMessages,
            mdi,
            ROW_NUMBER() OVER (
              PARTITION BY model
              ORDER BY mdi DESC, droolCount DESC, assistantMessages DESC, login ASC
            ) AS model_rank
          FROM best_per_user
          WHERE user_rank = 1
        )
        SELECT
          model,
          login,
          displayName,
          avatarUrl,
          droolCount,
          assistantMessages,
          mdi,
          model_rank AS rank
        FROM ranked
        WHERE model_rank <= ?
        ORDER BY model ASC, rank ASC
      `,
    )
    .bind(rowsPerModel)
    .all<ModelLeaderboardRow>();

  const hottestModelsResult = await database
    .prepare(
      `
        SELECT
          model,
          COALESCE(SUM(drool_count), 0) AS droolCount,
          COALESCE(SUM(assistant_messages), 0) AS assistantMessages,
          CASE WHEN SUM(assistant_messages) > 0
            THEN SUM(drool_count) * 1000.0 / SUM(assistant_messages)
            ELSE 0
          END AS mdi,
          COUNT(DISTINCT github_id) AS contributors
        FROM leaderboard_submission_models
        GROUP BY model
        ORDER BY mdi DESC, droolCount DESC, model ASC
        LIMIT ?
      `,
    )
    .bind(hottestModelsLimit)
    .all<HottestModelRow>();

  // rows 已经按 model ASC, rank ASC 返回，按顺序分组即可，不必再排序。
  const modelGroups: ModelLeaderboardGroup[] = [];

  for (const row of topModelsResult.results) {
    const last = modelGroups[modelGroups.length - 1];

    if (last?.model === row.model) {
      last.rows.push(row);
    } else {
      modelGroups.push({ model: row.model, rows: [row] });
    }
  }

  return {
    modelGroups,
    hottestModels: hottestModelsResult.results.map((row) => ({
      model: row.model,
      droolCount: Number(row.droolCount),
      assistantMessages: Number(row.assistantMessages),
      mdi: Number(row.mdi),
      contributors: Number(row.contributors),
    })),
  } satisfies ModelDashboard;
}

/**
 * 把未登录的提交暂存到服务端，返回一次性 token。
 *
 * 只靠 cookie 带载荷是不行的：跨站表单 POST 可能整个 cookie 都到不了，
 * 而 URL 里塞不下完整载荷。所以载荷进库，URL/cookie 里只走 token。
 */
export async function createPendingSubmission(payload: LeaderboardReportPayload, ttlMs: number) {
  const database = getDatabase();
  const createdAt = Date.now();
  const expiresAt = createdAt + ttlMs;
  const token = crypto.randomUUID();

  await database
    .prepare(
      `
        INSERT INTO leaderboard_pending_submissions (token, payload_json, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `,
    )
    .bind(token, JSON.stringify(payload), createdAt, expiresAt)
    .run();

  return token;
}

/** 取出并删除。token 是一次性的；顺手清掉所有过期行，省一个定时任务。 */
export async function consumePendingSubmission(token: string) {
  const database = getDatabase();
  const now = Date.now();
  const row = await database
    .prepare(
      `
        SELECT payload_json AS payloadJson
        FROM leaderboard_pending_submissions
        WHERE token = ?
          AND expires_at > ?
      `,
    )
    .bind(token, now)
    .first<PendingSubmissionRow>();

  await database
    .prepare(
      `
        DELETE FROM leaderboard_pending_submissions
        WHERE token = ?
           OR expires_at <= ?
      `,
    )
    .bind(token, now)
    .run();

  if (!row) {
    return null;
  }

  return parseStoredPayload(row.payloadJson);
}

export async function countPendingSubmissions() {
  const database = getDatabase();
  const row = await database
    .prepare('SELECT COUNT(*) AS total FROM leaderboard_pending_submissions WHERE expires_at > ?')
    .bind(Date.now())
    .first<{ total: number }>();

  return Number(row?.total || 0);
}

export async function deletePendingSubmission(token: string) {
  const database = getDatabase();

  await database
    .prepare('DELETE FROM leaderboard_pending_submissions WHERE token = ?')
    .bind(token)
    .run();
}

export async function getLatestSubmissionPayload(githubId: number) {
  const database = getDatabase();
  const row = await database
    .prepare(
      `
        SELECT payload_json AS payloadJson
        FROM leaderboard_submissions
        WHERE github_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
    )
    .bind(githubId)
    .first<{ payloadJson: string | null }>();

  return parseStoredPayload(row?.payloadJson);
}

export async function upsertLeaderboardEntry(
  viewer: Viewer,
  submission: LeaderboardReportPayload,
) {
  const database = getDatabase();
  const updatedAt = Date.now();
  const payloadJson = JSON.stringify(submission);

  await database
    .prepare(
      `
        INSERT INTO leaderboard_entries (
          github_id,
          login,
          display_name,
          avatar_url,
          profile_url,
          drool_count,
          assistant_messages,
          mdi,
          sessions_scanned,
          model_count,
          version,
          generated_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(github_id) DO UPDATE SET
          login = excluded.login,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          profile_url = excluded.profile_url,
          drool_count = excluded.drool_count,
          assistant_messages = excluded.assistant_messages,
          mdi = excluded.mdi,
          sessions_scanned = excluded.sessions_scanned,
          model_count = excluded.model_count,
          version = excluded.version,
          generated_at = excluded.generated_at,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      viewer.githubId,
      viewer.login,
      viewer.displayName,
      viewer.avatarUrl,
      viewer.profileUrl,
      submission.droolCount,
      submission.assistantMessages,
      submission.mdi,
      submission.sessionsScanned,
      submission.modelCount,
      submission.version,
      submission.generatedAt,
      updatedAt,
    )
    .run();

  const submissionResult = await database
    .prepare(
      `
        INSERT INTO leaderboard_submissions (
          github_id,
          drool_count,
          assistant_messages,
          mdi,
          sessions_scanned,
          model_count,
          version,
          generated_at,
          payload_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      viewer.githubId,
      submission.droolCount,
      submission.assistantMessages,
      submission.mdi,
      submission.sessionsScanned,
      submission.modelCount,
      submission.version,
      submission.generatedAt,
      payloadJson,
      updatedAt,
    )
    .run();

  const submissionId = Number(submissionResult.meta.last_row_id || 0);

  if (!submissionId || submission.modelEntries.length === 0) {
    return;
  }

  const insertStatements = submission.modelEntries.map((entry) =>
    database
      .prepare(
        `
          INSERT INTO leaderboard_submission_models (
            submission_id,
            github_id,
            model,
            drool_count,
            assistant_messages,
            mdi,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        submissionId,
        viewer.githubId,
        entry.model,
        entry.droolCount,
        entry.totalMessages,
        entry.mdi,
        updatedAt,
      ),
  );

  await database.batch(insertStatements);
}
