import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { fetchSeason, searchBangumi } from "./bili/bangumi";
import { QUALITY_OPTIONS, type QualityOption } from "./bili/constants";
import { configureFfmpeg, getFfmpegPath } from "./bili/ffmpeg";
import { getCookie, setCookie } from "./bili/headers";
import { LoginSession, fetchNavUser, type LoginState } from "./bili/login";
import { buildTarget, queryVideo, type VideoQueryResult } from "./bili/video";
import {
  DownloadManager,
  type DownloadContext,
  type DownloadTask,
  type StartDownloadRequest,
} from "./download-manager";
import { logger } from "./logger";
import { getConfig, getTempDir, updateConfig, type AppConfig } from "./store";

let mainWindow: BrowserWindow | null = null;

/** 包装 ipcMain.handle：handler 抛错先落日志（含堆栈）再抛回渲染层 */
const handle = (
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
): void => {
  ipcMain.handle(channel, async (event, ...args: any[]) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      logger.error(`IPC ${channel} 处理失败`, err);
      throw err;
    }
  });
};

/** 由主入口注入窗口引用，用于向渲染层推送事件 */
export const setMainWindow = (win: BrowserWindow | null): void => {
  mainWindow = win;
};

const send = (channel: string, payload: unknown): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
};

/** 渲染层需要的整体状态 */
export interface AppState {
  config: AppConfig;
  qualities: QualityOption[];
  logged: boolean;
  ffmpegPath: string;
}

const buildAppState = (): AppState => ({
  config: getConfig(),
  qualities: QUALITY_OPTIONS,
  logged: Boolean(getCookie()),
  ffmpegPath: getFfmpegPath(),
});

/** 查询结果 + 下载目标，一起回给渲染层 */
export interface VideoQueryPayload extends VideoQueryResult {
  target: ReturnType<typeof buildTarget>;
}

const downloadManager = new DownloadManager((task: DownloadTask) => {
  send("download:update", task);
});

let loginSession: LoginSession | null = null;

const stopLoginSession = (): void => {
  loginSession?.cancel();
  loginSession = null;
};

/** 启动时恢复上次的登录态 */
export const restoreSession = async (): Promise<void> => {
  configureFfmpeg();
  logger.info(`ffmpeg: ${getFfmpegPath()}`);

  const config = getConfig();
  if (!config.cookie) return;

  setCookie(config.cookie);
  try {
    const nav = await fetchNavUser();
    if (nav.logged) {
      updateConfig({ user: nav.user });
    } else if (!nav.failed) {
      // Cookie 已失效（非网络问题），清掉避免界面误报已登录
      logger.info("Cookie 已失效，清除登录态");
      setCookie("");
      updateConfig({ cookie: "", user: null });
    }
  } catch (err) {
    logger.error("恢复登录态失败", err);
  }
};

export const registerIpc = (): void => {
  /* ---------------- 配置 ---------------- */

  handle("config:get", () => buildAppState());

  handle("config:update", (_event, patch: Partial<AppConfig>) => {
    updateConfig(patch);
    return buildAppState();
  });

  /* ---------------- 目录 / 系统 ---------------- */

  handle("dialog:pick-folder", async () => {
    const current = getConfig().downloadDir;
    const result = await dialog.showOpenDialog({
      title: "选择下载文件夹",
      defaultPath: current,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    updateConfig({ downloadDir: result.filePaths[0] });
    return buildAppState();
  });

  handle("shell:open-path", async (_event, target: string) => {
    if (!target) return;
    await shell.openPath(target);
  });

  handle("shell:show-item", (_event, target: string) => {
    if (target) shell.showItemInFolder(target);
  });

  /* ---------------- 视频查询 ---------------- */

  handle(
    "video:query",
    async (_event, input: string): Promise<VideoQueryPayload> => {
      const result = await queryVideo(input);
      return { ...result, target: buildTarget(result) };
    },
  );

  /* ---------------- 番剧查询 ---------------- */

  handle("bangumi:search", (_event, keyword: string) => searchBangumi(keyword));

  handle("bangumi:season", (_event, seasonId: number) => fetchSeason(seasonId));

  /* ---------------- 下载 ---------------- */

  handle("download:list", () => downloadManager.list());

  handle("download:start", (_event, request: StartDownloadRequest) => {
    const context: DownloadContext = {
      downloadDir: getConfig().downloadDir,
      tempDir: getTempDir(),
    };
    return downloadManager.start(request, context);
  });

  handle("download:cancel", (_event, id: string) => {
    downloadManager.cancel(id);
  });

  handle("download:remove", (_event, id: string) => {
    downloadManager.remove(id);
  });

  /* ---------------- 扫码登录 ---------------- */

  handle("login:start", () => {
    stopLoginSession();

    const session = new LoginSession((state: LoginState) => {
      if (state.status === "success") {
        updateConfig({ cookie: getCookie(), user: state.user ?? null });
        loginSession = null;
      }
      send("login:update", state);
    });

    loginSession = session;
    void session.start();
  });

  handle("login:cancel", () => {
    stopLoginSession();
  });

  handle("login:logout", () => {
    stopLoginSession();
    setCookie("");
    updateConfig({ cookie: "", user: null });
    return buildAppState();
  });

  /* ---------------- 窗口控制（无边框窗口自绘按钮） ---------------- */

  handle("window:minimize", () => {
    mainWindow?.minimize();
  });

  handle("window:toggle-maximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }
    mainWindow.maximize();
    return true;
  });

  handle("window:close", () => {
    mainWindow?.close();
  });
};
