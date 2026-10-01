import './style.css';
import { handleCallback, isLoggedIn, login, logout } from './auth.ts';
import { pickPair, top, vote, type Song } from './rank.ts';
import {
  addToPlaylist,
  createPlaylist,
  getLikedSongs,
  getPlaylistIndex,
  initPlayer,
  pause,
  play,
  setPlaylistItems,
  type Playlist,
} from './spotify.ts';

type State = { songs: Record<string, Song>; votes: number; playlistId?: string };

const KEY = 'songcompare:v1';
const PLAYLISTS_KEY = 'songcompare:playlists';
const app = document.querySelector<HTMLDivElement>('#app')!;

const state: State = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? { songs: {}, votes: 0 };
let playlists: Record<string, Playlist> = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) ?? '{}');
let pair: [Song, Song] | null = null;
let view: 'vote' | 'top' = 'vote';
let playing: string | null = null;
let canPlay = false;
let notice = '';

const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const savePlaylists = () => localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
const songs = () => Object.values(state.songs);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --- Views ---

const noticeHtml = () => (notice ? `<p class="notice">${esc(notice)}</p>` : '');

function show(body: string) {
  app.innerHTML = `<header><h1>SongCompare</h1></header>${noticeHtml()}<main class="center">${body}</main>`;
}

function render() {
  if (!pair) return;
  const n = songs().length;
  const left = Math.max(0, 3 * n - state.votes);
  const tab = (v: typeof view, label: string) =>
    `<button data-action="view" data-view="${v}" class="${view === v ? 'active' : ''}">${label}</button>`;
  app.innerHTML = `
    <header>
      <h1>SongCompare</h1>
      <nav>${tab('vote', 'Vote')}${tab('top', 'Top 100')}<button data-action="logout">Log out</button></nav>
    </header>
    ${noticeHtml()}
    <p class="stats">${state.votes} votes · ${n} liked songs${left ? ` · about ${left} more votes for a settled top 100` : ''}</p>
    ${view === 'vote' ? voteView(pair) : topView()}`;
}

function voteView(p: [Song, Song]) {
  return `<main class="pair">${p
    .map(
      (s, i) => `
    <article class="card">
      <img src="${esc(s.image)}" alt="">
      <h2>${esc(s.name)}</h2>
      <p class="artist">${esc(s.artist)}</p>
      ${badges(s)}
      <div class="row">
        <button data-action="play" data-id="${s.id}" ${canPlay ? '' : 'disabled'}>${playing === s.id ? 'Pause' : 'Play'}</button>
        <button class="primary" data-action="vote" data-i="${i}">${i ? 'Vote →' : '← Vote'}</button>
      </div>
      ${playlistSelect(s)}
    </article>`,
    )
    .join('')}</main>`;
}

function topView() {
  const list = top(songs());
  if (!list.length) return '<main class="center"><p>Vote a few times first.</p></main>';
  return `<ol class="top">${list
    .map(
      (s) => `
    <li>
      <img src="${esc(s.image)}" alt="">
      <div class="info"><strong>${esc(s.name)}</strong><span class="artist">${esc(s.artist)}</span>${badges(s)}</div>
      <span class="rating" title="Rating · comparisons">${Math.round(s.rating)} · ${s.games}</span>
      ${playlistSelect(s)}
    </li>`,
    )
    .join('')}</ol>`;
}

function badges(s: Song) {
  const names = Object.values(playlists).filter((p) => p.trackIds.includes(s.id));
  return names.length ? `<p class="badges">In: ${names.map((p) => `<span>${esc(p.name)}</span>`).join('')}</p>` : '';
}

function playlistSelect(s: Song) {
  const options = Object.values(playlists)
    .map((p) => `<option value="${p.id}" ${p.trackIds.includes(s.id) ? 'disabled' : ''}>${esc(p.name)}</option>`)
    .join('');
  return `<select data-action="add" data-id="${s.id}">
    <option value="">+ Add to playlist…</option>${options}<option value="new">New playlist…</option>
  </select>`;
}

// --- Actions ---

let syncTimer: ReturnType<typeof setTimeout> | undefined;

function choose(i: number) {
  if (!pair) return;
  const [winner, loser] = i ? [pair[1], pair[0]] : pair;
  vote(winner, loser);
  state.votes++;
  save();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncTop, 2000); // debounce: fast voting = one playlist update
  if (playing) {
    pause().catch(() => {});
    playing = null;
  }
  pair = pickPair(songs());
  render();
}

async function syncTop() {
  try {
    if (!state.playlistId) {
      state.playlistId = (await createPlaylist('SongCompare Top 100', 'Your Liked Songs, ranked by SongCompare votes.')).id;
      save();
    }
    await setPlaylistItems(state.playlistId, top(songs()).map((s) => s.uri));
  } catch (e) {
    notice = message(e);
    render();
  }
}

async function togglePlay(id: string) {
  try {
    if (playing === id) {
      await pause();
      playing = null;
    } else {
      await play(state.songs[id]);
      playing = id;
    }
  } catch (e) {
    notice = message(e);
  }
  render();
}

async function addTo(songId: string, value: string) {
  if (!value) return;
  try {
    let p = playlists[value];
    if (value === 'new') {
      const name = prompt('Name of the new playlist')?.trim();
      if (!name) return render();
      const created = await createPlaylist(name);
      p = playlists[created.id] = { id: created.id, name: created.name, snapshot: created.snapshot_id, trackIds: [] };
    }
    const { snapshot_id } = await addToPlaylist(p.id, state.songs[songId].uri);
    p.trackIds.push(songId);
    p.snapshot = snapshot_id; // our trackIds match this snapshot, so the cache stays valid
    savePlaylists();
    notice = `Added “${state.songs[songId].name}” to ${p.name}.`;
  } catch (e) {
    notice = message(e);
  }
  render();
}

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button[data-action]');
  if (!el) return;
  const { action } = el.dataset;
  if (action === 'login') login().catch((err) => show(`<p class="notice">${esc(message(err))}</p>`));
  else if (action === 'logout') {
    logout();
    location.reload();
  } else if (action === 'view') {
    view = el.dataset.view as typeof view;
    render();
  } else if (action === 'vote') choose(Number(el.dataset.i));
  else if (action === 'play') void togglePlay(el.dataset.id!);
});

app.addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.dataset.action === 'add') void addTo(el.dataset.id!, el.value);
});

document.addEventListener('keydown', (e) => {
  if (view !== 'vote' || e.target instanceof HTMLSelectElement) return;
  if (e.key === 'ArrowLeft') choose(0);
  else if (e.key === 'ArrowRight') choose(1);
});

// --- Start ---

async function start() {
  try {
    await handleCallback();
  } catch (e) {
    notice = message(e);
  }
  if (!isLoggedIn()) {
    return show(`
      <p>Rank your Spotify Liked Songs by picking the better of two songs, again and again.</p>
      <button class="primary" data-action="login">Log in with Spotify</button>`);
  }

  show('<p>Loading your Liked Songs…</p>');
  try {
    const liked = await getLikedSongs();
    // Keep existing ratings; songs you un-liked drop out of the pool.
    state.songs = Object.fromEntries(
      liked.map((t) => [t.id, { ...t, rating: state.songs[t.id]?.rating ?? 1500, games: state.songs[t.id]?.games ?? 0 }]),
    );
    save();
  } catch (e) {
    notice = message(e);
    return show('<button class="primary" data-action="logout">Log in again</button>');
  }
  if (songs().length < 2) return show('<p>You need at least two Liked Songs on Spotify.</p>');

  pair = pickPair(songs());
  render();

  initPlayer().then(
    () => {
      canPlay = true;
      render();
    },
    (e) => {
      notice = message(e);
      render();
    },
  );
  getPlaylistIndex(playlists, state.playlistId).then(
    (index) => {
      playlists = index;
      savePlaylists();
      render();
    },
    (e) => {
      notice = `Could not load your playlists: ${message(e)}`;
      render();
    },
  );
}

void start();
