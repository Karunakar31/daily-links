#!/usr/bin/env node

/**
 * Fetches the upstream sports feed and regenerates M3U playlists on every run.
 * The field discovery intentionally uses patterns rather than a fixed schema, so
 * newly numbered stream_url/drm_key columns keep working without a code change.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE_URL = 'https://raw.githubusercontent.com/sm-monirulislam/Upcoming-and-Live-Sports-Data/main/Sports_data.json';
const RETRIES = 3;
const TIMEOUT_MS = 20_000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYLIST_DIR = join(ROOT, 'playlist');

const playlistNames = ['cricket', 'live-cricket', 'upcoming-cricket', 'india', 'women'];

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function firstValue(object, names) {
  const key = Object.keys(object || {}).find((candidate) => names.includes(candidate.toLowerCase()));
  return key ? object[key] : '';
}

function toUpper(value) {
  return text(value).toLocaleUpperCase('en-US');
}

function attribute(value) {
  return text(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('\r', ' ').replaceAll('\n', ' ');
}

function isPlayableUrl(value) {
  try {
    // IPTV URLs can contain player headers after a pipe, e.g. URL|Referer=... .
    const url = new URL(text(value).split('|', 1)[0]);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

async function fetchSource() {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(SOURCE_URL, {
        signal: controller.signal,
        headers: { 'user-agent': 'daily-links-playlist-generator/1.0', accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const body = await response.text();
      if (!body.trim()) throw new Error('Source returned an empty response');
      return body;
    } catch (error) {
      lastError = error;
      console.warn(`Download attempt ${attempt}/${RETRIES} failed: ${error.message}`);
      if (attempt < RETRIES) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Unable to download source after ${RETRIES} attempts: ${lastError.message}`);
}

function resolveSource(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Source JSON must be an object');
  const container = Array.isArray(payload.matches) ? payload
    : Array.isArray(payload.data?.matches) ? payload.data
      : payload;
  const matches = container.matches;
  if (!Array.isArray(matches)) throw new Error('Source JSON does not contain a matches array');
  return {
    name: firstValue(container, ['name']) || firstValue(payload, ['name']),
    lastUpdate: text(firstValue(container, ['last_update_time', 'lastupdatetime']) || firstValue(payload, ['last_update_time', 'lastupdatetime'])),
    totalMatches: Number(firstValue(container, ['total_matches', 'totalmatches'])) || matches.length,
    liveMatch: firstValue(container, ['live_match', 'livematch']),
    matches,
  };
}

function isCricket(match) {
  const category = text(firstValue(match, ['category']));
  if (category.toLowerCase() === 'cricket') return true;
  // Some source revisions omit Category; retain records whose supplied metadata clearly says cricket.
  return !category && JSON.stringify(match).toLowerCase().includes('cricket');
}

function fieldIndex(key, kind) {
  const expression = kind === 'stream'
    ? /^stream[_\s-]*url(?:[_\s-]*(\d+))?$/i
    : /^drm[_\s-]*key(?:[_\s-]*(\d+))?$/i;
  const match = key.match(expression);
  return match ? (match[1] || '0') : null;
}

function numericSuffix(key) {
  return text(key).match(/(?:[_\s-]|^)(\d+)$/)?.[1] || '0';
}

function walkValues(value, path = [], output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkValues(item, [...path, String(index)], output));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => walkValues(item, [...path, key], output));
  } else {
    output.push({ key: path.at(-1) || '', path, value: text(value) });
  }
  return output;
}

function matchingPathPart(path, expression) {
  return [...path].reverse().find((part) => expression.test(part)) || '';
}

function streamsFor(match) {
  const drmByIndex = new Map();
  const values = walkValues(match);
  for (const item of values) {
    const drmPart = matchingPathPart(item.path, /(?:drm|license)[_\s-]*(?:key|token)|(?:key|token)[_\s-]*(?:drm|license)/i);
    const index = fieldIndex(drmPart || item.key, 'drm');
    if ((index !== null || drmPart) && item.value) drmByIndex.set(index ?? numericSuffix(drmPart || item.key), item.value);
  }
  const streams = [];
  for (const item of values) {
    // Use the complete path: { m3u8_urls: ["https://..."] } has a numeric
    // leaf key, but its parent still correctly identifies it as a stream field.
    const streamPart = matchingPathPart(item.path, /stream|url|link|source|manifest|m3u8|play/i);
    const artworkPart = matchingPathPart(item.path, /logo|flag|image|poster|banner|thumbnail/i);
    const index = fieldIndex(streamPart || item.key, 'stream');
    const keyIsStreamLike = Boolean(streamPart);
    const keyIsArtwork = Boolean(artworkPart);
    // Prefer canonical stream_url fields, while accepting future/nested fields whose
    // names are clearly stream-like. Artwork URLs are deliberately excluded.
    if ((index !== null || keyIsStreamLike) && !keyIsArtwork && isPlayableUrl(item.value)) {
      const streamIndex = index ?? numericSuffix(streamPart || item.key);
      streams.push({ url: item.value, drmKey: drmByIndex.get(streamIndex) || '' });
    }
  }
  return streams;
}

function matchMetadata(match) {
  const event = text(firstValue(match, ['event_name', 'eventname', 'name', 'title'])) || 'Cricket';
  const teamA = text(firstValue(match, ['teama', 'team_a', 'team1', 'home_team', 'hometeam']));
  const teamB = text(firstValue(match, ['teamb', 'team_b', 'team2', 'away_team', 'awayteam']));
  return {
    event,
    teamA,
    teamB,
    status: toUpper(firstValue(match, ['status', 'match_status', 'matchstatus'])),
    logo: text(firstValue(match, ['teamaflag', 'team_a_flag', 'team1flag', 'logo'])) || text(firstValue(match, ['teambflag', 'team_b_flag', 'team2flag'])),
  };
}

function isIndia(metadata) {
  return /\bindia(?:\s+a)?\b|indian\s+women/i.test(`${metadata.event} ${metadata.teamA} ${metadata.teamB}`);
}

function isWomen(metadata) {
  return /women|women's|women’s|(?:^|\s)_w(?:\s|$)/i.test(`${metadata.event} ${metadata.teamA} ${metadata.teamB}`);
}

function m3uEntry(metadata, stream) {
  const header = `#EXTINF:-1 tvg-name="${attribute(metadata.event)}" tvg-logo="${attribute(metadata.logo)}" group-title="Cricket",${metadata.event.replaceAll('\r', ' ').replaceAll('\n', ' ')}`;
  return stream.drmKey
    ? `${header}\n#KODIPROP:inputstream.adaptive.license_type=clearkey\n#KODIPROP:inputstream.adaptive.license_key=${stream.drmKey}\n${stream.url}`
    : `${header}\n${stream.url}`;
}

function buildPlaylists(matches) {
  const entries = Object.fromEntries(playlistNames.map((name) => [name, []]));
  const seen = new Set();
  let duplicates = 0;
  let playable = 0;
  for (const match of matches) {
    const metadata = matchMetadata(match);
    for (const stream of streamsFor(match)) {
      const key = `${metadata.event}\u0000${stream.url}`;
      if (seen.has(key)) { duplicates += 1; continue; }
      seen.add(key);
      playable += 1;
      const entry = m3uEntry(metadata, stream);
      entries.cricket.push(entry);
      if (metadata.status === 'LIVE') entries['live-cricket'].push(entry);
      if (metadata.status === 'UPCOMING') entries['upcoming-cricket'].push(entry);
      if (isIndia(metadata)) entries.india.push(entry);
      if (isWomen(metadata)) entries.women.push(entry);
    }
  }
  return { entries, duplicates, playable };
}

async function main() {
  const raw = await fetchSource();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error('Source returned invalid JSON'); }
  const source = resolveSource(payload);
  console.log(`Source Last Update: ${source.lastUpdate || '(missing)'}`);
  console.log('Regeneration Mode: always generate; Git commits only changed playlist content');
  const cricket = source.matches.filter(isCricket);
  const { entries, duplicates, playable } = buildPlaylists(cricket);
  await mkdir(PLAYLIST_DIR, { recursive: true });
  await Promise.all([
    ...playlistNames.map((name) => writeFile(join(PLAYLIST_DIR, `${name}.m3u`), `#EXTM3U\n${entries[name].join('\n')}\n`, 'utf8')),
  ]);
  const live = cricket.filter((match) => matchMetadata(match).status === 'LIVE').length;
  const upcoming = cricket.filter((match) => matchMetadata(match).status === 'UPCOMING').length;
  console.log(`Feed Name: ${source.name || '(missing)'}`);
  console.log(`Total Matches: ${source.totalMatches}`);
  console.log(`Total Cricket Matches: ${cricket.length}`);
  console.log(`Live Cricket Matches: ${live}`);
  console.log(`Upcoming Cricket Matches: ${upcoming}`);
  console.log(`Total Playable Streams: ${playable}`);
  console.log(`Duplicate Entries Removed: ${duplicates}`);
  console.log(`Playlist File Counts: ${playlistNames.map((name) => `${name}=${entries[name].length}`).join(', ')}`);
  console.log('Playlists Generated: yes');
}

main().catch((error) => { console.error(`Generator failed: ${error.message}`); process.exitCode = 1; });
