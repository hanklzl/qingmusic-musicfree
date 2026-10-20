// Deliberately self-contained: this function is embedded into each generated plugin.
function createPlugin(options, createAdapter, dependencies) {
  const line = options.line;
  const adapter = createAdapter({ http: dependencies.http, crypto: dependencies.crypto, he: dependencies.he, line, legacy: !!options.legacy });
  const levels = { standard: 'standard', high: 'exhigh', super: 'lossless' };
  function inputItem(item) {
    const prepared = Object.assign({}, item);
    prepared.rid = String(line.id === 'tx' ? item.songmid || item.rid || item.id || '' : item.rid || item.id || '');
    return prepared;
  }
  function outputItem(item) {
    const output = Object.assign({}, item, { id: String(item.id), platform: options.platform });
    if (options.legacy && line.id === 'tx') {
      output.id = String(item.songid || item.id);
      output.songmid = String(item.songmid || item.rid || item.id);
      output.rid = output.songmid;
    }
    if (options.legacy && line.id === 'kg') {
      output.album_id = String(item.album_id || item.albumId || '');
      output.album_audio_id = item.album_audio_id === undefined ? 0 : item.album_audio_id;
    }
    return output;
  }
  function report(method, error) {
    console.error('[qingmusic] ' + method + ' failed: ' + String(error && error.message || error));
  }
  function playable(result, quality) {
    if (!result || typeof result.url !== 'string' || !/^https?:\/\//i.test(result.url)) throw new Error('INVALID_MEDIA_URL');
    const authority = result.url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
    const host = authority.replace(/:\d+$/, '').toLowerCase();
    if (authority.includes('@') || host.startsWith('[') || /^(localhost\.?|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || !host.includes('.')) throw new Error('LOCAL_ONLY_MEDIA_URL');
    if (result.need_decrypt || result.needDecrypt || result.final_ekey || result.finalEkey || result.encryption === 'cenc' || result.cek) throw new Error('UNSUPPORTED_ENCRYPTED_MEDIA');
    const headers = {};
    const supplied = Object.assign({}, result.headers || {}, result.playbackHeaders || {});
    for (const key of Object.keys(supplied)) {
      if (/^(referer|user-agent|origin|accept|accept-language|range)$/i.test(key) && typeof supplied[key] === 'string' && !/[\r\n]/.test(supplied[key])) headers[key] = supplied[key];
    }
    // The gateway may silently downgrade; requested quality is not evidence of actual quality.
    const userAgent = typeof result.userAgent === 'string' && !/[\r\n]/.test(result.userAgent) ? result.userAgent : undefined;
    return { url: result.url, headers, userAgent };
  }
  const plugin = {
    platform: options.platform,
    author: 'MusicFree QingMusic Adapter',
    version: options.version,
    primaryKey: options.primaryKey || ['id'],
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
    defaultSearchType: 'music',
    description: (options.legacy ? '旧元力插件身份兼容版；' : '') + '青听配置适配：' + line.name + '。第三方接口可用性由上游决定；不提供青听专属解密。',
    async search(query, page, type) {
      if (type && type !== 'music') return { data: [], isEnd: true };
      if (!Number.isInteger(page) || page < 1) throw new Error('INVALID_PAGE');
      try {
        const result = await adapter.search(query, page);
        if (!result || !Array.isArray(result.data)) throw new Error('INVALID_SEARCH_RESPONSE');
        return { data: result.data.map(outputItem), isEnd: !!result.isEnd };
      } catch (error) { report('search', error); throw error; }
    },
    async getMediaSource(item, quality) {
      quality = quality || 'standard';
      try {
        item = inputItem(item);
        if (adapter.getMediaSource) {
          if (line.id === 'bili' && quality !== 'standard' && !options.legacy) return null;
          const result = await adapter.getMediaSource(item, quality);
          return result ? playable(result, quality) : null;
        }
        const level = levels[quality];
        if (!level || !line.levels.includes(level)) return null;
        const rid = String(item.rid || item.id || '').trim();
        if (!rid) throw new Error('MISSING_TRACK_ID');
        const response = await dependencies.http.post(options.gatewayUrl, { source: line.id, rid, level }, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
        const payload = response.data;
        if (!payload || !(payload.code === 0 || payload.code === '0') || !payload.data) {
          throw new Error(String(payload && payload.code || 'INVALID_GATEWAY_RESPONSE'));
        }
        return playable(payload.data, quality);
      } catch (error) { report('getMediaSource', error); throw error; }
    }
  };
  if (options.srcUrl) plugin.srcUrl = options.srcUrl;
  for (const method of ['getMusicInfo', 'getLyric']) {
    if (typeof adapter[method] === 'function') plugin[method] = async function(item) {
      try { return await adapter[method](inputItem(item)); }
      catch (error) { report(method, error); throw error; }
    };
  }
  return plugin;
}
module.exports = { createPlugin };
