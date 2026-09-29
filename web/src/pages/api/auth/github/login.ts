import type { APIRoute } from 'astro';
import {
  getGitHubAuthorizeUrl,
  getOAuthStateCookieName,
  getOAuthStateMaxAge,
  getSessionCookieName,
  hasGitHubAuthConfig,
  isSecureRequest,
} from '../../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = ({ cookies, redirect, url }) => {
  if (!hasGitHubAuthConfig()) {
    return redirect('/?state=auth-misconfigured');
  }

  // state 存 httpOnly cookie，回调里比对，挡住把用户骗去授权的 CSRF。
  const state = crypto.randomUUID();

  cookies.set(getOAuthStateCookieName(), state, {
    httpOnly: true,
    maxAge: getOAuthStateMaxAge(),
    path: '/',
    sameSite: 'lax',
    secure: isSecureRequest(url),
  });

  // 重新登录时先清掉旧会话，避免回调里两个身份打架。
  cookies.delete(getSessionCookieName(), { path: '/' });

  return redirect(getGitHubAuthorizeUrl(url, state));
};
