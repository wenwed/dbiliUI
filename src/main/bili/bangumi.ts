import axios from "axios";
import { biliHeader } from "./headers";
import { DEFAULT_QUALITY } from "./constants";
import type { DashStream } from "./video";
import { toHttps } from "../utils";

/* ------------------------------------------------------------------ *
 * 类型定义
 * ------------------------------------------------------------------ */

export interface BangumiSearchItem {
  seasonId: number;
  title: string;
  cover: string;
  /** 「全12话」 */
  indexShow: string;
  /** 「日本」 */
  areas: string;
  /** 「漫画改/音乐/日常」 */
  styles: string;
  /** 0 表示暂无评分 */
  score: number;
  scoreCount: number;
  /** 正片集数 */
  epSize: number;
  /** 「番剧」/「电影」/「纪录片」 */
  typeName: string;
  desc: string;
}

export interface BangumiEpisode {
  epId: number;
  cid: number;
  aid: number;
  bvid: string;
  /** 「第1话」 */
  title: string;
  /** 「第1话 冒险的结束」，适合直接当文件名 */
  showTitle: string;
  /** 秒 */
  duration: number;
  cover: string;
  /** 会员 / 付费等角标，非空说明有观看门槛 */
  badge: string;
}

export interface BangumiSeason {
  seasonId: number;
  title: string;
  cover: string;
  evaluate: string;
  score: number;
  areas: string;
  styles: string;
  typeName: string;
  /** 下载 CDN 流时必须带的 Referer */
  referer: string;
  episodes: BangumiEpisode[];
}

/** 渲染层选好剧集后提交给下载管理器的目标 */
export interface BangumiTarget {
  seasonId: number;
  title: string;
  cover: string;
  referer: string;
  episodes: BangumiEpisode[];
}

interface RawSearchItem {
  season_id?: number;
  title?: string;
  cover?: string;
  index_show?: string;
  areas?: string;
  styles?: string;
  ep_size?: number;
  season_type_name?: string;
  desc?: string;
  media_score?: { score?: number; user_count?: number };
}

interface RawEpisode {
  ep_id: number;
  cid: number;
  aid: number;
  bvid?: string;
  title?: string;
  show_title?: string;
  long_title?: string;
  /** 毫秒 */
  duration?: number;
  cover?: string;
  badge?: string;
}

interface RawSeason {
  season_id?: number;
  title?: string;
  cover?: string;
  evaluate?: string;
  areas?: Array<{ name?: string }>;
  styles?: string[];
  season_type_name?: string;
  rating?: { score?: number };
  episodes?: RawEpisode[];
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 搜索结果的标题 / 简介里带 <em class="keyword"> 高亮标签，要剥掉 */
const stripHtml = (text: string | undefined): string =>
  (text ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** 番剧页地址，既是接口 Referer 也是流下载 Referer */
export const bangumiReferer = (seasonId: number): string =>
  `https://www.bilibili.com/bangumi/play/ss${seasonId}`;

const mapEpisode = (raw: RawEpisode): BangumiEpisode => ({
  epId: raw.ep_id,
  cid: raw.cid,
  aid: raw.aid,
  bvid: raw.bvid ?? "",
  title: raw.title ?? "",
  showTitle: raw.show_title || raw.long_title || raw.title || `ep${raw.ep_id}`,
  duration: Math.round((raw.duration ?? 0) / 1000),
  cover: toHttps(raw.cover),
  badge: raw.badge ?? "",
});

/* ------------------------------------------------------------------ *
 * 搜索 / 详情
 * ------------------------------------------------------------------ */

/**
 * 按名称搜索番剧（对应原库的 get_bangumi_by_name）。
 *
 * 原库用 `x/web-interface/wbi/search/all/v2` 再去遍历 result 找 media_bangumi，
 * 这里换成 `wbi/search/type?search_type=media_bangumi`，直接拿到结构化结果。
 * 两个接口目前都不校验 wbi 签名，如果以后开始校验需要补 w_rid 签名逻辑。
 *
 * 原库的 bug：media_bangumi 为 null 时只 reject 却继续往下走，且末尾 `.catch` 只打日志，
 * 调用方会永远挂住；这里改成正常抛出。
 */
export const searchBangumi = async (
  keyword: string,
): Promise<BangumiSearchItem[]> => {
  const value = (keyword || "").trim();
  if (!value) {
    throw new Error("请输入番剧名称");
  }

  const res = await axios.get(
    `https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=media_bangumi` +
      `&keyword=${encodeURIComponent(value)}&page=1`,
    { headers: { ...biliHeader, referer: "https://www.bilibili.com" } },
  );

  const body = res.data;
  if (body.code !== 0 || !body.data) {
    throw new Error(body.message || "番剧搜索失败");
  }

  const items = (body.data.result ?? []) as RawSearchItem[];
  const list = items
    .filter((item) => item.season_id)
    .map((item) => ({
      seasonId: item.season_id as number,
      title: stripHtml(item.title),
      cover: toHttps(item.cover),
      indexShow: item.index_show ?? "",
      areas: item.areas ?? "",
      styles: item.styles ?? "",
      score: item.media_score?.score ?? 0,
      scoreCount: item.media_score?.user_count ?? 0,
      epSize: item.ep_size ?? 0,
      typeName: item.season_type_name ?? "番剧",
      desc: stripHtml(item.desc),
    }));

  if (list.length === 0) {
    throw new Error(`没有找到「${value}」相关的番剧`);
  }
  return list;
};

/** 拉取番剧详情与剧集列表 */
export const fetchSeason = async (seasonId: number): Promise<BangumiSeason> => {
  const res = await axios.get(
    `https://api.bilibili.com/pgc/view/web/season?season_id=${seasonId}`,
    { headers: { ...biliHeader, referer: "https://www.bilibili.com" } },
  );

  const body = res.data;
  if (body.code !== 0 || !body.result) {
    throw new Error(body.message || "番剧信息获取失败");
  }

  const result = body.result as RawSeason;
  const episodes = (result.episodes ?? []).map(mapEpisode);
  if (episodes.length === 0) {
    throw new Error("该番剧没有可下载的正片");
  }

  return {
    seasonId,
    title: result.title ?? "",
    cover: toHttps(result.cover),
    evaluate: result.evaluate ?? "",
    score: result.rating?.score ?? 0,
    areas: (result.areas ?? [])
      .map((area) => area.name ?? "")
      .filter(Boolean)
      .join(" / "),
    styles: (result.styles ?? []).join(" / "),
    typeName: result.season_type_name ?? "番剧",
    referer: bangumiReferer(seasonId),
    episodes,
  };
};

/* ------------------------------------------------------------------ *
 * 播放地址
 * ------------------------------------------------------------------ */

/**
 * 获取单集播放地址（对应原库的 download_one_ep 里的 playurl 调用）。
 * 番剧走的是 pgc 接口而不是 x/player/playurl，参数用 epid + cid。
 */
export const getEpisodePlayUrl = async (
  seasonId: number,
  episode: Pick<BangumiEpisode, "epId" | "cid">,
): Promise<{ video: DashStream[]; audio: DashStream[] }> => {
  const url =
    `https://api.bilibili.com/pgc/player/web/playurl?support_multi_audio=true` +
    `&qn=${DEFAULT_QUALITY}&fnver=0&epid=${episode.epId}&cid=${episode.cid}` +
    `&fnval=4048&fourk=1&gaia_source=&from_client=BROWSER&is_main_page=true&need_fragment=true`;

  const res = await axios.get(url, {
    headers: {
      ...biliHeader,
      origin: "https://www.bilibili.com",
      referer: bangumiReferer(seasonId),
    },
  });

  const body = res.data;
  if (body.code !== 0) {
    throw new Error(body.message || "获取剧集播放地址失败");
  }

  const dash = body.result?.dash;
  if (!dash) {
    throw new Error("该剧集暂不可下载，可能需要大会员或存在地区限制");
  }

  return dash as { video: DashStream[]; audio: DashStream[] };
};