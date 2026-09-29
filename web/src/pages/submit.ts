import type { APIRoute } from 'astro';
import {
  encodePendingSubmission,
  getPendingSubmissionCookieName,
  getPendingSubmissionMaxAge,
  getSessionCookieName,
  isSecureRequest,
  readViewerFromCookie,
} from '../lib/auth';
import {
  createPendingSubmission,
  getLeaderboardProfileByGithubId,
  hasDatabaseBinding,
  upsertLeaderboardEntry,
} from '../lib/db';
import { parseSubmittedPayload } from '../lib/report';

export const prerender = false;

/**
 * 榜单提交入口，对应报告页「上传到榜单」按钮。
 *
 * 契约由 CLI 侧固定，不要改：普通 HTML 表单 POST，
 * application/x-www-form-urlencoded，只有一个字段 `payload`，
 * 值是 CLI 的 LeaderboardReportPayload 的 JSON 字符串。
 * 字段名、编码方式、目标路径三者任何一个变了，按钮就静默失效。
 *
 * 这是跨站 POST，所以不能依赖同站 cookie：
 *   - 未登录：载荷落 D1 换一次性 token，token 进跳转 URL 和 httpOnly cookie，
 *     用户走完 GitHub 登录后由回调消费并落榜；
 *   - 已登录：直接 upsert。
 */
export const POST: APIRoute = async ({ cookies, redirect, request, url }) => {
  if (!hasDatabaseBinding()) {
    return redirect('/?state=not-configured');
  }

  const formData = await request.formData();
  const payload = parseSubmittedPayload(formData.get('payload'));

  // 字段名不对、JSON 坏了、数值非法，都在这里被挡下，页面只拿到一个 state。
  if (!payload) {
    return redirect('/?state=invalid-payload');
  }

  const viewer = await readViewerFromCookie(cookies.get(getSessionCookieName())?.value);

  if (viewer) {
    await upsertLeaderboardEntry(viewer, payload);
    const profile = await getLeaderboardProfileByGithubId(viewer.githubId);

    return redirect(
      `/u/${encodeURIComponent(viewer.login)}?state=submitted&rank=${profile?.rank ?? 0}`,
    );
  }

  const returnTo = '/';
  const token = await createPendingSubmission(payload, getPendingSubmissionMaxAge() * 1000);
  const loginUrl = new URL('/api/auth/github/login', url.origin);
  loginUrl.searchParams.set('pending', token);
  loginUrl.searchParams.set('returnTo', returnTo);

  // cookie 只是 token 的兜底副本：提交是跨站的，这个 cookie 可能根本到不了。
  cookies.set(
    getPendingSubmissionCookieName(),
    encodePendingSubmission({ payload, returnTo }),
    {
      httpOnly: true,
      maxAge: getPendingSubmissionMaxAge(),
      path: '/',
      sameSite: isSecureRequest(url) ? 'none' : 'lax',
      secure: isSecureRequest(url),
    },
  );

  return redirect(`${loginUrl.pathname}${loginUrl.search}`);
};

/** 浏览器直接打开 /submit 没有载荷可提交，回首页而不是抛 405。 */
export const GET: APIRoute = ({ redirect }) => {
  return redirect('/?state=submit-requires-form');
};
