import fs from "node:fs";
import path from "node:path";
import { getEpisodePlayUrl, type BangumiTarget } from "./bili/bangumi";
import {
  downloadStream,
  getDownloadUrl,
  mergeStreams,
  pickAudioStream,
  pickVideoStream,
  qualityLabel,
  remuxAudio,
  type DownloadTarget,
  type StreamProgress,
} from "./bili/video";
import {
  ensureDir,
  removeFileQuietly,
  sanitizeFileName,
  uniqueFilePath,
} from "./utils";
import { logger } from "./logger";

/** 下载类型：视频（含音轨合成）/ 纯音频 / 番剧（多集批量） */
export type DownloadKind = "video" | "audio" | "bangumi";

export type TaskStatus =
  | "pending"
  | "downloading"
  | "merging"
  | "done"
  | "error"
  | "cancelled";

export interface DownloadTask {
  id: string;
  kind: DownloadKind;
  /** 展示用标题 */
  title: string;
  cover?: string;
  quality: number;
  status: TaskStatus;
  /** 当前阶段文案，如「下载视频流 · 720P」 */
  stage: string;
  /** 总进度 0-100 */
  progress: number;
  /** 当前阶段已接收字节 / 总字节，total 为 0 表示长度未知 */
  received: number;
  total: number;
  /** 字节/秒 */
  speed: number;
  /** 附加提示，例如清晰度自动降级 */
  note?: string;
  /** 番剧任务：总集数与已完成集数 */
  episodeCount?: number;
  doneEpisodes?: number;
  outputPath?: string;
  error?: string;
  createdAt: number;
}

/** 渲染层发起下载时提交的参数 */
export type StartDownloadRequest =
  | {
      kind: "video" | "audio";
      target: DownloadTarget;
      quality: number;
      cover?: string;
    }
  | {
      kind: "bangumi";
      bangumi: BangumiTarget;
      quality: number;
    };

export interface DownloadContext {
  downloadDir: string;
  tempDir: string;
}

/** 各阶段的进度区间：下载视频流 / 下载音频流 / 合并 */
const RANGE_VIDEO_VIDEO: [number, number] = [0, 65];
const RANGE_VIDEO_AUDIO: [number, number] = [65, 90];
const RANGE_AUDIO_ONLY: [number, number] = [0, 85];

/** 单集内部 视频流 / 音频流 / 合并 各占的比例，三段加起来是 1 */
const EP_VIDEO_SHARE = 0.55;
const EP_AUDIO_SHARE = 0.27;

/** 进度事件的最小发送间隔，避免 IPC 被高频进度刷屏 */
const EMIT_INTERVAL = 250;

interface SpeedSample {
  bytes: number;
  at: number;
  speed: number;
}

/**
 * 下载任务管理器。
 * 所有下载都在主进程执行，进度通过回调推给渲染层。
 */
export class DownloadManager {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly speedSamples = new Map<string, SpeedSample>();
  private readonly lastEmitAt = new Map<string, number>();
  private sequence = 0;

  constructor(private readonly emit: (task: DownloadTask) => void) {}

  /** 任务列表，新任务在前 */
  list(): DownloadTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 创建任务并立即开始执行 */
  start(request: StartDownloadRequest, context: DownloadContext): DownloadTask {
    this.sequence += 1;
    const isBangumi = request.kind === "bangumi";

    const task: DownloadTask = {
      id: `task-${Date.now()}-${this.sequence}`,
      kind: request.kind,
      title: isBangumi ? request.bangumi.title : request.target.name,
      cover: isBangumi ? request.bangumi.cover || undefined : request.cover,
      quality: request.quality,
      status: "pending",
      stage: "准备中",
      progress: 0,
      received: 0,
      total: 0,
      speed: 0,
      episodeCount: isBangumi ? request.bangumi.episodes.length : undefined,
      doneEpisodes: isBangumi ? 0 : undefined,
      createdAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    logger.info(
      `创建任务 ${task.id} kind=${request.kind} quality=${request.quality} 标题=${task.title}`,
    );
    this.dispatch(task, true);

    void this.run(task, request, context);
    return task;
  }

  /** 取消任务：中止流下载并杀掉 ffmpeg 子进程 */
  cancel(id: string): void {
    logger.info(`请求取消任务 ${id}`);
    this.controllers.get(id)?.abort();
  }

  /** 从列表移除已结束的任务 */
  remove(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (
      task.status === "downloading" ||
      task.status === "merging" ||
      task.status === "pending"
    ) {
      this.cancel(id);
      return;
    }
    this.tasks.delete(id);
    this.lastEmitAt.delete(id);
    this.speedSamples.delete(id);
  }

  private async run(
    task: DownloadTask,
    request: StartDownloadRequest,
    context: DownloadContext,
  ): Promise<void> {
    const controller = new AbortController();
    const signal = controller.signal;
    this.controllers.set(task.id, controller);

    ensureDir(context.tempDir);
    ensureDir(context.downloadDir);

    // 待合并的分片流都登记在这里，无论成功失败都在 finally 里统一清理
    const tempFiles: string[] = [];

    try {
      if (request.kind === "bangumi") {
        const bangumi = request.bangumi;
        await this.runBangumi(
          task,
          bangumi,
          request.quality,
          context,
          signal,
          tempFiles,
        );
      } else {
        await this.runSingle(task, request, context, signal, tempFiles);
      }
    } catch (err) {
      if (signal.aborted) {
        logger.info(`任务已取消 ${task.id} ${task.title}`);
        this.patch(
          task.id,
          { status: "cancelled", stage: "已取消", speed: 0 },
          true,
        );
      } else {
        // 记录完整堆栈，界面上只能看到 message
        logger.error(`任务失败 ${task.id} ${task.title}`, err);
        this.patch(
          task.id,
          {
            status: "error",
            stage: "下载失败",
            speed: 0,
            error: (err as Error)?.message ?? String(err),
          },
          true,
        );
      }
    } finally {
      tempFiles.forEach((file) => removeFileQuietly(file));
      this.controllers.delete(task.id);
      this.speedSamples.delete(task.id);
    }
  }

  /** 单个视频 / 纯音频的下载流程 */
  private async runSingle(
    task: DownloadTask,
    request: Extract<StartDownloadRequest, { kind: "video" | "audio" }>,
    context: DownloadContext,
    signal: AbortSignal,
    tempFiles: string[],
  ): Promise<void> {
    const { target } = request;
    const baseName = sanitizeFileName(target.name);
    const videoTemp = path.join(context.tempDir, `${task.id}-video.m4s`);
    const audioTemp = path.join(context.tempDir, `${task.id}-audio.m4s`);
    tempFiles.push(videoTemp, audioTemp);
    let stagedOutput: string | undefined;

    try {
      this.patch(
        task.id,
        { status: "downloading", stage: "获取播放地址" },
        true,
      );

      const playInfo = await getDownloadUrl(target);
      const audio = pickAudioStream(playInfo.dash.audio);

      if (request.kind === "video") {
        const picked = pickVideoStream(playInfo.dash.video, request.quality);
        const note =
          picked.actualId === picked.requestedId
            ? undefined
            : `未获取到 ${qualityLabel(picked.requestedId)}，已自动使用 ${qualityLabel(picked.actualId)}`;

        this.patch(
          task.id,
          { note, stage: `下载视频流 · ${qualityLabel(picked.actualId)}` },
          true,
        );
        this.resetSpeed(task.id);
        await downloadStream(picked.url, videoTemp, {
          referer: target.referer,
          signal,
          onProgress: (progress) =>
            this.reportStream(task.id, progress, ...RANGE_VIDEO_VIDEO),
        });

        this.patch(task.id, { stage: "下载音频流" }, true);
        this.resetSpeed(task.id);
        await downloadStream(audio.url, audioTemp, {
          referer: target.referer,
          signal,
          onProgress: (progress) =>
            this.reportStream(task.id, progress, ...RANGE_VIDEO_AUDIO),
        });

        this.patch(
          task.id,
          { status: "merging", stage: "合并音视频", progress: 90, speed: 0 },
          true,
        );
        stagedOutput = path.join(
          context.downloadDir,
          `.${baseName}.${task.id}.tmp.mp4`,
        );
        await mergeStreams(videoTemp, audioTemp, stagedOutput, {
          signal,
          onProgress: (percent) =>
            this.patch(task.id, {
              progress: 90 + Math.min(percent, 100) * 0.1,
            }),
        });

        // 同目录内改名，避免临时目录与下载目录跨盘导致 EXDEV
        const finalPath = uniqueFilePath(context.downloadDir, baseName, ".mp4");
        fs.renameSync(stagedOutput, finalPath);
        stagedOutput = undefined;
        this.finish(task.id, finalPath);
      } else {
        this.patch(task.id, { stage: "下载音频流" }, true);
        this.resetSpeed(task.id);
        await downloadStream(audio.url, audioTemp, {
          referer: target.referer,
          signal,
          onProgress: (progress) =>
            this.reportStream(task.id, progress, ...RANGE_AUDIO_ONLY),
        });

        this.patch(
          task.id,
          { status: "merging", stage: "转封装为 m4a", progress: 85, speed: 0 },
          true,
        );
        stagedOutput = path.join(
          context.downloadDir,
          `.${baseName}.${task.id}.tmp.m4a`,
        );
        await remuxAudio(audioTemp, stagedOutput, { signal });

        const finalPath = uniqueFilePath(context.downloadDir, baseName, ".m4a");
        fs.renameSync(stagedOutput, finalPath);
        stagedOutput = undefined;
        this.finish(task.id, finalPath);
      }
    } finally {
      removeFileQuietly(stagedOutput);
    }
  }

  /**
   * 番剧批量下载：一个任务按顺序跑完选中的每一集，产物放在以番剧名命名的子目录里。
   * 进度按「已完成集数」摊到 0-100，单集内部再细分给视频流 / 音频流 / 合并。
   */
  private async runBangumi(
    task: DownloadTask,
    bangumi: BangumiTarget,
    quality: number,
    context: DownloadContext,
    signal: AbortSignal,
    tempFiles: string[],
  ): Promise<void> {
    const episodes = bangumi.episodes;
    const episodeCount = episodes.length;
    const folder = path.join(
      context.downloadDir,
      sanitizeFileName(bangumi.title),
    );
    ensureDir(folder);

    const slice = 100 / episodeCount;
    let lastOutput: string | undefined;

    for (let index = 0; index < episodeCount; index += 1) {
      // 上一集结束后被取消就停在这里，由 run() 统一标成已取消
      signal.throwIfAborted();

      const episode = episodes[index];
      const from = index * slice;
      const label = `${index + 1}/${episodeCount}`;

      this.patch(
        task.id,
        {
          status: "downloading",
          stage: `${label} · 获取播放地址`,
          note: undefined,
          progress: from,
          received: 0,
          total: 0,
          speed: 0,
        },
        true,
      );

      const playInfo = await getEpisodePlayUrl(bangumi.seasonId, episode);
      const picked = pickVideoStream(playInfo.video, quality);
      const audio = pickAudioStream(playInfo.audio);

      const videoTemp = path.join(
        context.tempDir,
        `${task.id}-${index}-video.m4s`,
      );
      const audioTemp = path.join(
        context.tempDir,
        `${task.id}-${index}-audio.m4s`,
      );
      tempFiles.push(videoTemp, audioTemp);

      const note =
        picked.actualId === picked.requestedId
          ? undefined
          : `${episode.showTitle} 未获取到 ${qualityLabel(picked.requestedId)}，已自动使用 ${qualityLabel(picked.actualId)}`;

      this.patch(
        task.id,
        {
          note,
          stage: `${label} · 下载视频流 · ${qualityLabel(picked.actualId)}`,
        },
        true,
      );
      this.resetSpeed(task.id);
      await downloadStream(picked.url, videoTemp, {
        referer: bangumi.referer,
        signal,
        onProgress: (progress) =>
          this.reportStream(
            task.id,
            progress,
            from,
            from + slice * EP_VIDEO_SHARE,
          ),
      });

      this.patch(task.id, { stage: `${label} · 下载音频流` }, true);
      this.resetSpeed(task.id);
      await downloadStream(audio.url, audioTemp, {
        referer: bangumi.referer,
        signal,
        onProgress: (progress) =>
          this.reportStream(
            task.id,
            progress,
            from + slice * EP_VIDEO_SHARE,
            from + slice * (EP_VIDEO_SHARE + EP_AUDIO_SHARE),
          ),
      });

      const mergedAt = from + slice * (EP_VIDEO_SHARE + EP_AUDIO_SHARE);
      const mergedTo = from + slice;
      this.patch(
        task.id,
        {
          status: "merging",
          stage: `${label} · 合并音视频`,
          progress: mergedAt,
          speed: 0,
        },
        true,
      );

      const baseName = sanitizeFileName(
        episode.showTitle || `第${index + 1}集`,
      );
      const staged = path.join(folder, `.${baseName}.${task.id}.tmp.mp4`);
      try {
        await mergeStreams(videoTemp, audioTemp, staged, {
          signal,
          onProgress: (percent) =>
            this.patch(task.id, {
              progress:
                mergedAt +
                (Math.min(percent, 100) / 100) * (mergedTo - mergedAt),
            }),
        });
        const finalPath = uniqueFilePath(folder, baseName, ".mp4");
        fs.renameSync(staged, finalPath);
        lastOutput = finalPath;
      } finally {
        removeFileQuietly(staged);
      }

      // 这一集合并完就不再需要分片，及时删掉，避免整个任务占满临时目录
      removeFileQuietly(videoTemp);
      removeFileQuietly(audioTemp);

      this.patch(
        task.id,
        {
          status: "downloading",
          progress: from + slice,
          doneEpisodes: index + 1,
        },
        true,
      );
    }

    this.finish(task.id, lastOutput);
  }

  private finish(id: string, outputPath?: string): void {
    logger.info(`任务完成 ${id} -> ${outputPath ?? "(未知路径)"}`);
    this.patch(
      id,
      { status: "done", stage: "已完成", progress: 100, speed: 0, outputPath },
      true,
    );
  }

  /** 按字节数换算进度并更新速度 */
  private reportStream(
    id: string,
    progress: StreamProgress,
    from: number,
    to: number,
  ): void {
    const task = this.tasks.get(id);
    if (!task) return;

    const ratio =
      progress.total > 0 ? Math.min(progress.received / progress.total, 1) : 0;
    task.received = progress.received;
    task.total = progress.total;
    task.progress = from + ratio * (to - from);
    this.updateSpeed(id, progress.received);
    this.dispatch(task);
  }

  private resetSpeed(id: string): void {
    this.speedSamples.delete(id);
    this.patch(id, { received: 0, total: 0, speed: 0 });
  }

  private updateSpeed(id: string, bytes: number): void {
    const now = Date.now();
    const previous = this.speedSamples.get(id);
    if (!previous) {
      this.speedSamples.set(id, { bytes, at: now, speed: 0 });
      return;
    }
    const elapsed = (now - previous.at) / 1000;
    if (elapsed < 0.4) return;

    const speed = (bytes - previous.bytes) / elapsed;
    const task = this.tasks.get(id);
    if (task) task.speed = speed > 0 ? speed : 0;
    this.speedSamples.set(id, { bytes, at: now, speed: task?.speed ?? 0 });
  }

  private patch(
    id: string,
    changes: Partial<DownloadTask>,
    force = false,
  ): void {
    const task = this.tasks.get(id);
    if (!task) return;
    Object.assign(task, changes);
    this.dispatch(task, force);
  }

  private dispatch(task: DownloadTask, force = false): void {
    const now = Date.now();
    const last = this.lastEmitAt.get(task.id) ?? 0;
    if (!force && now - last < EMIT_INTERVAL) return;
    this.lastEmitAt.set(task.id, now);
    this.emit({ ...task });
  }
}
