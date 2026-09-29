/**
 * GitHub OAuth 与无状态会话。
 *
 * 会话本身不进数据库：cookie 值是「base64url(payload).HMAC-SHA256(payload)」，
 * 服务端只验签，因此 Worker 不需要任何会话表，也没有跨实例一致性问题。
 *
 * 提交入口是跨站表单 POST，浏览器不保证带上 SameSite=Lax 的 cookie，所以未登录的
 * 提交先落 D1 换一个一次性 token（见 db.ts 的 createPendingSubmission），
 * 走完 OAuth 后由回调消费。
 */

import { env } from 'cloudflare:workers';
import type { LeaderboardReportPayload, Viewer } from './types';

const SESSION_COOKIE = 'shaleme_session';
const OAUTH_STATE_COOKIE = 'shaleme_oauth_state';
const PENDING_SUBMISSION_COOKIE = 'shaleme_pending_submission';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const OAUTH_STATE_MAX_AGE = 60 * 10;
const PENDING_SUBMISSION_MAX_AGE = 60 * 10;
const USER_AGENT = 'shaleme-leaderboard';

type GitHubUser = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
};

export type PendingSubmission = {
  payload: LeaderboardReportPayload;
  returnTo: string;
};

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function getSessionMaxAge() {
  return SESSION_MAX_AGE;
}

export function getOAuthStateCookieName() {
  return OAUTH_STATE_COOKIE;
}

export function getOAuthStateMaxAge() {
  return OAUTH_STATE_MAX_AGE;
}

export function getPendingSubmissionCookieName() {
  return PENDING_SUBMISSION_COOKIE;
}

export function getPendingSubmissionMaxAge() {
  return PENDING_SUBMISSION_MAX_AGE;
}

function encodeBase64Url(input: string) {
  return btoa(input).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64Url(input: string) {
  const padded = input
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(input.length / 4) * 4, '=');
  return atob(padded);
}

function encodeUtf8Base64Url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let binary = '';

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return encodeBase64Url(binary);
}

function decodeUtf8Base64Url(input: string) {
  const binary = decodeBase64Url(input);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 待提交内容的 cookie 副本：token 落库失败时仍能把载荷带回回调。 */
export function encodePendingSubmission(submission: PendingSubmission) {
  return encodeUtf8Base64Url(JSON.stringify(submission));
}

export function decodePendingSubmission(value: string) {
  return JSON.parse(decodeUtf8Base64Url(value)) as PendingSubmission;
}

async function importSessionKey() {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET ?? ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signPayload(encodedPayload: string) {
  const key = await importSessionKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload));
  const bytes = new Uint8Array(signature);
  let binary = '';

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return encodeBase64Url(binary);
}

export function getAppUrl(requestUrl: URL) {
  return env.APP_URL || requestUrl.origin;
}

export function isSecureRequest(requestUrl: URL) {
  return requestUrl.protocol === 'https:';
}

export function redirectUri(requestUrl: URL) {
  return new URL('/api/auth/github/callback', getAppUrl(requestUrl)).toString();
}

export function getGitHubAuthorizeUrl(requestUrl: URL, state: string) {
  const search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID ?? '',
    redirect_uri: redirectUri(requestUrl),
    scope: 'read:user',
    state,
  });

  return `https://github.com/login/oauth/authorize?${search.toString()}`;
}

export async function exchangeCodeForToken(requestUrl: URL, code: string) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri(requestUrl),
    }),
  });

  if (!response.ok) {
    throw new Error('GitHub token exchange failed.');
  }

  const payload = (await response.json()) as { access_token?: string; error?: string };

  if (!payload.access_token) {
    throw new Error(payload.error || 'GitHub did not return an access token.');
  }

  return payload.access_token;
}

export async function fetchGitHubUser(token: string) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error('GitHub user lookup failed.');
  }

  const user = (await response.json()) as GitHubUser;

  return {
    githubId: user.id,
    login: user.login,
    displayName: user.name || user.login,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
  } satisfies Viewer;
}

export async function createSessionToken(viewer: Viewer) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = encodeUtf8Base64Url(
    JSON.stringify({
      sub: String(viewer.githubId),
      login: viewer.login,
      displayName: viewer.displayName,
      avatarUrl: viewer.avatarUrl,
      profileUrl: viewer.profileUrl,
      iat: issuedAt,
      exp: issuedAt + SESSION_MAX_AGE,
    }),
  );
  const signature = await signPayload(payload);

  return `${payload}.${signature}`;
}

export async function readViewerFromToken(token: string | undefined) {
  if (!token) {
    return null;
  }

  const [payloadPart = '', signaturePart = ''] = token.split('.');
  const expectedSignature = await signPayload(payloadPart);

  if (signaturePart !== expectedSignature) {
    throw new Error('Invalid session signature.');
  }

  const payload = JSON.parse(decodeUtf8Base64Url(payloadPart)) as {
    sub: string;
    login: string;
    displayName: string;
    avatarUrl: string;
    profileUrl: string;
    exp: number;
  };

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Session expired.');
  }

  return {
    githubId: Number(payload.sub),
    login: String(payload.login),
    displayName: String(payload.displayName),
    avatarUrl: String(payload.avatarUrl),
    profileUrl: String(payload.profileUrl),
  } satisfies Viewer;
}

/** 页面里用这个：签名不对、过期、被篡改都只是「未登录」，不该把页面打挂。 */
export async function readViewerFromCookie(token: string | undefined) {
  try {
    return await readViewerFromToken(token);
  } catch {
    return null;
  }
}

export function hasGitHubAuthConfig() {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET);
}
