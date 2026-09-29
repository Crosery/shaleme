import type { APIRoute } from 'astro';
import {
  createSessionToken,
  decodePendingSubmission,
  exchangeCodeForToken,
  fetchGitHubUser,
  getOAuthStateCookieName,
  getPendingSubmissionCookieName,
  getSessionCookieName,
  getSessionMaxAge,
  isSecureRequest,
  type PendingSubmission,
} from '../../../../lib/auth';
import {
  consumePendingSubmission,
  deletePendingSubmission,
  getLeaderboardProfileByGithubId,
  hasDatabaseBinding,
  upsertLeaderboardEntry,
} from '../../../../lib/db';
import { parseStoredPayload } from '../../../../lib/report';

export const prerender = false;

/** 只接受站内路径，避免 returnTo 变成开放重定向。 */
function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '';
  }

  return value;
}

export const GET: APIRoute = async ({ cookies, redirect, url }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = cookies.get(getOAuthStateCookieName())?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirect('/?state=oauth-denied');
  }

  try {
    const token = await exchangeCodeForToken(url, code);
    const viewer = await fetchGitHubUser(token);
    const sessionToken = await createSessionToken(viewer);

    cookies.set(getSessionCookieName(), sessionToken, {
      httpOnly: true,
      maxAge: getSessionMaxAge(),
      path: '/',
      sameSite: isSecureRequest(url) ? 'none' : 'lax',
      secure: isSecureRequest(url),
    });
    cookies.delete(getOAuthStateCookieName(), { path: '/' });

    const pendingToken = url.searchParams.get('pending');
    const cookieValue = cookies.get(getPendingSubmissionCookieName())?.value;

    let pending: PendingSubmission | null = null;

    if (pendingToken && hasDatabaseBinding()) {
      const payload = await consumePendingSubmission(pendingToken);
      pending = payload ? { payload, returnTo: safeReturnTo(url.searchParams.get('returnTo')) } : null;
    }

    // 落库失败或换了浏览器时，退回 cookie 里那份副本。
    if (!pending && cookieValue) {
      try {
        const decoded = decodePendingSubmission(cookieValue);
        const payload = parseStoredPayload(JSON.stringify(decoded.payload));

        pending = { payload, returnTo: safeReturnTo(decoded.returnTo ?? null) };
      } catch {
        pending = null;
      }
    }

    if (pendingToken) {
      cookies.delete(getPendingSubmissionCookieName(), { path: '/' });

      if (hasDatabaseBinding()) {
        await deletePendingSubmission(pendingToken);
      }
    }

    if (pending && hasDatabaseBinding()) {
      await upsertLeaderboardEntry(viewer, pending.payload);
      const profile = await getLeaderboardProfileByGithubId(viewer.githubId);
      const target = pending.returnTo || '/u/' + encodeURIComponent(viewer.login);

      return redirect(`${target}?state=submitted&rank=${profile?.rank ?? 0}`);
    }

    return redirect('/?state=signed-in');
  } catch {
    return redirect('/?state=oauth-failed');
  }
};
