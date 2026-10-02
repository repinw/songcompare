import './style.css';
import { handleCallback, isLoggedIn, login, logout } from './auth.ts';
import { mergeSongs, pickPair, top, vote, type Song } from './rank.ts';
import {
  addToPlaylist,
  createPlaylist,
  findOrCreateTop100,
  getLikedSongs,
  getPlaylistIndex,
  getPosition,
  initPlayer,
  pause,
  play,
  seek,
  setPlaylistItems,
  togglePlay,
  type Playlist,
} from './spotify.ts';

type State = { songs: Record<string, Song>; votes: number; playlistId?: string };
type Step = { pair: [Song, Song]; before: [Song, Song]; votes: number };
type Choice = 'a' | 'b' | 'tie' | 'skip';

const KEY = 'songcompare:v1';
const PLAYLISTS_KEY = 'songcompare:playlists';
const SNIPPET_MS = 15_000;
const app = document.querySelector<HTMLDivElement>('#app')!;

const state: State = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? { songs: {}, votes: 0 };
for (const s of Object.values(state.songs)) s.wins ??= s.games / 2; // data saved before ties existed
let playlists: Record<string, Playlist> = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) ?? '{}');
let liked = new Set<string>();
let steps: Step[] = [];
let pair: [Song, Song] | null = null;
let view: 'vote' | 'top' = 'vote';
let notice = '';

// Playback: `seq` increments to cancel a running snippet sequence.
let canPlay = false;
let started = false; // browsers only allow audio after a first click
let playing: string | null = null;
let paused = false;
let seq = 0;
let seeking = false; // the user is dragging a slider; don't move it under their finger

const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const savePlaylists = () => localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
const songs = () => Object.values(state.songs).filter((s) => liked.has(s.id)); // un-liked songs keep their rating but sit out
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

// --- Views ---

const noticeHtml = () => (notice ? `<p class="notice">${esc(notice)}</p>` : '');

function show(body: string) {
  app.innerHTML = `<header><h1>SongCompare</h1></header>${noticeHtml()}<main class="center">${body}</main>`;
}

function render() {
  if (!pair) return;
  const all = songs();
  const out = all.filter((s) => s.eliminated).length;
  const tab = (v: typeof view, label: string) =>
    `<button data-action="view" data-view="${v}" class="${view === v ? 'active' : ''}">${label}</button>`;
  app.innerHTML = `
    <header>
      <h1>SongCompare</h1>
      <nav>${tab('vote', 'Abstimmen')}${tab('top', 'Top 100')}</nav>
    </header>
    ${noticeHtml()}
    <p class="stats">${state.votes} Stimmen · ${all.length - out} im Rennen · ${out} ausgeschieden</p>
    ${view === 'vote' ? voteView(pair) : topView()}
    <footer>
      <button data-action="export">Sicherung exportieren</button>
      <button data-action="import">Sicherung importieren</button>
      <button data-action="logout">Abmelden</button>
      <input type="file" accept="application/json,.json" hidden>
    </footer>`;
  updatePlayUi();
}

function voteView([a, b]: [Song, Song]) {
  const card = (s: Song, i: number) => `
    <article class="card" data-action="vote" data-i="${i}" data-id="${esc(s.id)}" title="Klicken zum Abstimmen">
      <img src="${esc(s.image)}" alt="">
      <h2>${esc(s.name)}</h2>
      <p class="artist">${esc(s.artist)}</p>
      ${s.eliminated ? '<p class="comeback">Comeback-Duell</p>' : ''}
      ${badges(s)}
      <div class="seek" data-action="seek">
        <input type="range" min="0" max="${s.durationMs}" step="1000" value="0" aria-label="Spulen" data-id="${esc(s.id)}" ${canPlay ? '' : 'disabled'}>
        <span class="time">0:00 / ${fmt(s.durationMs)}</span>
      </div>
      <button data-action="full" data-id="${esc(s.id)}" ${canPlay ? '' : 'disabled'}>Ganz hören</button>
      ${playlistSelect(s)}
    </article>`;
  return `
    <main class="pair">${card(a, 0)}${card(b, 1)}</main>
    <div class="actions">
      <button data-action="tie">Unentschieden</button>
      <button data-action="skip">Überspringen</button>
      <button data-action="undo" ${steps.length ? '' : 'disabled'}>Rückgängig</button>
    </div>
    <div class="actions">
      ${
        canPlay && !started
          ? '<button class="primary" data-action="start">▶ Ausschnitte abspielen</button>'
          : `<button data-action="pause" ${canPlay ? '' : 'disabled'}>Pause</button>
             <button data-action="snippets" ${canPlay ? '' : 'disabled'}>Ausschnitte nochmal</button>`
      }
    </div>
    <p class="keys">← A · → B · ↓ Unentschieden · ↑ Überspringen · ⌫ Rückgängig · Leertaste Pause</p>`;
}

function topView() {
  const list = top(songs());
  if (!list.length) return '<main class="center"><p>Stimm erst ein paar Mal ab.</p></main>';
  return `<ol class="top">${list
    .map(
      (s) => `
    <li>
      <img src="${esc(s.image)}" alt="">
      <div class="info"><strong>${esc(s.name)}</strong><span class="artist">${esc(s.artist)}</span>${badges(s)}</div>
      <span class="rating" title="Wertung · Duelle">${Math.round(s.rating)} · ${s.games}</span>
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
    .map((p) => `<option value="${esc(p.id)}" ${p.trackIds.includes(s.id) ? 'disabled' : ''}>${esc(p.name)}</option>`)
    .join('');
  return `<select data-action="add" data-id="${esc(s.id)}">
    <option value="">+ Playlist…</option>${options}<option value="new">Neue Playlist…</option>
  </select>`;
}

// Changes only the "playing" marks, so an open playlist menu doesn't close every 15 s.
function updatePlayUi() {
  app.querySelectorAll<HTMLElement>('.card').forEach((c) => c.classList.toggle('playing', c.dataset.id === playing));
  const btn = app.querySelector<HTMLButtonElement>('[data-action=pause]');
  if (btn) {
    btn.textContent = paused ? 'Weiter' : 'Pause';
    btn.disabled = !playing;
  }
}

function showPosition(range: HTMLInputElement, ms: number) {
  range.value = String(ms);
  range.nextElementSibling!.textContent = `${fmt(ms)} / ${fmt(Number(range.max))}`;
}

// --- Playback ---

async function startSong(s: Song, positionMs: number) {
  playing = s.id;
  paused = false;
  updatePlayUi();
  try {
    await play(s, positionMs);
  } catch (e) {
    seq++;
    playing = null;
    notice = `„${s.name}“ (${s.uri}): ${message(e)}`;
    render();
  }
}

// A for 15 s, then B for 15 s, both from ~30% in so you hear the core of the song, not the intro.
async function playSnippets() {
  const run = ++seq;
  for (const s of pair ?? []) {
    if (run !== seq) return;
    await startSong(s, s.durationMs * 0.3);
    await wait(SNIPPET_MS);
  }
  if (run === seq) stopPlayback();
}

function startSnippets() {
  started = true;
  render();
  void playSnippets();
}

function stopPlayback() {
  seq++;
  if (playing && !paused) pause().catch(() => {});
  playing = null;
  paused = false;
  updatePlayUi();
}

// Seeking means you're listening: the automatic switch to the other song stops.
// On the card that isn't playing, the slider starts that song at the chosen spot.
async function seekTo(range: HTMLInputElement) {
  seeking = false;
  range.blur(); // give ← / → back to voting
  seq++;
  const id = range.dataset.id!;
  if (playing === id) await seek(Number(range.value)).catch((e) => (notice = message(e)));
  else await startSong(state.songs[id], Number(range.value));
}

function togglePause() {
  if (!playing) return canPlay ? startSnippets() : undefined;
  seq++; // pausing ends the snippet sequence; resuming just continues the current song
  paused = !paused;
  togglePlay().catch(() => {});
  updatePlayUi();
}

// --- Voting ---

let syncTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncTop, 2000); // debounce: fast voting = one playlist update
}

async function syncTop() {
  try {
    if (!state.playlistId) {
      state.playlistId = await findOrCreateTop100();
      save();
    }
    await setPlaylistItems(state.playlistId, top(songs()).map((s) => s.uri));
  } catch (e) {
    notice = message(e);
    render();
  }
}

function showPair(p: [Song, Song]) {
  pair = p;
  render();
  if (started && canPlay) void playSnippets();
  else stopPlayback();
}

function choose(choice: Choice) {
  if (!pair) return;
  const [a, b] = pair;
  steps.push({ pair, before: [{ ...a }, { ...b }], votes: state.votes });
  if (choice !== 'skip') {
    if (choice === 'a') vote(a, b, 1);
    else if (choice === 'b') vote(b, a, 1);
    else vote(a, b, 0.5);
    state.votes++;
    save();
    scheduleSync();
  }
  showPair(pickPair(songs(), state.votes));
}

function undo() {
  const step = steps.pop();
  if (!step) return;
  // `eliminated: false` first: the old copy may lack the key, and Object.assign would keep the new value.
  for (const before of step.before) Object.assign(state.songs[before.id], { eliminated: false }, before);
  if (state.votes !== step.votes) scheduleSync();
  state.votes = step.votes;
  save();
  showPair(step.pair);
}

// --- Playlists, backup ---

async function addTo(songId: string, value: string) {
  if (!value) return;
  try {
    let p = playlists[value];
    if (value === 'new') {
      const name = prompt('Name der neuen Playlist')?.trim();
      if (!name) return render();
      const created = await createPlaylist(name);
      p = playlists[created.id] = { id: created.id, name: created.name, snapshot: created.snapshot_id, trackIds: [] };
    }
    const { snapshot_id } = await addToPlaylist(p.id, state.songs[songId].uri);
    p.trackIds.push(songId);
    p.snapshot = snapshot_id; // our trackIds match this snapshot, so the cache stays valid
    savePlaylists();
    notice = `„${state.songs[songId].name}“ zu ${p.name} hinzugefügt.`;
  } catch (e) {
    notice = message(e);
  }
  render();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ songs: state.songs, votes: state.votes })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `songcompare-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The file comes from outside: check every song before it touches state or the page.
const isSong = (s: Song, id: string) =>
  s?.id === id &&
  /^[A-Za-z0-9]+$/.test(id) &&
  typeof s.uri === 'string' &&
  typeof s.name === 'string' &&
  typeof s.artist === 'string' &&
  typeof s.image === 'string' &&
  Number.isFinite(s.rating) &&
  Number.isInteger(s.games);

async function importBackup(file: File) {
  try {
    const data = JSON.parse(await file.text());
    const entries = Object.entries<Song>(data?.songs ?? {});
    if (!entries.length || !entries.every(([id, s]) => isSong(s, id))) throw new Error('Das ist keine gültige SongCompare-Sicherung.');
    for (const [, s] of entries) s.wins = Number.isFinite(s.wins) ? s.wins : s.games / 2;
    state.songs = mergeSongs(state.songs, Object.fromEntries(entries));
    state.votes = Math.round(Object.values(state.songs).reduce((n, s) => n + s.games, 0) / 2);
    steps = []; // undo steps point at the replaced song objects
    save();
    scheduleSync();
    notice = `Sicherung mit ${entries.length} Songs zusammengeführt.`;
    showPair(pickPair(songs(), state.votes));
  } catch (e) {
    notice = message(e);
    render();
  }
}

// --- Events ---

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  if (action === 'login') login().catch((err) => show(`<p class="notice">${esc(message(err))}</p>`));
  else if (action === 'logout') {
    logout();
    location.reload();
  } else if (action === 'reload') location.reload();
  else if (action === 'view') {
    view = el.dataset.view as typeof view;
    render();
  } else if (action === 'vote') choose(el.dataset.i === '1' ? 'b' : 'a');
  else if (action === 'tie' || action === 'skip') choose(action);
  else if (action === 'undo') undo();
  else if (action === 'start' || action === 'snippets') startSnippets();
  else if (action === 'pause') togglePause();
  else if (action === 'full') {
    seq++;
    if (!started) {
      started = true; // from now on every new pair plays its snippets
      render();
    }
    void startSong(state.songs[id!], 0);
  } else if (action === 'export') exportBackup();
  else if (action === 'import') app.querySelector<HTMLInputElement>('input[type=file]')!.click();
});

app.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.type !== 'range') return;
  seeking = true;
  showPosition(el, Number(el.value));
});

app.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el.dataset.action === 'add') void addTo(el.dataset.id!, el.value);
  else if (el.type === 'range') void seekTo(el as HTMLInputElement);
  else if (el instanceof HTMLInputElement && el.files?.[0]) void importBackup(el.files[0]);
});

const keys: Record<string, () => void> = {
  ArrowLeft: () => choose('a'),
  ArrowRight: () => choose('b'),
  ArrowDown: () => choose('tie'),
  ArrowUp: () => choose('skip'),
  Backspace: undo,
  ' ': togglePause,
};

document.addEventListener('keydown', (e) => {
  const action = keys[e.key];
  if (!action || !pair || view !== 'vote' || e.repeat || (e.target as HTMLElement).closest('select, input')) return;
  e.preventDefault();
  action();
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
      <p>Ranke deine Spotify Liked Songs: Hör dir zwei an, wähl den besseren, immer wieder.</p>
      <button class="primary" data-action="login">Mit Spotify anmelden</button>`);
  }

  show('<p>Lade deine Liked Songs…</p>');
  try {
    const tracks = await getLikedSongs();
    for (const { playable, ...t } of tracks) state.songs[t.id] = { ...(state.songs[t.id] ?? { rating: 1500, games: 0, wins: 0 }), ...t };
    liked = new Set(tracks.filter((t) => t.playable).map((t) => t.id)); // unplayable songs keep their rating but sit out
    const blocked = tracks.length - liked.size;
    if (blocked) notice = `${blocked} deiner Liked Songs sind auf Spotify in deinem Land nicht abspielbar und werden ausgelassen.`;
    save();
  } catch (e) {
    notice = message(e);
    return show(`
      <button class="primary" data-action="reload">Neu laden</button>
      <button data-action="logout">Neu anmelden</button>`);
  }
  if (songs().length < 2) return show('<p>Du brauchst mindestens zwei Liked Songs auf Spotify.</p>');

  showPair(pickPair(songs(), state.votes));

  const showProblem = (msg: string) => {
    notice = msg;
    render();
  };
  initPlayer(showProblem).then(
    () => {
      canPlay = true;
      render();
      setInterval(async () => {
        const range = app.querySelector<HTMLInputElement>('.card.playing .seek input');
        const ms = range && !seeking ? await getPosition() : null;
        if (range && ms !== null && !seeking) showPosition(range, ms);
      }, 500);
    },
    (e) => {
      notice = message(e);
      render();
    },
  );
  getPlaylistIndex(playlists).then(
    (index) => {
      playlists = index;
      savePlaylists();
      render();
    },
    (e) => {
      notice = `Deine Playlists konnten nicht geladen werden: ${message(e)}`;
      render();
    },
  );
}

void start();
