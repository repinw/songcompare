// Spotify Authorization Code + PKCE: no client secret, so it works from a static site.
const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
const redirectUri = new URL(import.meta.env.BASE_URL, location.origin).href;
const scope = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-library-read',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');

const KEY = 'songcompare:token';
const VERIFIER_KEY = 'songcompare:verifier';

type Token = { access: string; refresh: string; expires: number };

const load = (): Token | null => JSON.parse(localStorage.getItem(KEY) ?? 'null');
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const isLoggedIn = () => load() !== null;
export const logout = () => localStorage.removeItem(KEY);

export async function login(): Promise<void> {
  if (!clientId) throw new Error('VITE_SPOTIFY_CLIENT_ID is missing. Copy .env.example to .env and set it.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  localStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  location.assign(
    'https://accounts.spotify.com/authorize?' +
      new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope,
        code_challenge_method: 'S256',
        code_challenge: challenge,
      }),
  );
}

// Finishes the login when Spotify redirects back with ?code=… (or ?error=…).
export async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return;
  history.replaceState(null, '', redirectUri);
  if (error) throw new Error(`Spotify login failed: ${error}`);
  await requestToken({
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: redirectUri,
    code_verifier: localStorage.getItem(VERIFIER_KEY) ?? '',
  });
  localStorage.removeItem(VERIFIER_KEY);
}

async function requestToken(params: Record<string, string>): Promise<void> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId ?? '', ...params }),
  });
  if (!res.ok) {
    logout();
    throw new Error(`Spotify login failed: ${res.status} ${await res.text()}`);
  }
  const t = await res.json();
  const token: Token = {
    access: t.access_token,
    refresh: t.refresh_token ?? load()?.refresh,
    expires: Date.now() + t.expires_in * 1000,
  };
  localStorage.setItem(KEY, JSON.stringify(token));
}

let refreshing: Promise<void> | null = null;

export async function getToken(): Promise<string> {
  const t = load();
  if (!t) throw new Error('Not logged in');
  if (Date.now() < t.expires - 60_000) return t.access;
  // Share one refresh between parallel callers; Spotify may rotate the refresh token.
  refreshing ??= requestToken({ grant_type: 'refresh_token', refresh_token: t.refresh }).finally(() => {
    refreshing = null;
  });
  await refreshing;
  return load()!.access;
}
