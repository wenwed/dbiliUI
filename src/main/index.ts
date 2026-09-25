import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { registerIpc, restoreSession, setMainWindow } from "./ipc";
import { logger, logFilePath } from "./logger";

// 全局兜底：任何未捕获异常 / 未处理的 Promise 拒绝都落日志
process.on("uncaughtException", (err) => {
  logger.error("未捕获异常", err);
});
process.on("unhandledRejection", (reason) => {
  logger.error("未处理的 Promise 拒绝", reason);
});

const isDev = !app.isPackaged;
const rendererDevUrl = process.env["ELECTRON_RENDERER_URL"];

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    // 无边框窗口，标题栏由渲染层自绘
    frame: false,
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // 渲染进程崩溃也记录下来
  win.webContents.on("render-process-gone", (_event, details) => {
    logger.error(
      `渲染进程退出 reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });

  win.on("maximize", () =>
    win.webContents.send("window:state", { maximized: true }),
  );
  win.on("unmaximize", () =>
    win.webContents.send("window:state", { maximized: false }),
  );

  // 外部链接交给系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && rendererDevUrl) {
    void win.loadURL(rendererDevUrl);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return win;
};

app.whenReady().then(async () => {
  logger.info(`应用启动 v${app.getVersion()}（isDev=${isDev}）`);
  console.log(`[日志文件] ${logFilePath()}`);

  registerIpc();

  const win = createWindow();
  setMainWindow(win);

  win.on("closed", () => setMainWindow(null));

  // 恢复上次的 Cookie / 校验登录态（不阻塞窗口显示）
  void restoreSession().then(() => {
    if (!win.isDestroyed()) {
      win.webContents.send("app:ready");
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createWindow();
      setMainWindow(next);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
