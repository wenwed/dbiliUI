import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, VideoQueryPayload } from "../../main/ipc";
import type {
  BangumiEpisode,
  BangumiSearchItem,
  BangumiSeason,
} from "../../main/bili/bangumi";
import type { DownloadKind, DownloadTask } from "../../main/download-manager";
import type { LoginState } from "../../main/bili/login";
import BangumiCard from "./components/BangumiCard";
import BangumiResults from "./components/BangumiResults";
import DownloadList from "./components/DownloadList";
import SettingsModal from "./components/SettingsModal";
import TitleBar from "./components/TitleBar";
import VideoCard from "./components/VideoCard";
import {
  AlertIcon,
  BangumiIcon,
  SearchIcon,
  SpinnerIcon,
  VideoIcon,
} from "./components/Icons";
import { classNames } from "./utils";

/** 查询模式：单个视频 / 番剧 */
type QueryMode = "video" | "bangumi";

const PLACEHOLDER: Record<QueryMode, string> = {
  video: "输入 BV 号 / av 号 / 视频链接，例如 BV1MkbbzJEFx",
  bangumi: "输入番剧名称，例如 葬送的芙莉莲",
};

const HINT: Record<QueryMode, string> = {
  video: "支持 BV 号、av 号以及带 ?p=分P 的完整视频链接",
  bangumi: "按名称搜索番剧，选中后可勾选剧集批量下载；高清画质需要登录大会员",
};

const App = () => {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [mode, setMode] = useState<QueryMode>("video");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<VideoQueryPayload | null>(null);
  const [bangumiItems, setBangumiItems] = useState<BangumiSearchItem[] | null>(
    null,
  );
  const [season, setSeason] = useState<BangumiSeason | null>(null);
  const [loadingSeasonId, setLoadingSeasonId] = useState<number | null>(null);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginState, setLoginState] = useState<LoginState | null>(null);

  // 分P 切换需要重新查询，这里记住最近一次成功查询用的原始输入
  const lastQueryRef = useRef("");

  const refreshState = useCallback(async () => {
    setAppState(await window.api.getState());
  }, []);

  useEffect(() => {
    void refreshState();
    void window.api.listDownloads().then(setTasks);

    const offDownload = window.api.onDownloadUpdate((task) => {
      setTasks((previous) => {
        const index = previous.findIndex((item) => item.id === task.id);
        if (index === -1) return [task, ...previous];
        const next = [...previous];
        next[index] = task;
        return next;
      });
    });

    const offLogin = window.api.onLoginUpdate((state) => {
      setLoginState(state);
      if (state.status === "success") void refreshState();
    });

    const offReady = window.api.onAppReady(() => void refreshState());

    return () => {
      offDownload();
      offLogin();
      offReady();
    };
  }, [refreshState]);

  /** 查询单个视频（BV / av / 链接） */
  const runQuery = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value) {
      setError("请输入 BV 号、av 号或视频链接");
      return;
    }

    setQuerying(true);
    setError(null);
    try {
      const payload = await window.api.queryVideo(value);
      setResult(payload);
      lastQueryRef.current = value;
    } catch (err) {
      setResult(null);
      setError((err as Error)?.message ?? "查询失败");
    } finally {
      setQuerying(false);
    }
  }, []);

  /** 按名称搜索番剧 */
  const runBangumiSearch = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value) {
      setError("请输入番剧名称");
      return;
    }

    setQuerying(true);
    setError(null);
    try {
      setBangumiItems(await window.api.searchBangumi(value));
      setSeason(null);
    } catch (err) {
      setBangumiItems(null);
      setSeason(null);
      setError((err as Error)?.message ?? "搜索失败");
    } finally {
      setQuerying(false);
    }
  }, []);

  const handleSearch = useCallback(() => {
    if (mode === "bangumi") {
      void runBangumiSearch(input);
    } else {
      void runQuery(input);
    }
  }, [mode, input, runQuery, runBangumiSearch]);

  const handleSelectSeason = useCallback(async (item: BangumiSearchItem) => {
    setLoadingSeasonId(item.seasonId);
    setError(null);
    try {
      setSeason(await window.api.fetchSeason(item.seasonId));
    } catch (err) {
      setSeason(null);
      setError((err as Error)?.message ?? "番剧信息获取失败");
    } finally {
      setLoadingSeasonId(null);
    }
  }, []);

  const handleSelectPage = useCallback(
    (page: number) => {
      const bvid = result?.detail.bvid;
      if (!bvid) return;
      void runQuery(`${bvid}?p=${page}`);
    },
    [result, runQuery],
  );

  const handleQualityChange = useCallback(async (quality: number) => {
    setAppState(await window.api.updateConfig({ quality }));
  }, []);

  const handlePickFolder = useCallback(async () => {
    const next = await window.api.pickFolder();
    if (next) setAppState(next);
  }, []);

  const pushTask = useCallback((task: DownloadTask) => {
    setTasks((previous) =>
      previous.some((item) => item.id === task.id)
        ? previous
        : [task, ...previous],
    );
  }, []);

  const handleStartDownload = useCallback(
    async (kind: DownloadKind) => {
      if (!result || !appState) return;
      try {
        pushTask(
          await window.api.startDownload({
            kind: kind === "audio" ? "audio" : "video",
            target: result.target,
            quality: appState.config.quality,
            cover: result.detail.pic,
          }),
        );
      } catch (err) {
        setError((err as Error)?.message ?? "创建下载任务失败");
      }
    },
    [result, appState, pushTask],
  );

  const handleStartBangumiDownload = useCallback(
    async (episodes: BangumiEpisode[]) => {
      if (!season || !appState) return;
      try {
        pushTask(
          await window.api.startDownload({
            kind: "bangumi",
            bangumi: {
              seasonId: season.seasonId,
              title: season.title,
              cover: season.cover,
              referer: season.referer,
              episodes,
            },
            quality: appState.config.quality,
          }),
        );
      } catch (err) {
        setError((err as Error)?.message ?? "创建下载任务失败");
      }
    },
    [season, appState, pushTask],
  );

  const downloadDir = appState?.config.downloadDir ?? "";
  const busy = querying || loadingSeasonId !== null;

  return (
    <div className="app">
      <TitleBar
        user={appState?.config.user ?? null}
        logged={appState?.logged ?? false}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="content">
        <section className="search-panel">
          <div className="mode-tabs">
            <button
              type="button"
              className={classNames(
                "mode-tab",
                mode === "video" && "mode-tab--active",
              )}
              onClick={() => {
                setMode("video");
                setError(null);
              }}
            >
              <VideoIcon width={15} height={15} />
              视频下载
            </button>
            <button
              type="button"
              className={classNames(
                "mode-tab",
                mode === "bangumi" && "mode-tab--active",
              )}
              onClick={() => {
                setMode("bangumi");
                setError(null);
              }}
            >
              <BangumiIcon width={15} height={15} />
              番剧下载
            </button>
          </div>

          <div className="search-box">
            <span className="search-box__icon">
              <SearchIcon width={18} height={18} />
            </span>
            <input
              className="search-box__input"
              value={input}
              placeholder={PLACEHOLDER[mode]}
              spellCheck={false}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSearch();
              }}
            />
            <button
              type="button"
              className="button button--primary search-box__button"
              disabled={querying}
              onClick={handleSearch}
            >
              {querying ? (
                <SpinnerIcon className="spin" width={16} height={16} />
              ) : (
                <SearchIcon width={16} height={16} />
              )}
              {querying ? "查询中" : "查询"}
            </button>
          </div>
          <p className="search-panel__hint">{HINT[mode]}</p>
        </section>

        {error && (
          <div className="alert">
            <AlertIcon width={16} height={16} />
            <span>{error}</span>
            <button
              type="button"
              className="alert__close"
              onClick={() => setError(null)}
            >
              知道了
            </button>
          </div>
        )}

        {mode === "video" && result && appState && (
          <VideoCard
            result={result}
            qualities={appState.qualities}
            quality={appState.config.quality}
            downloadDir={downloadDir}
            busy={busy}
            onSelectPage={handleSelectPage}
            onQualityChange={handleQualityChange}
            onDownload={handleStartDownload}
            onChangeFolder={handlePickFolder}
          />
        )}

        {mode === "bangumi" && !season && bangumiItems && (
          <BangumiResults
            items={bangumiItems}
            loadingId={loadingSeasonId}
            onSelect={(item) => void handleSelectSeason(item)}
          />
        )}

        {mode === "bangumi" && season && appState && (
          <BangumiCard
            key={season.seasonId}
            season={season}
            qualities={appState.qualities}
            quality={appState.config.quality}
            downloadDir={downloadDir}
            busy={busy}
            onBack={() => setSeason(null)}
            onQualityChange={handleQualityChange}
            onDownload={(episodes) => void handleStartBangumiDownload(episodes)}
            onChangeFolder={handlePickFolder}
          />
        )}

        <DownloadList
          tasks={tasks}
          downloadDir={downloadDir}
          onCancel={(id) => void window.api.cancelDownload(id)}
          onRemove={(id) => {
            void window.api.removeDownload(id);
            setTasks((previous) => previous.filter((item) => item.id !== id));
          }}
          onShowItem={(path) => void window.api.showItem(path)}
          onOpenFolder={(path) => void window.api.openPath(path)}
        />
      </main>

      <SettingsModal
        open={settingsOpen}
        state={appState}
        loginState={loginState}
        onClose={() => setSettingsOpen(false)}
        onPickFolder={handlePickFolder}
        onOpenFolder={() => void window.api.openPath(downloadDir)}
        onQualityChange={handleQualityChange}
        onLogin={() => {
          setLoginState(null);
          void window.api.startLogin();
        }}
        onCancelLogin={() => {
          void window.api.cancelLogin();
          setLoginState(null);
        }}
        onLogout={async () => {
          setLoginState(null);
          setAppState(await window.api.logout());
        }}
      />
    </div>
  );
};

export default App;
