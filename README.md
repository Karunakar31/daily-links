# Daily Links IPTV playlist generator

This Node.js project builds cricket-focused M3U playlists from the upstream sports JSON and publishes them on GitHub Pages. It is compatible with OTT Navigator, NS Player, TiviMate, IPTV Smarters, Kodi, and other M3U clients.

## What it creates

| Playlist | Contents |
| --- | --- |
| `cricket.m3u` | Every playable cricket stream |
| `live-cricket.m3u` | Streams whose match status is `LIVE` |
| `upcoming-cricket.m3u` | Streams whose match status is `UPCOMING` |
| `india.m3u` | Matches involving India, India A, or Indian Women |
| `women.m3u` | Women's matches (including `_w`) |

The generator discovers every `stream_url*` and corresponding `drm_key*` field at runtime, including future numbered variations. It rejects empty or malformed stream URLs, pairs DRM keys by suffix, and removes duplicates using event name + stream URL.

## Local use

Install Node.js 22 or newer, then run:

```bash
npm run generate
```

The generator retries downloads three times, uses a 20-second request timeout, validates JSON, and writes state to `data/last_hash.txt` and `data/last_update.txt`. If both the SHA-256 content hash and source update time are unchanged, it exits successfully without rewriting playlists.

To regenerate regardless of state:

```bash
npm run generate:force
```

No package dependencies are required; Node's built-in `fetch`, crypto, and filesystem APIs are used.

## GitHub Actions and Pages

1. Push this repository to GitHub.
2. In **Settings → Pages**, set **Build and deployment** to **GitHub Actions**.
3. In **Settings → Actions → General**, ensure workflows have **Read and write permissions**.
4. Run **Update IPTV playlists** once from the Actions tab to create the first playlists and deployment.

The workflow runs hourly (`0 * * * *`) and can also be started manually. It generates files, commits only genuine changes under `playlist/` and `data/`, then deploys the generated M3U files at the Pages site root.

After Pages is enabled, replace the placeholders below with your account and repository names:

```text
https://<github-username>.github.io/<repo-name>/cricket.m3u
https://<github-username>.github.io/<repo-name>/live-cricket.m3u
https://<github-username>.github.io/<repo-name>/upcoming-cricket.m3u
https://<github-username>.github.io/<repo-name>/india.m3u
https://<github-username>.github.io/<repo-name>/women.m3u
```

## Troubleshooting

- **Workflow cannot push:** enable Actions read/write workflow permissions or use a `GITHUB_TOKEN` allowed to write contents.
- **Pages deployment fails:** confirm Pages is configured for GitHub Actions and that the repository permits GitHub Pages.
- **No entries:** the feed may have no cricket records with valid HTTP(S) stream URLs. The action log reports match and stream counts.
- **Fetch failures or rate limits:** the generator retries three times. Re-run the workflow later if the upstream GitHub raw endpoint remains unavailable.
- **A source schema changes:** numbered `stream_url`/`drm_key` fields are discovered dynamically. If the feed moves the `matches` array somewhere other than the root or `data`, update `resolveSource` in `scripts/generate-playlists.js`.
