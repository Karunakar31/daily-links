# Daily Links IPTV playlist generator

This Node.js project builds cricket-focused M3U playlists from the upstream sports JSON and commits updates to this repository. It is compatible with OTT Navigator, NS Player, TiviMate, IPTV Smarters, Kodi, and other M3U clients.

## What it creates

| Playlist | Contents |
| --- | --- |
| `cricket.m3u` | Every playable cricket stream |
| `live-cricket.m3u` | Streams whose match status is `LIVE` |
| `upcoming-cricket.m3u` | Streams whose match status is `UPCOMING` |
| `india.m3u` | Matches involving India, India A, or Indian Women |
| `women.m3u` | Women's matches (including `_w`) |

The generator discovers stream-like URL fields at runtime, including nested `m3u8` arrays and future numbered variations. It rejects empty or malformed stream URLs, pairs DRM keys by suffix, and removes duplicates using event name + stream URL.

## Local use

Install Node.js 22 or newer, then run:

```bash
npm run generate
```

The generator retries downloads three times, uses a 20-second request timeout, and validates JSON. It regenerates every playlist on every run; GitHub Actions commits only when the generated playlist content actually differs.

No package dependencies are required; Node's built-in `fetch`, crypto, and filesystem APIs are used.

## GitHub Actions

1. Push this repository to GitHub.
2. In **Settings → Actions → General**, ensure workflows have **Read and write permissions**.
3. Run **Update IPTV playlists** once from the Actions tab to generate the first update.

The workflow runs hourly (`0 * * * *`) and can also be started manually. It regenerates files every time, but commits only genuine changes under `playlist/`. It does not deploy or host anything with GitHub Pages.

Use the repository's raw-file URLs in your IPTV player, replacing the placeholders below:

```text
https://raw.githubusercontent.com/<github-username>/<repo-name>/main/playlist/cricket.m3u
https://raw.githubusercontent.com/<github-username>/<repo-name>/main/playlist/live-cricket.m3u
https://raw.githubusercontent.com/<github-username>/<repo-name>/main/playlist/upcoming-cricket.m3u
https://raw.githubusercontent.com/<github-username>/<repo-name>/main/playlist/india.m3u
https://raw.githubusercontent.com/<github-username>/<repo-name>/main/playlist/women.m3u
```

## Troubleshooting

- **Workflow cannot push:** enable Actions read/write workflow permissions or use a `GITHUB_TOKEN` allowed to write contents.
- **Workflow cannot start:** enable GitHub Actions for the repository, then use the Actions tab to run it once manually.
- **No entries:** the feed may have no cricket records with valid HTTP(S) stream URLs. The action log reports match and stream counts.
- **Fetch failures or rate limits:** the generator retries three times. Re-run the workflow later if the upstream GitHub raw endpoint remains unavailable.
- **A source schema changes:** numbered `stream_url`/`drm_key` fields are discovered dynamically. If the feed moves the `matches` array somewhere other than the root or `data`, update `resolveSource` in `scripts/generate-playlists.js`.
