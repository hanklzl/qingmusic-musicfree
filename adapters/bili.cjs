module.exports = function createAdapter(ctx) {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
  const headers = { Referer: 'https://www.bilibili.com/', 'User-Agent': userAgent };
  async function request(path, params) {
    const response = await ctx.http.get('https://api.bilibili.com' + path, { params, headers });
    const body = response.data;
    if (!body || body.code !== 0) throw new Error('Bilibili API error: ' + (body && body.code));
    return body.data;
  }
  function duration(value) {
    if (typeof value === 'number') return value;
    return String(value || '').split(':').reduce((seconds, part) => seconds * 60 + (Number(part) || 0), 0);
  }
  function text(value) {
    return ctx.he.decode(String(value || '').replace(/<[^>]*>/g, ''));
  }
  function mapVideo(video) {
    const id = String(video.bvid || video.aid || video.id);
    const artwork = video.pic || '';
    return { id, rid: id, bvid: video.bvid || '', aid: String(video.aid || video.id || ''),
      title: text(video.title), artist: text(video.author), album: '',
      artwork: artwork.startsWith('//') ? 'https:' + artwork : artwork, duration: duration(video.duration) };
  }
  return {
    async search(query, page) {
      page = Math.max(1, Number(page) || 1);
      const data = await request('/x/web-interface/search/all/v2', { keyword: query, page });
      const section = (data.result || []).find(section => section.result_type === 'video');
      const videos = section && section.data || [];
      const pages = data.pageinfo && data.pageinfo.video && data.pageinfo.video.pages || data.numPages;
      return { data: videos.map(mapVideo), isEnd: videos.length === 0 || (pages ? page >= Number(pages) : videos.length < 20) };
    },
    async getMediaSource(item, quality = 'standard') {
      const qualityRank = ['low', 'standard', 'high', 'super'].indexOf(quality);
      if (qualityRank < 0) throw new Error('Unsupported Bilibili quality: ' + String(quality));
      const id = String(item.bvid || item.rid || item.id);
      const identity = id.startsWith('BV') ? { bvid: id } : { avid: String(item.aid || id) };
      let cid = item.cid;
      if (!cid) {
        // These two official endpoints use different names for a numeric video ID.
        const pageIdentity = identity.bvid ? identity : { aid: identity.avid };
        const pages = await request('/x/player/pagelist', pageIdentity);
        cid = pages && pages[0] && pages[0].cid;
      }
      if (!cid) throw new Error('Bilibili video has no cid');
      const data = await request('/x/player/playurl', Object.assign({}, identity, { cid, fnval: 16, fnver: 0, fourk: 1 }));
      const audio = data && data.dash && data.dash.audio || [];
      const sortedAudio = audio.filter(track => track.baseUrl || track.base_url).sort((a, b) => Number(a.bandwidth || 0) - Number(b.bandwidth || 0));
      const audioIndex = !ctx.legacy || quality === 'super' ? sortedAudio.length - 1 : Math.min(qualityRank, sortedAudio.length - 1);
      const selected = sortedAudio[audioIndex];
      if (!selected) throw new Error('Bilibili DASH audio unavailable');
      const referer = 'https://www.bilibili.com/video/' + (identity.bvid || 'av' + identity.avid);
      return { url: selected.baseUrl || selected.base_url, headers: { Referer: referer, 'User-Agent': userAgent }, userAgent };
    },
  };
};
