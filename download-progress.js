'use strict';
// yt-dlp progress for the download dialog. A plain `[download] 42%` line is hard to read reliably, so the
// downloader asks yt-dlp for one machine-readable line per update and both server.js and the tests use this
// parser. The template keys are yt-dlp's public progress fields (speed is bytes per second).
const PREFIX = 'CANARY_PROGRESS|';
const PROGRESS_ARGS = [
  '--newline',
  '--progress-template',
  `${PREFIX}%(progress.status)s|%(progress._percent_str)s|%(progress.speed)s|%(progress.eta)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s`,
];

function numberOrNull(value) {
  const cleaned = String(value == null ? '' : value).replace(/[^0-9.]/g, '');
  if (!cleaned || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseProgressLine(line) {
  const text = String(line == null ? '' : line).trim();
  if (!text.startsWith(PREFIX)) return null;
  const parts = text.slice(PREFIX.length).split('|');
  if (parts.length < 6) return null;
  const status = parts[0].trim().toLowerCase();
  const percent = numberOrNull(parts[1]);
  return {
    status,
    percent: percent === null ? null : Math.max(0, Math.min(100, percent)),
    speed: numberOrNull(parts[2]),
    eta: numberOrNull(parts[3]),
    downloadedBytes: numberOrNull(parts[4]),
    totalBytes: numberOrNull(parts[5]),
  };
}

module.exports = { PREFIX, PROGRESS_ARGS, parseProgressLine };
