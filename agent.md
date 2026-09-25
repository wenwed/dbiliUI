# agent.md

给 AI 编码助手看的项目说明。改代码前先读这份文件。

## 1. 这个项目是什么

B站视频 / 音频下载的桌面可视化工具（Electron）。核心下载能力移植自 dbili（Node 库），
在那个库外面套了一层 Electron 界面 + 下载任务管理。

当前范围：

- **单个视频**（BV 号 / av 号 / 链接）的视频流下载与音频下载
- **番剧**（按名称搜索 → 选剧集 → 批量下载，见第 8 节）

## 2. 技术栈

| 层     | 技术                                                              |
| ------ | ----------------------------------------------------------------- |
| 壳     | Electron 44（无边框窗口，标题栏自绘）                             |
| 构建   | electron-vite 5 + Vite 7                                          |
| 界面   | React 19 + TypeScript 5，手写 CSS（无 UI 框架）                   |
| 主进程 | axios 1.x / fluent-ffmpeg 2.x / @ffmpeg-installer/ffmpeg / qrcode |

> Vite 必须锁在 7.x：`electron-vite@5` 的 peer 是 `vite ^5||^6||^7`，装 Vite 8 会 ERESOLVE 失败。
> `@vitejs/plugin-react` 因此也必须用 5.x（6.x 要求 Vite 8）。

## 3. 常用命令

```bash
npm run dev        # 开发模式（Vite HMR + Electron）
npm run build      # 构建到 out/
npm run start      # 用构建产物启动
npm run typecheck  # tsc --noEmit
```

## 4. 目录结构

```
src/
├── main/                      Electron 主进程（下载全在这里跑）
│   ├── index.ts               入口：建窗口、注册 IPC、恢复登录态
│   ├── ipc.ts                 所有 ipcMain handler + 向前端推送事件
│   ├── store.ts               配置持久化（userData/config.json）
│   ├── download-manager.ts    下载任务队列、进度、速度、取消
│   ├── utils.ts               目录/文件名工具（清洗、去重、静默删除）
│   └── bili/                  ★ 从 dbili 移植过来的 B站能力
│       ├── constants.ts       清晰度 DEFINITION / QUALITY_OPTIONS
│       ├── headers.ts         请求头 + 全局 Cookie 状态
│       ├── video.ts           BV/AV 解析、视频信息、playurl、流下载、ffmpeg 合并
│       ├── bangumi.ts         番剧搜索、剧集列表、PGC playurl
│       ├── login.ts           扫码登录 + 查询登录用户
│       └── ffmpeg.ts          解析 ffmpeg 可执行文件路径
├── preload/index.ts           contextBridge 暴露 window.api
└── renderer/
    ├── index.html
    └── src/
        ├── App.tsx            状态与事件装配（视频 / 番剧两种查询模式）
        ├── global.d.ts        声明 window.api 类型
        ├── utils.ts           格式化工具
        ├── styles/global.css  全部样式（CSS 变量在 :root）
        └── components/        TitleBar / VideoCard / BangumiResults / BangumiCard
                               / DownloadList / SettingsModal / Cover / Icons
```

## 5. 约定

### 加一个 IPC 方法要改 4 个地方

1. `src/main/ipc.ts` — 写 `ipcMain.handle("域:动作", ...)`
2. `src/preload/index.ts` — 在 `api` 对象里包一层 `ipcRenderer.invoke`
3. `src/renderer/src/App.tsx`（或组件）— `await window.api.xxx()`
4. 类型：`AppState` 在 `ipc.ts`，任务类型在 `download-manager.ts`，前端用 `import type` 引

命名：通道名统一 `域:动作`（`config:get`、`download:start`、`bangumi:search`）。
主进程 → 渲染层的推送用 `webContents.send`，前端通过 `window.api.onXxx()` 订阅，返回取消订阅函数。

### 类型跨层引用

渲染层引用主进程类型**必须**用 `import type`（会被完全擦除，不会把 `electron` 打进前端 bundle）。

### 不要在 `src/preload/` 放 `index.d.ts`

同名 `.d.ts` 会被同名 `.ts` 遮蔽，`declare global` 不生效（踩过一次）。
全局声明放在 `src/renderer/src/global.d.ts`。

### 代码风格

仓库没有 `.prettierrc`，IDE 用 Prettier 默认配置在保存时格式化：
2 空格缩进、双引号、分号、**行宽 80（CJK 字符按 2 列计）**。
所以含中文的语句经常被压得很短就折行，写文件时请按这个宽度，否则会产生大量无意义的 diff。

### 注释

用中文。只在逻辑不直观的地方写（为什么这么做），不复述代码在做什么。

## 6. 关键实现细节 / 坑

这些点都是有原因才这么写的，改之前先理解：

1. **`index.js` 里不能硬编码 Cookie**
   原库 `dbili/index.js` 把某个人的 SESSDATA 写死在源码里。这里改成从 `store.ts` 读，
   由扫码登录写入并持久化到 `userData/config.json`。**不要把真实 Cookie 提交进仓库。**

2. **图片地址 http → https**
   B站接口常返回 `http://i1.hdslb.com/...`，渲染层 CSP 不允许 http 图片，会在 `queryVideo` 里统一升级为 https。

3. **Accept-Encoding 去掉了 `zstd`**
   axios 1.x 对 zstd 响应解码不可靠，保留 `gzip, deflate, br`。

4. **ffmpeg 路径是双保险**
   `bili/ffmpeg.ts` 先找 `@ffmpeg-installer/ffmpeg` 自带的二进制，找不到就降级用系统 PATH 里的 `ffmpeg`。
   它同时兼容 rollup 的 cjs interop（可能拿到 `{path}` 也可能是 `{default:{path}}`）。
   应用启动时 `restoreSession()` 会调用 `configureFfmpeg()`；设置面板里能看到实际用的路径。

5. **跨盘 rename 会炸**
   系统临时目录在 C 盘、下载目录可能在别的盘，`fs.renameSync` 会 EXDEV。
   所以 ffmpeg 的输出**直接写到下载目录**（`.名字.taskid.tmp.mp4`），再在同目录内改名。
   只有待合并的分片流放在系统临时目录。

6. **清晰度会降级而不是报错**
   原库 `get_clarity` 匹配不到就抛错，用户选 1080P 必失败。
   `pickVideoStream` 改为取「不高于请求值的最优清晰度」，并把 `note` 回传给界面提示。
   同清晰度有 avc1/hevc/av01 多个编码时**优先 avc1**（兼容性最好）。

7. **音频选轨**
   原库取 `audio[0]`，且把分片音频流直接改名成 `.mp3`（内容其实是 AAC/fMP4，部分播放器打不开）。
   现在 `pickAudioStream` 优先标准 AAC 轨（30280/30232/30216）中码率最高的，
   输出用 ffmpeg 重新封装成标准 `.m4a`。

8. **进度上报**
   `downloadStream` 同时挂 `on('data')` 和 `pipeline()`，这两步**必须同步执行**，
   否则数据可能在 pipeline 接管前就开始流动、丢字节。
   进度通过 `DownloadManager.dispatch` 节流到 250ms 一次，避免 IPC 被刷屏。

9. **取消下载**
   `AbortController` 的 signal 同时传给 axios（中止流）和 ffmpeg（`command.kill('SIGKILL')`）。
   任务状态、临时文件清理在 `DownloadManager.run` 的 `finally` 里统一处理。

10. **`window-all-closed` / 单例窗口**
    窗口引用通过 `setMainWindow` 注入给 `ipc.ts`，推送前会判 `isDestroyed()`。

11. **`toHttps` 在 `utils.ts`，不在 `video.ts`**
    `video.ts` 和 `bangumi.ts` 都要用（B站接口常返回 `http://i0.hdslb.com/...`），所以沉到了公共工具里。

12. **进度条「未知长度」的判断带了 `progress === 0`**
    `DownloadList` 里的 `indeterminate` 条件是 `total === 0 && progress === 0`。
    因为下载音频流前会 `resetSpeed`（把 received/total 清零），只看 `total === 0`
    会让本来有百分比的阶段退化成来回滚动的动画条。

## 7. 登录与权限

- 匿名状态下 playurl 只会返回低清晰度（实测某视频只给到 360P/480P）。
  **要 1080P 及以上必须登录**，会员视频还需要大会员账号。
  番剧同理：实测匿名请求 PGC playurl 时 `accept_quality` 里虽然列出 125/120/112/80，
  但 DASH 实际只给 32/16（480P/360P），选了更高的清晰度会自动降级并给出 `note` 提示。
  剧集列表里 `ep.badge` 非空（如「会员」）表示该集有观看门槛。
- 扫码登录复刻自 `dbili/modules/login.js`，但把原库的「起本地 HTTP 服务器 + 手动开浏览器看二维码」
  改成了「生成 dataURL 通过 IPC 给渲染层显示」。
- 登录成功后 Cookie 存进 `config.json`，启动时 `restoreSession()` 会拉一次 `/x/web-interface/nav` 校验；
  如果是明确未登录（不是网络失败）就清掉，避免界面误报已登录。
- `fetchNavUser` 返回 `{logged, user, failed}`，**`failed` 表示请求本身失败，此时不能判定为未登录**。

## 8. 番剧下载

原库参考是 `dbili/modules/bangumi.js`，这里重写成了 `src/main/bili/bangumi.ts` + 渲染层的
模式切换，**顺手修掉了原库的三个问题**：

| 原库的问题                                        | 现在的做法                                                 |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `media_bangumi === null` 时只 reject 却继续往下走 | 抛错直接返回                                               |
| 末尾 `.catch` 只 `console.log`，调用方永远挂住    | 错误正常向上抛                                             |
| 匿名态没有提示，只会抛「权限不足」                | 区分网络失败 / 无 DASH / 区域限制，把接口 message 透给界面 |

### 接口

- 搜索：`x/web-interface/wbi/search/type?search_type=media_bangumi&keyword=`。
  比原库的 `search/all/v2`（要遍历 result 找 `media_bangumi`）直接得多。
  **注意：这个 wbi 接口目前不校验签名**，如果哪天返回 -403 了，需要补 `w_rid` + `wts` 签名。
- 详情：`pgc/view/web/season?season_id=`，`result.episodes` 是正片。
- 播放地址：`pgc/player/web/playurl?...&epid=&cid=&fnval=4048&fourk=1`，
  返回的是 `result.dash`（视频 playurl 返回的是 `data.dash`，**两者结构不同，别抄错**）。
  番剧页 Referer 必须带：`https://www.bilibili.com/bangumi/play/ss{seasonId}`。

### 下载模型

- `DownloadKind` 是 `"video" | "audio" | "bangumi"`；
  `StartDownloadRequest` 是**判别联合**，`kind: "bangumi"` 时带 `bangumi: BangumiTarget`。
- 番剧是**一个任务跑多集**（不是一集一个任务），`DownloadManager.runBangumi` 里顺序循环：
  - 进度：`100 / 集数` 摊给每一集，单集内部 视频流 55% / 音频流 27% / 合并 18%
    （常量 `EP_VIDEO_SHARE` / `EP_AUDIO_SHARE`）。
  - `stage` 文案形如 `3/12 · 下载视频流 · 1080P`，界面上的 `${percent}%` 由进度条承担。
  - 产物放在下载目录下以番剧名命名的子目录，文件名用 `ep.showTitle`（如「第1话 冒险的结束」）。
  - 每集合并完立刻删掉该集的 `.m4s` 分片，避免一个 28 集任务把临时目录撑爆。
  - `signal.throwIfAborted()` 放在每集开头，所以上一集结束后取消也能正确停下。
- `DownloadTask` 多了 `episodeCount` / `doneEpisodes`，界面据此显示 `3/28 集`、完成后显示「28 集」

### 界面

- 搜索框上方有「视频下载 / 番剧下载」两个 tab，共用同一个输入框（`App.tsx` 的 `mode`）。
- 搜索 → `BangumiResults`（候选卡片列表）→ 点选 → `BangumiCard`（封面 + 剧集多选 + 清晰度）
  → 「下载选中 N 集」。`BangumiCard` 用 `key={season.seasonId}` 挂载，换番剧时自动重置勾选。
- 番剧任务在下载列表里的角标用金色（`.task__kind--bangumi`），与视频/音频区分。

## 9. 自我验证方式（改完代码怎么确认没坏）

这个项目没有测试框架。改动下载逻辑后，推荐这样验证：

```bash
npm run typecheck && npm run build
```

想跑真实的端到端下载，用 esbuild 把 `src/main/bili/video.ts` 打成 cjs 在 node 里直接调
（`--external:axios --external:fluent-ffmpeg --external:@ffmpeg-installer/ffmpeg`），
调 `queryVideo` → `getDownloadUrl` → `pickVideoStream`/`pickAudioStream` → `downloadStream` → `mergeStreams`。

想验证界面，可以写一个临时 Electron 脚本 `require("../out/main/index.js")`，
用 `win.webContents.executeJavaScript()` 驱动 DOM 并 `capturePage()` 截图。

驱动 React 的输入框要绕一下：直接改 `input.value` 不会触发 React 的 onChange，得用原生
setter + `dispatchEvent(new Event("input", { bubbles: true }))`：

```js
const setter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  "value",
).set;
setter.call(input, "葬送的芙莉莲");
input.dispatchEvent(new Event("input", { bubbles: true }));
```

番剧的完整链路可以这样一把过：切 `.mode-tab` → 填关键词 → 点 `.search-box__button`
→ 等 `.bangumi-item` → 点第一个 → 等 `.chip-row--episodes .chip`
→ 点 `.field__actions` 里的「清空」再点第一个 chip（**否则会真的下完 28 集**）
→ 点 `.video-card__buttons .button--primary` → 等 `.task--done`。
