import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSongs, pickPair, top, vote, type Song } from './rank.ts';

const song = (id: string, rating = 1500, games = 0, wins = games / 2): Song =>
  ({ id, uri: `spotify:track:${id}`, name: id, artist: '', image: '', durationMs: 0, rating, games, wins });

test('vote moves equal points from loser to winner', () => {
  const a = song('a'), b = song('b');
  vote(a, b, 1);
  assert.equal(a.rating, 1516);
  assert.equal(b.rating, 1484);
  assert.deepEqual([a.games, a.wins, b.games, b.wins], [1, 1, 1, 0]);
});

test('a tie moves the ratings towards each other and counts half a win', () => {
  const strong = song('s', 1600), weak = song('w', 1400);
  vote(strong, weak, 0.5);
  assert.ok(strong.rating < 1600 && weak.rating > 1400);
  assert.equal(strong.wins, 0.5);
});

test('an upset moves more points than an expected win', () => {
  const strong = song('s', 1700), weak = song('w', 1300);
  vote(strong, weak, 1);
  const strong2 = song('s', 1700), weak2 = song('w', 1300);
  vote(weak2, strong2, 1);
  assert.ok(weak2.rating - 1300 > strong.rating - 1700);
});

test('losing 2 of the first 3 duels eliminates; a tie counts as half a loss', () => {
  const x = song('x'), opp = song('o');
  vote(opp, x, 1);
  vote(x, opp, 1);
  vote(opp, x, 1);
  assert.equal(x.eliminated, true);

  const y = song('y');
  vote(opp, y, 1); // 1 loss
  vote(y, opp, 0.5); // +0.5
  vote(y, opp, 1); // 1.5 losses after 3 → stays in
  assert.ok(!y.eliminated);

  const z = song('z');
  vote(opp, z, 1);
  vote(z, opp, 0.5);
  vote(z, opp, 0.5); // 2 losses after 3 → out
  assert.equal(z.eliminated, true);
});

test('winning a comeback duel brings an eliminated song back', () => {
  const out = { ...song('out', 1400, 3, 1), eliminated: true }, champ = song('c', 1700, 10);
  vote(out, champ, 1);
  assert.ok(!out.eliminated);
  const out2 = { ...song('out2', 1400, 3, 1), eliminated: true };
  vote(out2, champ, 0.5);
  assert.equal(out2.eliminated, true);
});

test('pickPair never pairs a song with itself, prefers unplayed songs and skips eliminated ones', () => {
  const songs = [song('a', 1500, 5), song('b', 1500, 5), song('c', 1500, 0), { ...song('x', 1400, 3, 1), eliminated: true }];
  for (let i = 0; i < 100; i++) {
    const [p, q] = pickPair(songs, 0);
    assert.notEqual(p, q);
    assert.ok(p.id === 'c' || q.id === 'c');
    assert.ok(p.id !== 'x' && q.id !== 'x');
  }
});

test('every 20th pair is a comeback duel: eliminated song vs a top song', () => {
  const songs = [song('a', 1600, 5), song('b', 1500, 5), { ...song('x', 1400, 3, 1), eliminated: true }];
  for (let i = 0; i < 50; i++) {
    const ids = pickPair(songs, 19).map((s) => s.id).sort();
    assert.ok(ids.includes('x') && (ids.includes('a') || ids.includes('b')));
  }
});

test('pickPair does not always pick the same opponent among equal ratings', () => {
  const songs = Array.from({ length: 30 }, (_, i) => song(String(i)));
  const seen = new Set(Array.from({ length: 200 }, () => pickPair(songs).map((s) => s.id).join()));
  assert.ok(seen.size > 50);
});

test('top sorts by rating and skips unplayed and eliminated songs', () => {
  const songs = [song('low', 1400, 1), song('new'), song('high', 1600, 1), { ...song('out', 1700, 3, 1), eliminated: true }];
  assert.deepEqual(top(songs).map((s) => s.id), ['high', 'low']);
});

test('mergeSongs keeps the version with more duels per song', () => {
  const local = { a: song('a', 1550, 10), b: song('b', 1500, 2) };
  const imported = { a: song('a', 1600, 4), b: song('b', 1450, 6), c: song('c', 1500, 1) };
  const m = mergeSongs(local, imported);
  assert.deepEqual([m.a.rating, m.b.rating, m.c.rating], [1550, 1450, 1500]);
});
