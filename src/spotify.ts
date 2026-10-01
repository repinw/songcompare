import { getToken, logout } from './auth.ts';
import type { Song } from './rank.ts';

const API = 'https://api.spotify.com/v1';

type Page<T> = { items: T[]; next: string | null };
type ApiTrack = {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { images: { url: string }[] };
};
type ApiPlaylist = { id: string; name: string; snapshot_id: string; collaborative: boolean; owner: { id: string } };

export type Track = Omit<Song, 'rating' | 'games'>;
export type Playlist = { id: string; name: string; snapshot: string; trackIds: string[] };

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('https://') ? path : API + path;
  for (;;) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('Retry-After') ?? 2) * 1000));
      continue;
    }
    if (res.status === 401) logout();
    if (!res.ok) throw new Error(`Spotify ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : (undefined as T);
  }
}

async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let next: string | null = path; next; ) {
    const page: Page<T> = await api(next);
    out.push(...page.items);
    next = page.next;
  }
  return out;
}

export async function getLikedSongs(): Promise<Track[]> {
  const items = await all<{ track: ApiTrack | null }>('/me/tracks?limit=50');
  return items.flatMap(({ track: t }) =>
    t?.id
      ? [{
          id: t.id,
          uri: t.uri,
          name: t.name,
          artist: t.artists.map((a) => a.name).join(', '),
          image: t.album.images[1]?.url ?? t.album.images[0]?.url ?? '',
          durationMs: t.duration_ms,
        }]
      : [],
  );
}

// --- Playback (Web Playback SDK, Premium only) ---

type Player = {
  connect(): Promise<boolean>;
  pause(): Promise<void>;
  activateElement(): Promise<void>;
  addListener(event: string, cb: (data: { device_id: string; message: string }) => void): void;
};

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void;
    Spotify: {
      Player: new (opts: { name: string; volume?: number; getOAuthToken(cb: (token: string) => void): void }) => Player;
    };
  }
}

let player: Player | null = null;
let deviceId = '';

export function initPlayer(): Promise<void> {
  return new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => {
      player = new window.Spotify.Player({
        name: 'SongCompare',
        volume: 0.8,
        getOAuthToken: (cb) => void getToken().then(cb),
      });
      player.addListener('ready', ({ device_id }) => {
        deviceId = device_id;
        resolve();
      });
      player.addListener('account_error', () => reject(new Error('Spotify Premium is required to play songs here. You can still vote.')));
      player.addListener('initialization_error', ({ message }) => reject(new Error(`Player error: ${message}`)));
      player.addListener('authentication_error', ({ message }) => reject(new Error(`Player error: ${message}`)));
      void player.connect();
    };
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => reject(new Error('Could not load the Spotify player (blocked by an ad blocker?). You can still vote.'));
    document.head.append(script);
  });
}

// Starts ~30% into the track so you hear the core of the song, not the intro.
export async function play(song: Song): Promise<void> {
  void player?.activateElement(); // must run inside the click for browsers that block autoplay
  await api(`/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [song.uri], position_ms: Math.floor(song.durationMs * 0.3) }),
  });
}

export const pause = async (): Promise<void> => player?.pause();

// --- Playlists ---

export const createPlaylist = (name: string, description = '') =>
  api<{ id: string; name: string; snapshot_id: string }>('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, description, public: false }),
  });

export const setPlaylistItems = (playlistId: string, uris: string[]) =>
  api(`/playlists/${playlistId}/items`, { method: 'PUT', body: JSON.stringify({ uris }) });

export const addToPlaylist = (playlistId: string, uri: string) =>
  api<{ snapshot_id: string }>(`/playlists/${playlistId}/items`, { method: 'POST', body: JSON.stringify({ uris: [uri] }) });

// Which song is in which of the user's own (or collaborative) playlists.
// Unchanged playlists (same snapshot_id) are taken from `cache`.
// ponytail: one request per changed playlist (+1 per 50 songs); fine for dozens of playlists, go lazy per song if users have hundreds.
export async function getPlaylistIndex(cache: Record<string, Playlist>, skipId?: string): Promise<Record<string, Playlist>> {
  const me = await api<{ id: string }>('/me');
  const index: Record<string, Playlist> = {};
  for (const p of await all<ApiPlaylist | null>('/me/playlists?limit=50')) {
    if (!p || p.id === skipId || (p.owner.id !== me.id && !p.collaborative)) continue;
    const old = cache[p.id];
    try {
      const trackIds =
        old?.snapshot === p.snapshot_id
          ? old.trackIds
          : (await all<{ item?: { id: string | null } | null }>(`/playlists/${p.id}/items?limit=50`)).flatMap((i) => i.item?.id ?? []);
      index[p.id] = { id: p.id, name: p.name, snapshot: p.snapshot_id, trackIds };
    } catch {
      // Skip playlists we can't read (e.g. 403 on someone else's collaborative list).
    }
  }
  return index;
}
