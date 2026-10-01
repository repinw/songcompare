export type Song = {
  id: string;
  uri: string;
  name: string;
  artist: string;
  image: string;
  durationMs: number;
  rating: number;
  games: number;
};

const K = 32;

// ponytail: Elo is approximate; switch to Bradley–Terry or binary-insertion sort if the order stays noisy.
export function vote(winner: Song, loser: Song): void {
  const expected = 1 / (1 + 10 ** ((loser.rating - winner.rating) / 400));
  const delta = K * (1 - expected);
  winner.rating += delta;
  loser.rating -= delta;
  winner.games++;
  loser.games++;
}

// A = a least-played song, B = a random one of the ~10 closest in rating (votes go where the order is unsure).
export function pickPair(songs: Song[], rand = Math.random): [Song, Song] {
  const minGames = Math.min(...songs.map((s) => s.games));
  const fresh = songs.filter((s) => s.games === minGames);
  const a = fresh[Math.floor(rand() * fresh.length)];
  const near = songs
    .filter((s) => s !== a)
    .map((s) => ({ s, d: Math.abs(s.rating - a.rating) + rand() })) // rand() breaks ties between equal ratings
    .sort((x, y) => x.d - y.d)
    .slice(0, 10);
  const b = near[Math.floor(rand() * near.length)].s;
  return rand() < 0.5 ? [a, b] : [b, a];
}

export const top = (songs: Song[], n = 100): Song[] =>
  songs.filter((s) => s.games > 0).sort((a, b) => b.rating - a.rating).slice(0, n);
