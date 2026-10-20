// Explicit opt-in live-network smoke. Never runs as part of `node --test`.
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
function isSuccessful(results, requireDecode) {
  return results.length > 0 && results.every(r => !r.error && r.tracks.length > 0 && r.tracks.every(t =>
    t.media.length > 0 && t.media.every(m => m.audio === true && !m.error && (!requireDecode || m.decoded === true))));
}
async function decode(source) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, source.headers, source.userAgent ? { 'User-Agent': source.userAgent } : {});
    const headerText = Object.entries(headers).map(([k, v]) => k + ': ' + v + '\r\n').join('');
    const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-rw_timeout', '15000000', '-headers', headerText,
      '-i', source.url, '-t', '1', '-map', '0:a:0', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('AUDIO_DECODE_TIMEOUT')); }, 25000);
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(true); else reject(new Error('AUDIO_DECODE_FAILED_' + code + ': ' + stderr.replace(/https?:\/\/\S+/g, '[media URL]').slice(-300))); });
  });
}
async function main() {
  const args = process.argv.slice(2);
  const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  const root = path.resolve(arg('--plugins', 'public'));
  const runtimeRequire = createRequire(path.join(path.resolve(arg('--runtime-root', __dirname)), 'package.json'));
  const axiosModule = runtimeRequire('axios');
  const http = (axiosModule.default || axiosModule).create({ timeout: 15000 });
  const query = arg('--query', '海阔天空');
  const qualities = arg('--qualities', 'standard').split(',');
  const limit = Number(arg('--tracks', '1'));
  const selected = arg('--ids', 'kw,kg,wy,tx,bili,mg').split(',');
  const fixtures = args.includes('--fixtures') ? JSON.parse(await fs.readFile(arg('--fixtures'), 'utf8')) : null;
  const prefix = arg('--variant', 'normal') === 'compat' ? 'yuanli-' : 'qing-';
  const modules = { axios: http, 'crypto-js': runtimeRequire('crypto-js'), he: runtimeRequire('he') };
  for (const key of Object.keys(modules)) modules[key].default = modules[key];
  const results = [];
  for (const id of selected) {
    const result = { id, query: fixtures ? undefined : query, mode: fixtures ? 'saved-item-fixture' : 'search', searchCount: 0, tracks: [] };
    try {
      const script = await fs.readFile(path.join(root, prefix + id + '.js'), 'utf8');
      const context = { module: { exports: {} }, console, require(name) {
        if (!modules[name]) throw new Error('Unsupported require: ' + name);
        return modules[name];
      } };
      vm.runInNewContext(script, context, { timeout: 5000 });
      const plugin = context.module.exports;
      const search = fixtures ? { data: fixtures[id] || [] } : await plugin.search(query, 1, 'music');
      if (!fixtures) result.searchCount = search.data.length;
      for (const item of search.data.slice(0, limit)) {
        const track = { title: item.title, artist: item.artist, rid: item.rid || item.id, media: [] };
        for (const quality of qualities) {
          const media = { quality };
          try {
            const source = await plugin.getMediaSource(item, quality);
            if (!source) throw new Error('UNSUPPORTED_QUALITY');
            const response = await http.get(source.url, {
              headers: { ...(source.headers || {}), ...(source.userAgent ? { 'User-Agent': source.userAgent } : {}), Range: 'bytes=0-4095' },
              responseType: 'stream', timeout: 15000
            });
            const stream = response.data;
            const bytes = await new Promise((resolve, reject) => {
              const timer = setTimeout(() => { stream.destroy(); reject(new Error('AUDIO_READ_TIMEOUT')); }, 15000);
              stream.once('error', error => { clearTimeout(timer); reject(error); });
              const chunks = [];
              let length = 0;
              stream.once('end', () => { clearTimeout(timer); length ? resolve(Buffer.concat(chunks).subarray(0, 4096)) : reject(new Error('EMPTY_AUDIO')); });
              stream.on('data', chunk => {
                chunks.push(Buffer.from(chunk).subarray(0, 4096 - length));
                length += chunks[chunks.length - 1].length;
                if (length >= 4096) { clearTimeout(timer); stream.destroy(); resolve(Buffer.concat(chunks)); }
              });
            });
            media.status = response.status;
            media.mime = response.headers['content-type'] || '';
            media.bytes = bytes.length;
            media.signature = bytes.subarray(0, 12).toString('hex');
            media.sampleSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
            media.audio = /^(audio\/|video\/mp4|application\/(octet-stream|mp4|ogg))/i.test(media.mime) && bytes.length >= 32 && !/^\s*[<{]/.test(bytes.subarray(0, 16).toString('utf8'));
            if (args.includes('--decode')) media.decoded = await decode(source);
          } catch (error) { media.error = String(error.message); }
          track.media.push(media);
        }
        if (plugin.getLyric) {
          try { const lyric = await plugin.getLyric(item); track.lyricLength = lyric && String(lyric.rawLrc || '').length || 0; }
          catch (error) { track.lyricError = String(error.message); }
        }
        result.tracks.push(track);
      }
    } catch (error) { result.error = String(error.message); }
    results.push(result);
    console.log(JSON.stringify(result));
  }
  if (args.includes('--report')) await fs.writeFile(path.resolve(arg('--report')), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
  if (!isSuccessful(results, args.includes('--decode'))) process.exitCode = 1;
}
module.exports = { isSuccessful };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
