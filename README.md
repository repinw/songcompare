# SongCompare

Rank your Spotify Liked Songs by picking the better of two, again and again. Your top 100 is kept in sync as a private Spotify playlist, "SongCompare Top 100". Every song shows which of your playlists it is already in, and you can add it to another playlist (existing or new) from the card or the top-100 list.

Everything runs in the browser. There is no backend: ratings live in `localStorage`.

## Setup

1. Create an app at https://developer.spotify.com/dashboard:
   - Under **APIs used**, check **Web API** and **Web Playback SDK**.
   - Add the redirect URI `http://127.0.0.1:5173/`. Spotify does not accept `localhost`, and the trailing slash matters.
   - In development mode, add every Spotify account that should log in under **User Management**.
2. Copy the Client ID into `.env`:
   ```sh
   cp .env.example .env   # then set VITE_SPOTIFY_CLIENT_ID
   ```
3. Install and start:
   ```sh
   npm install
   npm run dev            # http://127.0.0.1:5173
   ```

Playing songs in the browser needs **Spotify Premium**. Without Premium you can still vote.

## Scripts

- `npm run dev`: dev server
- `npm run build`: type-check and build to `dist/`
- `npm test`: ranking self-check (`node --test`, Node ≥ 23)

## Deploying

`dist/` is a static site that runs on any static host. Add `https://your-host/` as an extra redirect URI in the Spotify dashboard.
