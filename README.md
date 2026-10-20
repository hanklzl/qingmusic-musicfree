# 青听配置 → MusicFree 插件

状态：当前可执行工具。适用于原版 MusicFree 与 MusicFreeAndroid 原生版；不修改播放器。

将 [青听线路配置](https://13413.kstore.vip/QingMusic/music.json) 的全部六条线路生成独立 CommonJS 插件：QQ、酷狗、酷我、网易、咪咕、哔哩哔哩。配置仅声明线路；搜索/歌词适配器和播放解析客户端随插件一起打包，安装后不依赖 Node.js 或青听 App。

## 安装

MusicFree → 设置 → 插件设置 → 从网络安装，粘贴订阅：

```text
https://hanklzl.github.io/qingmusic-musicfree/plugins.json
```

备用订阅（GitHub 原始文件，部分网络环境无法直连）：

```text
https://raw.githubusercontent.com/hanklzl/qingmusic-musicfree/main/docs/plugins.raw.json
```

六个插件名称均以“青听”开头，与旧元力插件分开。建议安装后选择“青听QQ”或“青听酷狗”搜索，再播放；既有歌单歌曲仍属于旧插件，不会自动迁移来源。也可以单独下载 `docs/qing-*.js` 后从本地安装。

## 能力和限制

- 六条线路支持歌曲搜索、分页、播放；QQ/酷狗/酷我/网易/咪咕提供歌词。哔哩哔哩使用视频的音轨，不伪造歌曲歌词。
- 首版未移植歌单、排行榜、歌手、专辑列表等非配置声明能力；不声称覆盖 MusicFree 全部 API。
- 五个音乐平台使用青听当前公开解析网关；哔哩哔哩使用官方 DASH 接口。未内置青听客户端签名密钥、用户账号、设备凭证或媒体解密密钥。
- 普通音质已验证搜索、HTTP 音频读取和 FFmpeg 解码；证据见发布目录 `smoke-*.json`。这不是手机端完整播放验收，也不保证所有歌曲、地区、VIP/无损档位或长期稳定性。
- 标准 `standard` → 青听 `standard`；高音质 `high` → `exhigh`；超高 `super` → `lossless`。仅暴露配置声明的映射。`low` 无对应档位，返回不可用并交给播放器既有回退策略。哔哩哔哩只走 `standard`。
- 音质参数只是向上游提出的请求，不是实际音质保证：已观测到酷我 `lossless` 仍返回 MP3；因此插件不凭请求档位宣称已获得无损。QQ、酷狗、网易样本在 `lossless` 档返回 FLAC 并通过解码，但不能推广到所有歌曲。
- 拒绝需要 QMC/CENC 等专属解密或依赖青听本地代理的结果。不得将“返回一个 URL”等同于能够播放。
- 咪咕搜索没有可靠时长，使用 `duration=0` 表示未知；网易封面可通过按需详情补齐。
- `no-cache` 每次在线播放重新解析短期媒体地址。上游失败明确抛错，不把网络错误当空搜索成功。
- 当前 MusicFreeAndroid 搜索→播放链路可能重复解析一次地址（原生调用链既有行为）；本工具不以长期缓存掩盖过期 URL 问题，也没有扩大范围修改播放器。

仅在具备相应权利、遵守上游服务条款的情况下使用。接口、品牌和歌曲版权归各自权利方；项目与青听及音乐平台没有官方关联。

## 生成与测试

Node.js 22+。从本工具目录执行：

```bash
npm ci
npm test
npm run build
```

指定配置与自己的托管路径：

```bash
node build.cjs --source https://13413.kstore.vip/QingMusic/music.json --base-url https://example.org/musicfree/ --out dist
```

输出六个 JS、`plugins.json` 和规范化配置。只接受已实现的六组 `id/searchApi/detailApi`，未知函数拒绝生成；不执行远程 JSON 的任何代码。禁用的线路从本次生成清单中省略，不会替用户卸载已安装插件。调整接口实现后需升级 `lib/converter.cjs` 中版本并重新生成。

显式真网检查（默认单测完全离线）：

```bash
npm run probe -- --decode --report docs/smoke-current.json
```

`--decode` 额外需要 FFmpeg，只解码各首歌前 1 秒。检查结果不保存播放 URL、签名、票据或原始响应。克制访问第三方服务，避免批量高频调用。配置更新不会自动等于接口实现更新，也不在本工具中创建定时任务。

## 维护结构

- `build.cjs`：配置获取与产物写入。
- `lib/converter.cjs`：配置校验、函数白名单、插件与订阅打包。
- `lib/runtime.cjs`：MusicFree 协议、播放解析、请求头与失败边界。
- `adapters/*.cjs`：独立实现各平台公开请求与字段映射。
- `tests/*.test.cjs`：配置和协议回归测试。
- `probe.cjs`：主动启用的真网音频验证。

在 MusicFreeAndroid 仓库中，该工具位于 `tools/qingmusic-converter/`；对外发布使用相同内容作为独立仓库根目录。原生应用代码没有改动。
