import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vote, pickPair, top, type Song } from './rank.ts';

const song = (id: string, rating = 1500, games = 0): Song =>
  ({ id, uri: `spotify:track:${id}`, name: id, artist: '', image: '', durationMs: 0, rating, games });

test('vote moves equal points from loser to winner', () => {
  const a = song('a'), b = song('b');
  vote(a, b);
  assert.equal(a.rating, 1516);
  assert.equal(b.rating, 1484);
  assert.equal(a.games + b.games, 2);
});

test('an upset moves more points than an expected win', () => {
  const strong = song('s', 1700), weak = song('w', 1300);
  vote(strong, weak);
  const strong2 = song('s', 1700), weak2 = song('w', 1300);
  vote(weak2, strong2);
  assert.ok(weak2.rating - 1300 > strong.rating - 1700);
});

test('pickPair never pairs a song with itself and prefers unplayed songs', () => {
  const songs = [song('a', 1500, 5), song('b', 1500, 5), song('c', 1500, 0)];
  for (let i = 0; i < 100; i++) {
    const [x, y] = pickPair(songs);
    assert.notEqual(x, y);
    assert.ok(x.id === 'c' || y.id === 'c');
  }
});

test('pickPair does not always pick the same opponent among equal ratings', () => {
  const songs = Array.from({ length: 30 }, (_, i) => song(String(i)));
  const seen = new Set(Array.from({ length: 200 }, () => pickPair(songs).map((s) => s.id).join()));
  assert.ok(seen.size > 50);
});

test('top sorts by rating and skips unplayed songs', () => {
  const songs = [song('low', 1400, 1), song('new'), song('high', 1600, 1)];
  assert.deepEqual(top(songs).map((s) => s.id), ['high', 'low']);
});
