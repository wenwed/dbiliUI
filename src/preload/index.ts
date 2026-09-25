import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppState, VideoQueryPayload } from "../main/ipc";
import type {
  BangumiSearchItem,
  BangumiSeason,
  BangumiTarget,
} from "../main/bili/bangumi";
import type {
  DownloadKind,
  DownloadTask,
  StartDownloadRequest,
} from "../main/download-manager";
import type { LoginState } from "../main/bili/login";
import type { QualityOption } from "../main/bili/constants";
import type { AppConfig } from "../main/store";

export type { AppState, VideoQueryPayload, DownloadTask, StartDownloadRequest };
export type { DownloadKind, LoginState, QualityOption, AppConfig };
export type { BangumiSearchItem, BangumiSeason, BangumiTarget };

/** 订阅主进程推送，返回取消订阅函数 */
const subscribe = <T>(
  channel: string,
  callback: (payload: T) => void,
): (() => void) => {
  const listener = (_event: IpcRendererEvent, payload: T): void =>
    callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const api = {
  /* 应用状态与配置 */
  getState: (): Promise<AppState> => ipcRenderer.invoke("config:get"),
  updateConfig: (patch: Partial<AppConfig>): Promise<AppState> =>
    ipcRenderer.invoke("config:update", patch),

  /* 目录与系统 */
  pickFolder: (): Promise<AppState | null> =>
    ipcRenderer.invoke("dialog:pick-folder"),
  openPath: (target: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-path", target),
  showItem: (target: string): Promise<void> =>
    ipcRenderer.invoke("shell:show-item", target),

  /* 视频查询 */
  queryVideo: (input: string): Promise<VideoQueryPayload> =>
    ipcRenderer.invoke("video:query", input),

  /* 番剧查询 */
  searchBangumi: (keyword: string): Promise<BangumiSearchItem[]> =>
    ipcRenderer.invoke("bangumi:search", keyword),
  fetchSeason: (seasonId: number): Promise<BangumiSeason> =>
    ipcRenderer.invoke("bangumi:season", seasonId),

  /* 下载 */
  listDownloads: (): Promise<DownloadTask[]> =>
    ipcRenderer.invoke("download:list"),
  startDownload: (request: StartDownloadRequest): Promise<DownloadTask> =>
    ipcRenderer.invoke("download:start", request),
  cancelDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke("download:cancel", id),
  removeDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke("download:remove", id),

  /* 扫码登录 */
  startLogin: (): Promise<void> => ipcRenderer.invoke("login:start"),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke("login:cancel"),
  logout: (): Promise<AppState> => ipcRenderer.invoke("login:logout"),

  /* 窗口控制 */
  minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: (): Promise<boolean> =>
    ipcRenderer.invoke("window:toggle-maximize"),
  close: (): Promise<void> => ipcRenderer.invoke("window:close"),

  /* 主进程事件 */
  onDownloadUpdate: (callback: (task: DownloadTask) => void): (() => void) =>
    subscribe("download:update", callback),
  onLoginUpdate: (callback: (state: LoginState) => void): (() => void) =>
    subscribe("login:update", callback),
  onWindowState: (
    callback: (state: { maximized: boolean }) => void,
  ): (() => void) => subscribe("window:state", callback),
  onAppReady: (callback: () => void): (() => void) =>
    subscribe("app:ready", callback),
};

export type PreloadApi = typeof api;

contextBridge.exposeInMainWorld("api", api);
