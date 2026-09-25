import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import ffmpeg from "fluent-ffmpeg";
import { biliHeader, streamHeaders } from "./headers";
import { DEFAULT_QUALITY, DEFINITION } from "./constants";
import { logger } from "../logger";
import { ensureDir, removeFileQuietly, toHttps } from "../utils";

/* ------------------------------------------------------------------ *
 * 类型定义
 * ------------------------------------------------------------------ */

export interface VideoPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

export interface VideoDetail {
  bvid: string;
  aid: number;
  title: string;
  pic: string;
  desc: string;
  duration: number;
  pubdate: number;
  tname: string;
  owner: { mid: number; name: string; face: string };
  stat: {
    view: number;
    danmaku: number;
    reply: number;
    favorite: number;
    coin: number;
    like: number;
    share: number;
  };
  videos: number;
  pages: VideoPage[];
}

export interface ParsedVideoId {
  type: "bv" | "av";
  id: string;
  /** 链接里 ?p= 指定的分P，没有则为 undefined */
  page?: number;
}

export interface DownloadTarget {
  bvid: string;
  aid: number;
  cid: number;
  page: number;
  part: string;
  /** 完成后的文件名（已清洗非法字符，不含扩展名） */
  name: string;
  /** 下载 CDN 流时必须带的 Referer */
  referer: string;
}

export interface DashStream {
  id: number;
  baseUrl?: string;
  base_url?: string;
  bandwidth: number;
  codecs?: string;
  mimeType?: string;
}

export interface StreamProgress {
  received: number;
  total: number;
}

export interface StreamOptions {
  referer?: string;
  signal?: AbortSignal;
  onProgress?: (progress: StreamProgress) => void;
}

/* ------------------------------------------------------------------ *
 * BV / AV 号解析
 * ------------------------------------------------------------------ */

const BV_PATTERN = /BV[0-9A-Za-z]{10}/;
const AV_PATTERN = /\bav(\d{1,20})/i;
const PAGE_PATTERN = /[?&]p=(\d+)/i;

/**
 * 解析用户输入：支持 BV 号、av 号、以及完整的 B 站视频链接
 * 对应原库的 is_av_or_Bv，但额外支持直接粘贴链接
 */
export const parseVideoInput = (raw: string): ParsedVideoId => {
  const input = (raw || "").trim();
  if (!input) {
    throw new Error("请输入 BV 号、av 号或视频链接");
  }

  const pageMatch = input.match(PAGE_PATTERN);
  const page = pageMatch ? Number(pageMatch[1]) : undefined;

  const bvMatch = input.match(BV_PATTERN);
  if (bvMatch) {
    return { type: "bv", id: bvMatch[0], page };
  }

  const avMatch = input.match(AV_PATTERN);
  if (avMatch) {
    return { type: "av", id: `av${avMatch[1]}`, page };
  }

  throw new Error("无法识别的视频号，请输入 BV 号、av 号或 B 站视频链接");
};

/** 截取 av 号中的数字（对应原库的 cut_av_id） */
const cutAvId = (avId: string): string => {
  const matched = avId.match(/[0-9]+/);
  if (!matched) throw new Error("av 号格式不正确");
  return matched[0];
};

/* ------------------------------------------------------------------ *
 * 视频信息 / 播放地址
 * ------------------------------------------------------------------ */

/**
 * 拉取视频详情（对应原库的 get_video_info，但返回完整元信息供界面展示）
 */
export const fetchVideoDetail = async (
  parsed: ParsedVideoId,
): Promise<VideoDetail> => {
  const query =
    parsed.type === "bv" ? `bvid=${parsed.id}` : `aid=${cutAvId(parsed.id)}`;
  const res = await axios.get(
    `https://api.bilibili.com/x/web-interface/view?${query}`,
    {
      headers: biliHeader,
    },
  );

  const body = res.data;
  if (body.code !== 0 || !body.data) {
    throw new Error(body.message || "视频信息获取失败");
  }
  return body.data as VideoDetail;
};

/** 汇总查询结果，交给渲染层展示 */
export interface VideoQueryResult {
  detail: VideoDetail;
  /** 当前选中的分P（从 1 开始） */
  page: number;
  cid: number;
  pageTitle: string;
  /** 当前分P的时长（秒） */
  pageDuration: number;
}

export const queryVideo = async (raw: string): Promise<VideoQueryResult> => {
  const parsed = parseVideoInput(raw);
  const detail = await fetchVideoDetail(parsed);

  const page = Math.min(Math.max(parsed.page ?? 1, 1), detail.videos);
  const target = detail.pages[page - 1];
  if (!target) {
    throw new Error("该视频没有这个分P");
  }

  detail.pic = toHttps(detail.pic);
  detail.owner.face = toHttps(detail.owner.face);

  return {
    detail,
    page,
    cid: target.cid,
    pageTitle:
      detail.videos > 1 ? `第${page}分P · ${target.part}` : detail.title,
    pageDuration: target.duration,
  };
};

/**
 * 把查询结果转成下载目标
 * 对应原库 get_video_info 里拼接标题的逻辑
 */
export const buildTarget = (result: VideoQueryResult): DownloadTarget => {
  const { detail, page, cid, pageDuration } = result;
  const part = detail.pages[page - 1]?.part ?? detail.title;
  const name =
    detail.videos > 1 ? `${detail.title}-第${page}分P-${part}` : detail.title;

  return {
    bvid: detail.bvid,
    aid: detail.aid,
    cid,
    page,
    part,
    name,
    referer: `https://www.bilibili.com/video/${detail.bvid}`,
  };
};

/**
 * 获取播放地址（对应原库的 get_download_url）
 * 相比原库使用 fnval=4048 以拿到 DASH + 高码率 / 杜比音轨
 */
export const getDownloadUrl = async (
  target: Pick<DownloadTarget, "aid" | "cid">,
) => {
  const url =
    `https://api.bilibili.com/x/player/playurl?avid=${target.aid}&cid=${target.cid}` +
    `&qn=${DEFAULT_QUALITY}&fnval=4048&fnver=0&fourk=1`;

  const res = await axios.get(url, { headers: biliHeader });
  const body = res.data;
  if (body.code !== 0 || !body.data) {
    throw new Error(body.message || "获取播放地址失败");
  }
  if (!body.data.dash) {
    throw new Error("该视频不支持 DASH 格式，无法下载");
  }
  return body.data as { dash: { video: DashStream[]; audio: DashStream[] } };
};

/* ------------------------------------------------------------------ *
 * 流选择
 * ------------------------------------------------------------------ */

const streamUrl = (stream: DashStream): string => {
  const url = stream.baseUrl || stream.base_url;
  if (!url) throw new Error("清晰度地址为空");
  return url;
};

export interface PickedVideo {
  url: string;
  /** 实际拿到的清晰度 id（可能因无权限低于请求值） */
  actualId: number;
  requestedId: number;
}

/**
 * 按清晰度挑选视频流。
 * 原库的 get_clarity 匹配不到就直接抛错，这里改为降级到「不高于请求值的最优清晰度」，
 * 并把实际清晰度回传给界面提示，避免用户选了 1080P 就必然失败。
 */
export const pickVideoStream = (
  videoStreams: DashStream[],
  definitionId: number = DEFAULT_QUALITY,
): PickedVideo => {
  const byQuality = new Map<number, DashStream>();
  for (const stream of videoStreams) {
    const current = byQuality.get(stream.id);
    // 同清晰度可能有 avc1 / hevc / av01 多个编码，优先 avc1 兼容性最好
    if (
      !current ||
      (!(current.codecs || "").startsWith("avc1") &&
        (stream.codecs || "").startsWith("avc1"))
    ) {
      byQuality.set(stream.id, stream);
    }
  }

  const available = [...byQuality.keys()].sort((a, b) => b - a);
  if (available.length === 0) {
    throw new Error("没有可用的视频流");
  }

  const exact = byQuality.get(definitionId);
  if (exact) {
    return {
      url: streamUrl(exact),
      actualId: definitionId,
      requestedId: definitionId,
    };
  }

  // 降级：取不高于请求值的最优清晰度；若请求值低于所有可用值则取最低的
  const fallback =
    available.find((id) => id <= definitionId) ??
    available[available.length - 1];
  const stream = byQuality.get(fallback);
  if (!stream) {
    throw new Error("此视频没有对应的清晰度，如果是会员专属视频请先登录后重试");
  }
  return {
    url: streamUrl(stream),
    actualId: fallback,
    requestedId: definitionId,
  };
};

export interface PickedAudio {
  url: string;
  id: number;
  bandwidth: number;
}

/**
 * 挑选音频流。
 * 原库直接取 audio[0]，这里优先标准 AAC 音轨中码率最高的（杜比 / FLAC 封装进 mp4 兼容性差）
 */
export const pickAudioStream = (audioStreams: DashStream[]): PickedAudio => {
  if (!audioStreams || audioStreams.length === 0) {
    throw new Error("没有可用的音频流");
  }
  const standardIds = [30280, 30232, 30216];
  let chosen: DashStream | undefined;
  for (const id of standardIds) {
    const matched = audioStreams.filter((stream) => stream.id === id);
    if (matched.length > 0) {
      chosen = matched.sort((a, b) => b.bandwidth - a.bandwidth)[0];
      break;
    }
  }
  if (!chosen) {
    chosen = [...audioStreams].sort((a, b) => b.bandwidth - a.bandwidth)[0];
  }
  return { url: streamUrl(chosen), id: chosen.id, bandwidth: chosen.bandwidth };
};

/** 清晰度 id -> 展示文案 */
export const qualityLabel = (id: number): string => {
  const entry = Object.entries(DEFINITION).find(([, value]) => value === id);
  return entry ? entry[0] : `${id}`;
};

/* ------------------------------------------------------------------ *
 * 流下载 / 合并
 * ------------------------------------------------------------------ */

/**
 * 下载一条流到本地文件，支持进度回调与取消。
 * 原库用 res.data.pipe(writer)，错误处理不完整；这里改用 stream/promises 的 pipeline，
 * 出错时会自动销毁两端流，避免句柄泄漏。
 */
export const downloadStream = async (
  url: string,
  filePath: string,
  options: StreamOptions = {},
): Promise<string> => {
  ensureDir(path.dirname(filePath));
  removeFileQuietly(filePath);

  let res;
  try {
    res = await axios({
      url,
      method: "get",
      responseType: "stream",
      headers: streamHeaders(options.referer),
      signal: options.signal,
      maxRedirects: 5,
    });
  } catch (err) {
    // CDN 拒绝（403）、超时等在这这里最容易发生，补上 HTTP 状态码再上抛
    const status = (err as { response?: { status?: number } }).response?.status;
    logger.error(
      `下载流请求失败 url=${url} -> ${filePath}${status ? ` HTTP ${status}` : ""}`,
      err,
    );
    throw new Error(
      `下载流失败${status ? `（HTTP ${status}）` : ""}：${(err as Error)?.message ?? String(err)}`,
    );
  }

  const total = Number(res.headers["content-length"] || 0);
  logger.info(
    `开始下载流 ${filePath}（${total > 0 ? `${total} 字节` : "长度未知"}）`,
  );
  let received = 0;

  // 注意：下面两步必须同步执行，否则数据可能在 pipeline 接管前就开始流动
  const stream = res.data;
  stream.on("data", (chunk: Buffer) => {
    received += chunk.length;
    options.onProgress?.({ received, total });
  });

  try {
    await pipeline(stream, fs.createWriteStream(filePath));
  } catch (err) {
    logger.error(
      `流下载中断 ${filePath}（已接收 ${received}/${total} 字节）`,
      err,
    );
    removeFileQuietly(filePath);
    throw err;
  }

  logger.info(`流下载完成 ${filePath}（${received} 字节）`);
  return filePath;
};

/**
 * 跑一条 ffmpeg 命令，支持进度回调、错误上抛，以及 signal 触发的进程终止
 */
const runFfmpeg = (
  build: () => ReturnType<typeof ffmpeg>,
  outputPath: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (percent: number) => void;
    failMessage: string;
  },
): Promise<string> => {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(outputPath));
    removeFileQuietly(outputPath);

    const command = build();
    let settled = false;
    // 保留 ffmpeg 输出的末尾若干行，出错时是最关键的排查信息
    const stderrTail: string[] = [];

    const onAbort = (): void => {
      if (settled) return;
      command.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = (): void => {
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
    };

    command
      .on("stderr", (line: string) => {
        stderrTail.push(line);
        if (stderrTail.length > 50) stderrTail.shift();
      })
      .on("progress", (progress) => options.onProgress?.(progress.percent ?? 0))
      .on("end", () => {
        if (settled) return;
        cleanup();
        logger.info(`ffmpeg 完成 ${outputPath}`);
        resolve(outputPath);
      })
      .on("error", (err) => {
        if (settled) return;
        cleanup();
        const tail = stderrTail.slice(-15).join("\n");
        logger.error(
          `ffmpeg 失败 ${outputPath}（${options.failMessage}）`,
          err,
        );
        if (tail) logger.error(`ffmpeg 输出末尾：\n${tail}`);
        const tailHint = stderrTail.slice(-3).join(" | ");
        reject(
          new Error(
            options.signal?.aborted
              ? "已取消"
              : `${options.failMessage}：${err.message}${tailHint ? `（${tailHint}）` : ""}`,
          ),
        );
      })
      .save(outputPath);
  });
};

/** 合并视频流与音频流（对应原库的 marge_stream） */
export const mergeStreams = (
  videoPath: string,
  audioPath: string,
  outputPath: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (percent: number) => void;
  } = {},
): Promise<string> =>
  runFfmpeg(
    () =>
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions([
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c",
          "copy",
          "-movflags",
          "+faststart",
        ]),
    outputPath,
    { ...options, failMessage: "音视频合并失败" },
  );

/**
 * 把 DASH 音频流重新封装成标准 m4a。
 * 原库直接把分片音频流改名成 .mp3，文件内容其实是 AAC/fMP4，部分播放器会打不开。
 */
export const remuxAudio = (
  inputPath: string,
  outputPath: string,
  options: { signal?: AbortSignal } = {},
): Promise<string> =>
  runFfmpeg(
    () =>
      ffmpeg(inputPath).outputOptions([
        "-vn",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
      ]),
    outputPath,
    { ...options, failMessage: "音频转封装失败" },
  );
