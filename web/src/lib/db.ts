/**
 * D1 数据访问层。
 *
 * 所有 SQL 集中在这里，页面和 API 路由只调函数。
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
 * 名次口径：贝叶斯收缩分数。
 *
 *   score = (drool + PRIOR_MASS × 全局命中率) / (messages + PRIOR_MASS) × 1000
 *
 * 原始 MDI 对样本量没有记忆：3.5k 条消息的 27.42 会碾压 15k 条消息的 6.8，
 * 但前者可能只是几段闲聊里碰巧连发附和。收缩把小样本往全局均值拉、
 * 大样本几乎不动——信息越多置信度越高，分数越接近真值。
 * PRIOR_MASS = 5000 条伪计数：5k 消息的行约一半权重来自先验，20k+ 基本是实测。
 */
const PRIOR_MASS = 5000;

/**
 * 收缩分数表达式（列名限定前缀由调用方拼接）。
 * prior 子查询 = 全局命中率（Σdrool/Σmessages），全体行共用同一个先验。
 */
function scoreExpr(prefix: string) {
  return (
    `(${prefix}drool_count + ${PRIOR_MASS} * prior.rate) ` +
    `/ (${prefix}assistant_messages + ${PRIOR_MASS}) * 1000`
  );
}

/** 全局命中率先验，CROSS JOIN 进任何排名查询。 */
const PRIOR_CTE_SQL = `
  WITH prior AS (
    SELECT
      CASE WHEN SUM(assistant_messages) > 0
        THEN SUM(drool_count) * 1.0 / SUM(assistant_messages)
        ELSE 0
      END AS rate
    FROM leaderboard_entries
  )
`;

/**
 * 名次口径。改排序只改这里：score（收缩后）优先，同分再看原始信号强度。
 * score 是运行时算出的表达式，不能进索引；数据量大了再物化成列。
 */
const ENTRY_RANK_ORDER_SQL =
  `${scoreExpr('')} DESC, drool_count DESC, assistant_messages DESC, updated_at ASC`;

const MODEL_PRIOR_CTE_SQL = `
  WITH prior AS (
    SELECT
      CASE WHEN SUM(assistant_messages) > 0
        THEN SUM(drool_count) * 1.0 / SUM(assistant_messages)
        ELSE 0
      END AS rate
    FROM leaderboard_submission_models
  )
`;
const MODEL_RANK_ORDER_SQL =
  `${scoreExpr('m.')} DESC, m.drool_count DESC, m.assistant_messages DESC, m.created_at ASC`;

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
  score: number;
  contributors: number;
};

type HottestHarnessRow = Omit<HottestModelRow, 'model'> & { harness: string };

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
        ${PRIOR_CTE_SQL}
        SELECT ${ENTRY_COLUMNS_SQL},
          ${scoreExpr('')} AS score
        FROM leaderboard_entries CROSS JOIN prior
        ORDER BY ${ENTRY_RANK_ORDER_SQL}
        LIMIT ?
      `,
    )
    .bind(limit)
    .all<LeaderboardRow & { score: number }>();

  return result.results.map((row, index) => ({
    rank: index + 1,
    ...row,
    score: Number(row.score),
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
        WITH
          prior AS (
            SELECT
              CASE WHEN SUM(assistant_messages) > 0
                THEN SUM(drool_count) * 1.0 / SUM(assistant_messages)
                ELSE 0
              END AS rate
            FROM leaderboard_entries
          ),
          ranked_entries AS (
            SELECT
              github_id,
              login,
              display_name,
              avatar_url,
              profile_url,
              drool_count,
              assistant_messages,
              mdi,
              ${scoreExpr('')} AS score,
              sessions_scanned,
              model_count,
              version,
              generated_at,
              updated_at,
              ROW_NUMBER() OVER (ORDER BY ${ENTRY_RANK_ORDER_SQL}) AS rank
            FROM leaderboard_entries CROSS JOIN prior
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
          ranked_entries.score AS score,
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
    score: Number(row.score),
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
        ${PRIOR_CTE_SQL}
        SELECT ${ENTRY_COLUMNS_SQL},
          ${scoreExpr('')} AS score
        FROM leaderboard_entries CROSS JOIN prior
        WHERE github_id = ?
      `,
    )
    .bind(githubId)
    .first<LeaderboardRow & { score: number }>();

  if (!row) {
    return null;
  }

  return { ...row, score: Number(row.score) } satisfies LeaderboardRow;
}

/**
 * 单模型榜：同一个人在同一模型上可能留了多条历史记录，先按「本人最好的一次」去重，
 * 再在每个模型内部按收缩分数排名（小样本往全局均值收，见 scoreExpr）。
 *
 * 注意 PARTITION BY 用 model + github_id 而不是只用 github_id：同一次提交里的模型名
 * 是唯一的，但不同次提交的模型名可能因为版本升级而变，按 github_id 单独分区会错杀。
 */
export async function getModelDashboard(rowsPerModel = 20, hottestModelsLimit = 12) {
  const database = getDatabase();

  const topModelsResult = await database
    .prepare(
      `
        ${MODEL_PRIOR_CTE_SQL},
        best_per_user AS (
          SELECT
            m.model AS model,
            m.github_id AS githubId,
            m.drool_count AS droolCount,
            m.assistant_messages AS assistantMessages,
            m.mdi AS mdi,
            ${scoreExpr('m.')} AS score,
            e.login AS login,
            e.display_name AS displayName,
            e.avatar_url AS avatarUrl,
            ROW_NUMBER() OVER (
              PARTITION BY m.model, m.github_id
              ORDER BY ${MODEL_RANK_ORDER_SQL}
            ) AS user_rank
          FROM leaderboard_submission_models AS m
          JOIN leaderboard_entries AS e ON e.github_id = m.github_id
          CROSS JOIN prior
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
            score,
            ROW_NUMBER() OVER (
              PARTITION BY model
              ORDER BY score DESC, droolCount DESC, assistantMessages DESC, login ASC
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
          score,
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
        ${MODEL_PRIOR_CTE_SQL}
        SELECT
          model,
          COALESCE(SUM(drool_count), 0) AS droolCount,
          COALESCE(SUM(assistant_messages), 0) AS assistantMessages,
          CASE WHEN SUM(assistant_messages) > 0
            THEN SUM(drool_count) * 1000.0 / SUM(assistant_messages)
            ELSE 0
          END AS mdi,
          (SUM(drool_count) + ${PRIOR_MASS} * prior.rate)
            / (SUM(assistant_messages) + ${PRIOR_MASS}) * 1000 AS score,
          COUNT(DISTINCT github_id) AS contributors
        FROM leaderboard_submission_models CROSS JOIN prior
        GROUP BY model, prior.rate
        ORDER BY score DESC, droolCount DESC, model ASC
        LIMIT ?
      `,
    )
    .bind(hottestModelsLimit)
    .all<HottestModelRow>();

  const hottestHarnessesResult = await database
    .prepare(
      `
        ${MODEL_PRIOR_CTE_SQL}
        SELECT
          harness,
          COALESCE(SUM(drool_count), 0) AS droolCount,
          COALESCE(SUM(assistant_messages), 0) AS assistantMessages,
          CASE WHEN SUM(assistant_messages) > 0
            THEN SUM(drool_count) * 1000.0 / SUM(assistant_messages)
            ELSE 0
          END AS mdi,
          (SUM(drool_count) + ${PRIOR_MASS} * prior.rate)
            / (SUM(assistant_messages) + ${PRIOR_MASS}) * 1000 AS score,
          COUNT(DISTINCT github_id) AS contributors
        FROM leaderboard_submission_harnesses CROSS JOIN prior
        GROUP BY harness, prior.rate
        ORDER BY score DESC, droolCount DESC, harness ASC
        LIMIT ?
      `,
    )
    .bind(hottestModelsLimit)
    .all<HottestHarnessRow>();

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
      score: Number(row.score),
      contributors: Number(row.contributors),
    })),
    hottestHarnesses: hottestHarnessesResult.results.map((row) => ({
      harness: row.harness,
      droolCount: Number(row.droolCount),
      assistantMessages: Number(row.assistantMessages),
      mdi: Number(row.mdi),
      score: Number(row.score),
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

  if (!submissionId || (submission.modelEntries.length === 0 && submission.harnessEntries.length === 0)) {
    return;
  }

  const harnessStatements = submission.harnessEntries.map((entry) =>
    database
      .prepare(
        `
          INSERT INTO leaderboard_submission_harnesses (
            submission_id,
            github_id,
            harness,
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
        entry.harness,
        entry.droolCount,
        entry.totalMessages,
        entry.mdi,
        updatedAt,
      ),
  );

  await database.batch(harnessStatements);

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
