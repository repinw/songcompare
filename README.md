# SongCompare

Rank your Spotify Liked Songs by picking the better of two songs, again and again.

Live: https://repinw.github.io/songcompare/

## How it works

- **Listening:** each pair plays a 15 s snippet of A, then B, both starting about 30% in. "Ganz hören" plays the whole song from the start.
- **Voting:** A, B, tie (half a win each) or skip. Undo goes back as many steps as you like while the page is open.
- **Ranking:** Elo.
  - **Preliminary round:** a song that loses 2 of its first 3 duels is eliminated, and a tie counts as half a loss.
  - **Comeback:** about every 20th pair, an eliminated song plays a top-100 song. If it wins, it is back in.
- **Top 100:** kept in sync as the public playlist "SongCompare Top 100". A new device finds the existing playlist instead of creating a second one.
- **Playlists:** every song shows which of your playlists it is in ("In: …"). You can add it to an existing playlist or a new one; new playlists are private. Songs are never removed from playlists.
- **Storage:**
  - Ratings live in the browser (`localStorage`).
  - Songs you un-like keep their rating and come back if you like them again.
  - "Sicherung exportieren" saves a file. "Sicherung importieren" merges one in on another device: per song, the version with more duels wins.

### Keys

| Key | Action |
| --- | --- |
| ← / → | Vote A / B |
| ↓ | Tie |
| ↑ | Skip |
| Backspace | Undo |
| Space | Pause / resume |

On a phone, tap a card to vote for it.

## Setup

1. Create an app at https://developer.spotify.com/dashboard:
   - Under **APIs used**, check **Web API** and **Web Playback SDK**.
   - Add both redirect URIs: `http://127.0.0.1:5173/` (dev) and `https://repinw.github.io/songcompare/` (live). Spotify does not accept `localhost`, and the trailing slash matters.
   - The app owner needs Spotify Premium. After Premium is activated, it can take a few hours before the API accepts requests.
   - In development mode, add every Spotify account that should log in (yours and your friends') under **User Management**.
2. For local dev, copy the Client ID into `.env`:
   ```sh
   cp .env.example .env   # then set VITE_SPOTIFY_CLIENT_ID
   ```
3. Install and start:
   ```sh
   npm install
   npm run dev            # http://127.0.0.1:5173
   ```

Playing songs needs **Spotify Premium**. Without it you can still vote.

## Scripts

- `npm run dev`: dev server
- `npm run build`: type-check and build to `dist/`, served under `/songcompare/`
- `npm test`: ranking self-check (`node --test`, Node ≥ 23)

## Deploying

Every push to `master` runs `.github/workflows/pages.yml`: tests, build, then deploy to GitHub Pages. The Client ID is set in the workflow; it is not a secret.
