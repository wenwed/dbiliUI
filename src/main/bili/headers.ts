/**
 * 全局请求头与 Cookie 状态。
 * 对应 dbili/index.js 里的 global.dBiliHeader / global.dBiliCookie / global.dBiliHasCookie。
 *
 * 与原库的区别：原库把某个人的 SESSDATA 硬编码在源码里，这里改为空白，
 * 由扫码登录或设置面板写入并持久化到本地配置文件。
 */

export const biliHeader: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "zh-CN,zh;q=0.9,zh-TW;q=0.8",
  "Cache-Control": "max-age=0",
  "Sec-Ch-Ua":
    '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
};

let cookie = "";

/** 读取当前 Cookie 字符串 */
export const getCookie = (): string => cookie;

/** 当前是否已登录（有 Cookie） */
export const hasCookie = (): boolean => cookie.length > 0;

/** 写入 / 清空 Cookie，同时同步到全局请求头 */
export const setCookie = (value: string): void => {
  cookie = value || "";
  if (cookie) {
    biliHeader.cookie = cookie;
  } else {
    delete biliHeader.cookie;
  }
};

/**
 * 构造下载 CDN 流时需要的请求头（必须带 Referer，否则 403）
 * @param referer 视频页地址
 */
export const streamHeaders = (referer?: string): Record<string, string> => {
  const headers: Record<string, string> = { ...biliHeader };
  headers.Origin = "https://www.bilibili.com";
  if (referer) {
    headers.Referer = referer;
  }
  return headers;
};
