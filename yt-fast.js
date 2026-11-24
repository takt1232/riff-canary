// Fast YouTube stream lookup for the computer: one request to YouTube's player API as the visionOS client
// (the route the phone app uses, mobile/extract.js) instead of starting yt-dlp, which takes seconds per
// song. YouTube doesn't hand out every song this way, so the link is checked before it's used and the
// caller falls back to yt-dlp when this returns null.
//
// The same answer also lists the video's adaptive formats (video-only DASH links). They are kept here so
// the Now playing drawer can use the song's video as a looping background without a second lookup.
const https = require('https');

const VOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const VISITOR_MAX_AGE = 30 * 60e3;
const PREFERRED_ITAGS = [251, 140, 250, 249, 139];
const VIDEO_MAX_HEIGHT = 480;

function request(url, { method = 'GET', headers = {}, body = null, timeout = 4000, maxBytes = 4 * 1024 * 1024, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, timeout, maxHeaderSize: 128 * 1024 }, (res) => {
      // googlevideo moves a request to another server with a redirect; only https ones are followed
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0 && method === 'GET') {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url); } catch (e) { reject(e); return; }
        if (next.protocol !== 'https:') { reject(new Error('insecure redirect')); return; }
        request(next.href, { method, headers, timeout, maxBytes, redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(new Error('response too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let visitor = null;
let visitorAt = 0;
async function visitorId(force) {
  if (visitor && !force && Date.now() - visitorAt < VISITOR_MAX_AGE) return visitor;
  const r = await request('https://www.youtube.com/', { headers: { 'User-Agent': VOS_UA, 'Accept-Language': 'en-US' } });
  visitor = (r.body.match(/"VISITOR_DATA":"([^"]+)"/) || [])[1] || null;
  visitorAt = Date.now();
  return visitor;
}

function playerBody(id, v) {
  return JSON.stringify({
    context: { client: { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', userAgent: VOS_UA, osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0, visitorData: v || undefined } },
    videoId: id, contentCheckOk: true, racyCheckOk: true,
  });
}

// audio-only formats with a plain link, best first
function pickFormats(player) {
  const formats = ((player && player.streamingData && player.streamingData.adaptiveFormats) || [])
    .filter((f) => f && f.url && /^audio\//.test(f.mimeType || ''));
  const rank = (f) => { const i = PREFERRED_ITAGS.indexOf(f.itag); return i === -1 ? PREFERRED_ITAGS.length : i; };
  return formats.sort((a, b) => rank(a) - rank(b));
}

// video-only formats with a plain link, best first. Resolution wins; at the same resolution H.264/MP4 is
// preferred (hardware decoding, lighter than VP9/AV1), then VP9, then AV1.
function pickVideoFormats(player, maxHeight = VIDEO_MAX_HEIGHT) {
  const cap = Number(maxHeight);
  const limit = Number.isFinite(cap) && cap > 0 ? cap : VIDEO_MAX_HEIGHT;
  const codec = (f) => {
    const m = String(f.mimeType || '');
    if (/avc1/i.test(m)) return 0;
    if (/vp0?9/i.test(m)) return 1;
    if (/av01/i.test(m)) return 2;
    return 3;
  };
  const all = [
    ...((player && player.streamingData && player.streamingData.adaptiveFormats) || []),
    // a few older videos only offer the muxed progressive formats (itag 18/22); the video is muted,
    // so a muxed one is still usable when there is no adaptive video stream
    ...((player && player.streamingData && player.streamingData.formats) || []),
  ];
  return all
    .filter((f) => f && f.url && /^video\//.test(f.mimeType || '') && Number(f.height) > 0 && Number(f.height) <= limit)
    .sort((a, b) => (Number(b.height) - Number(a.height)) || (codec(a) - codec(b)) || (Number(b.bitrate) - Number(a.bitrate)));
}

function videoCandidate(f) {
  return {
    url: f.url,
    headers: { 'User-Agent': VOS_UA },
    itag: f.itag,
    width: Number(f.width) || 0,
    height: Number(f.height) || 0,
    fps: Number(f.fps) || 0,
    mimeType: f.mimeType || '',
    qualityLabel: f.qualityLabel || '',
    contentLength: Number(f.contentLength) || 0,
  };
}

// What kind of upload this is, as far as the player response can tell. YouTube has no "lyric video" flag:
// these are ordinary uploads, so the title/description are matched instead. "lyric" is still shown; only
// auto-generated art tracks and audio-only uploads are kept off the screen.
function classifyVideoDetails(details) {
  const d = details || {};
  const title = String(d.title || '');
  const desc = String(d.shortDescription || '');
  const author = String(d.author || '');
  if (/- Topic\s*$/i.test(author) || /^Provided to YouTube by\b/i.test(desc.trim())) return 'art';
  if (/\(audio\)|\[audio\]|\bofficial audio\b|\baudio only\b|\bvisuali[sz]er\b/i.test(title)) return 'audio';
  // VEVO's audio uploads say "Music video by ... performing ... (Audio)." even when the title is bare
  if (/\bmusic video by\b/i.test(desc) && /\((?:official\s+)?audio\)/i.test(desc)) return 'audio';
  // "lyrics" in a music video's description is usually a link or the printed lyrics, not the format:
  // require it in the title or an explicit "official lyric video" line (best effort, never a filter)
  if (/\blyrics?\b/i.test(title) || /\b(?:letra|paroles|testo)\b|歌詞|가사/i.test(title)) return 'lyric';
  if (/\bofficial\s+lyric\s+video\b/i.test(desc)) return 'lyric';
  return 'video';
}

const videoId = (u) => { const m = String(u || '').match(/(?:v=|youtu\.be\/|\/shorts\/|^)([\w-]{11})(?:[&?#]|$)/); return m ? m[1] : null; };

async function fetchPlayer(id) {
  if (!/^[\w-]{11}$/.test(String(id || ''))) return null;
  for (const force of [false, true]) {
    const v = await visitorId(force);
    const headers = { 'User-Agent': VOS_UA, 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '101', 'X-Youtube-Client-Version': '1.02', Origin: 'https://www.youtube.com' };
    if (v) headers['X-Goog-Visitor-Id'] = v;
    const r = await request('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers, body: playerBody(id, v) });
    let player = null;
    try { player = JSON.parse(r.body); } catch (_) { return null; }
    const status = player && player.playabilityStatus && player.playabilityStatus.status;
    if (status === 'LOGIN_REQUIRED' && !force) continue;
    if (status !== 'OK') return null;
    return player;
  }
  return null;
}

async function pickAudioFormat(player) {
  // YouTube lists links it then refuses (403) for some songs: check the first ones answer before using them
  for (const f of pickFormats(player).slice(0, 2)) {
    try {
      const probe = await request(f.url, { headers: { 'User-Agent': VOS_UA, Range: 'bytes=0-1023' }, timeout: 3000, maxBytes: 4096 });
      if (probe.status === 200 || probe.status === 206) return { url: f.url, headers: { 'User-Agent': VOS_UA }, itag: f.itag };
    } catch (_) {}
  }
  return null;
}

// True when the URL answers a tiny range request. The proxy does the real fetching.
async function probe(url, headers) {
  try {
    const r = await request(url, { headers: { ...(headers || {}), Range: 'bytes=0-1023' }, timeout: 3500, maxBytes: 4096 });
    return r.status === 200 || r.status === 206;
  } catch (_) {
    return false;
  }
}

// Audio and video from one player response. Used when a song starts, so the video link is ready by the
// time the drawer asks for it.
async function lookupMedia(id) {
  const player = await fetchPlayer(id);
  if (!player) return null;
  const details = player.videoDetails || {};
  const audio = await pickAudioFormat(player);
  const f = pickVideoFormats(player)[0];
  let video = f ? videoCandidate(f) : null;
  if (video) {
    video.kind = classifyVideoDetails(details);
    video.live = !!details.isLiveContent;
  }
  return { audio, video, details };
}

// Video only, without probing the audio (the song may already be playing).
async function lookupVideo(id, maxHeight = VIDEO_MAX_HEIGHT) {
  const player = await fetchPlayer(id);
  if (!player) return null;
  const f = pickVideoFormats(player, maxHeight)[0];
  if (!f) return null;
  const video = videoCandidate(f);
  const details = player.videoDetails || {};
  video.kind = classifyVideoDetails(details);
  video.live = !!details.isLiveContent;
  return video;
}

async function lookup(id) {
  const media = await lookupMedia(id);
  return media && media.audio;
}

module.exports = {
  lookup, lookupMedia, lookupVideo, probe,
  pickFormats, pickVideoFormats, classifyVideoDetails, videoCandidate,
  videoId, VOS_UA, VIDEO_MAX_HEIGHT,
};
