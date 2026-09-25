import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * 轻量文件日志。
 * 写到 <userData>/logs/bili-downloader.log，同时镜像到控制台。
 * 目录懒解析：优先 userData，失败则退到系统临时目录，日志本身永不抛错。
 */

type Level = "debug" | "info" | "warn" | "error";

let resolved = false;
let logFile = "";

const resolveLogFile = (): void => {
  if (resolved) return;
  resolved = true;

  const candidates: string[] = [];
  try {
    candidates.push(path.join(app.getPath("userData"), "logs"));
  } catch {
    /* app 未就绪等场景，尝试下一个候选 */
  }
  candidates.push(path.join(app.getPath("temp"), "bili-downloader-logs"));

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, "bili-downloader.log");
      return;
    } catch {
      /* 换下一个目录 */
    }
  }
};

export const formatError = (err: unknown): string =>
  err instanceof Error ? (err.stack ?? err.message) : String(err);

const write = (level: Level, message: string): void => {
  resolveLogFile();
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  try {
    if (logFile) {
      fs.appendFileSync(logFile, `${line}\n`, "utf-8");
    }
  } catch {
    /* 日志写入失败不影响主流程 */
  }

  // 控制台同步输出，开发期直接可见
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export const logger = {
  debug: (message: string): void => write("debug", message),
  info: (message: string): void => write("info", message),
  warn: (message: string): void => write("warn", message),
  /** err 传入原始异常，记录完整堆栈 */
  error: (message: string, err?: unknown): void =>
    write("error", err ? `${message}\n${formatError(err)}` : message),
};

/** 当前日志文件路径，用于界面或控制台提示 */
export const logFilePath = (): string => {
  resolveLogFile();
  return logFile;
};
