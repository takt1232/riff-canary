const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ytFast = require('../yt-fast');

test('fast lookup picks plain-link audio formats, Opus first', () => {
  const player = { streamingData: { adaptiveFormats: [
    { itag: 137, mimeType: 'video/mp4', url: 'v' },
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: 'a140' },
    { itag: 251, mimeType: 'audio/webm; codecs="opus"', url: 'a251' },
    { itag: 250, mimeType: 'audio/webm; codecs="opus"', signatureCipher: 's=...' },
  ] } };
  assert.deepEqual(ytFast.pickFormats(player).map((f) => f.itag), [251, 140]);
  assert.deepEqual(ytFast.pickFormats(null), []);
});

test('video lookup prefers resolution, then H.264 over VP9/AV1', () => {
  const player = { streamingData: { adaptiveFormats: [
    { itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"', url: 'v1080', width: 1920, height: 1080 },
    { itag: 136, mimeType: 'video/mp4; codecs="avc1.4D401F"', url: 'v720', width: 1280, height: 720 },
    { itag: 247, mimeType: 'video/webm; codecs="vp9"', url: 'v720vp9', width: 1280, height: 720 },
    { itag: 135, mimeType: 'video/mp4; codecs="avc1.4D401E"', url: 'v480', width: 854, height: 480 },
    { itag: 244, mimeType: 'video/webm; codecs="vp9"', url: 'v480vp9', width: 854, height: 480 },
    { itag: 397, mimeType: 'video/mp4; codecs="av01.0.04M.08"', url: 'v480av1', width: 854, height: 480 },
    { itag: 134, mimeType: 'video/mp4; codecs="avc1.4D401E"', url: 'v360', width: 640, height: 360 },
    { itag: 137, mimeType: 'video/mp4', signatureCipher: 's=...', width: 1920, height: 1080 },
  ] } };
  assert.deepEqual(ytFast.pickVideoFormats(player, 480).map((f) => f.itag), [135, 244, 397, 134]);
  // all formats up to the cap, best first (the caller takes [0])
  assert.deepEqual(ytFast.pickVideoFormats(player, 720).map((f) => f.itag), [136, 247, 135, 244, 397, 134]);
  assert.deepEqual(ytFast.pickVideoFormats(null), []);
  // older videos can have only the muxed progressive format
  const progressive = { streamingData: { formats: [{ itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E"', url: 'p', width: 640, height: 360 }] } };
  assert.deepEqual(ytFast.pickVideoFormats(progressive).map((f) => f.itag), [18]);
});

test('art tracks and audio-only uploads are told apart from real videos', () => {
  assert.equal(ytFast.classifyVideoDetails({ author: 'The Weeknd - Topic', title: 'Blinding Lights' }), 'art');
  assert.equal(ytFast.classifyVideoDetails({ author: 'X', shortDescription: 'Provided to YouTube by Universal Music Group' }), 'art');
  assert.equal(ytFast.classifyVideoDetails({ author: 'TheWeekndVEVO', title: 'Blinding Lights (Official Audio)' }), 'audio');
  assert.equal(ytFast.classifyVideoDetails({ author: 'X', title: 'Song', shortDescription: 'Music video by X performing Song (Audio).' }), 'audio');
  assert.equal(ytFast.classifyVideoDetails({ author: '7clouds', title: 'The Weeknd - Blinding Lights (Lyrics)' }), 'lyric');
  assert.equal(ytFast.classifyVideoDetails({ author: 'X', title: 'Song', shortDescription: 'Official Lyric Video' }), 'lyric');
  assert.equal(ytFast.classifyVideoDetails({ author: 'TheWeekndVEVO', title: 'Blinding Lights (Official Video)' }), 'video');
  assert.equal(ytFast.classifyVideoDetails({ author: 'TheWeekndVEVO', title: 'Blinding Lights (Official Video)', shortDescription: 'Get the lyrics at example.com' }), 'video');
});

test('video ids come from links and bare ids only', () => {
  assert.equal(ytFast.videoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x'), 'dQw4w9WgXcQ');
  assert.equal(ytFast.videoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(ytFast.videoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(ytFast.videoId('soundcloud:123'), null);
});

test('song start and next-song lookups try the fast way before yt-dlp', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.equal((server.match(/await fastYouTubeStream\(/g) || []).length, 2);
  assert.ok(server.indexOf('await fastYouTubeStream(trackUrl, cleanId);') < server.indexOf("reason: 'stream' }"));
});
