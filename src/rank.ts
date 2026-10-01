export type Song = {
  id: string;
  uri: string;
  name: string;
  artist: string;
  image: string;
  durationMs: number;
  rating: number;
  games: number;
  wins: number; // a tie counts 0.5
  eliminated?: boolean;
};

const K = 32;
const COMEBACK_EVERY = 20;

const pick = <T>(list: T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

// ponytail: Elo is approximate; switch to Bradley–Terry or binary-insertion sort if the order stays noisy.
export function vote(a: Song, b: Song, scoreA: 1 | 0.5): void {
  const expectedA = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
  const delta = K * (scoreA - expectedA);
  a.rating += delta;
  b.rating -= delta;
  for (const [s, score] of [[a, scoreA], [b, 1 - scoreA]] as const) {
    const wasOut = s.eliminated;
    s.games++;
    s.wins += score;
    if (wasOut && score === 1) s.eliminated = false; // won its comeback duel
    else if (s.games === 3 && s.games - s.wins >= 2) s.eliminated = true; // preliminary round: lost 2 of the first 3
  }
}

// Normal pair: A = a least-played active song, B = one of the ~10 active songs closest in rating.
// Every 20th pair: an eliminated song gets a comeback duel against a top-100 song.
export function pickPair(songs: Song[], pairNo = 0, rand = Math.random): [Song, Song] {
  const out = songs.filter((s) => s.eliminated);
  const best = top(songs);
  let a: Song, b: Song;
  if (pairNo % COMEBACK_EVERY === COMEBACK_EVERY - 1 && out.length && best.length) {
    a = pick(out, rand);
    b = pick(best, rand);
  } else {
    const active = songs.filter((s) => !s.eliminated);
    const pool = active.length >= 2 ? active : songs;
    const minGames = Math.min(...pool.map((s) => s.games));
    a = pick(pool.filter((s) => s.games === minGames), rand);
    const near = pool
      .filter((s) => s !== a)
      .map((s) => ({ s, d: Math.abs(s.rating - a.rating) + rand() })) // rand() breaks ties between equal ratings
      .sort((x, y) => x.d - y.d)
      .slice(0, 10);
    b = pick(near, rand).s;
  }
  return rand() < 0.5 ? [a, b] : [b, a];
}

export const top = (songs: Song[], n = 100): Song[] =>
  songs.filter((s) => s.games > 0 && !s.eliminated).sort((a, b) => b.rating - a.rating).slice(0, n);

// Import from another device: per song, the version with more duels wins.
export function mergeSongs(local: Record<string, Song>, imported: Record<string, Song>): Record<string, Song> {
  const merged = { ...local };
  for (const [id, s] of Object.entries(imported)) if (!merged[id] || s.games > merged[id].games) merged[id] = s;
  return merged;
}
