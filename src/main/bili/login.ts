import axios from "axios";
import QRCode from "qrcode";
import { biliHeader, setCookie, getCookie, hasCookie } from "./headers";

/**
 * 扫码登录，复刻 dbili/modules/login.js。
 *
 * 与原库的区别：
 * - 原库起了一个本地 http 服务器（127.0.0.1:11451）用 qr-image 输出 PNG，需要用户手动开浏览器；
 *   这里直接把二维码生成 dataURL 通过 IPC 交给渲染层展示。
 * - 原库用 request 拿 set-cookie，这里用 axios（Node 环境下同样能读到 set-cookie 响应头）。
 */

const LOGIN_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.84 Safari/537.36",
  origin: "https://www.bilibili.com",
  referer: "https://www.bilibili.com",
};

/** 二维码有效期（秒），B站侧为 180 秒 */
const QR_EXPIRES_IN = 180;
const POLL_INTERVAL = 2000;

export interface BiliUser {
  mid: number;
  name: string;
  face: string;
  vip: boolean;
}

export interface LoginState {
  status: "pending" | "scanned" | "success" | "expired" | "error";
  /** 二维码图片 dataURL */
  qrcode?: string;
  user?: BiliUser | null;
  message?: string;
}

/** 请求登录二维码 key（对应原库的 get_oauth_key） */
const getOAuthKey = async (): Promise<{ key: string; content: string }> => {
  const res = await axios({
    url: "https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main_mini",
    headers: LOGIN_HEADERS,
  });
  if (res.data?.code !== 0 || !res.data?.data) {
    throw new Error(res.data?.message || "二维码生成失败");
  }
  const { url, qrcode_key } = res.data.data as {
    url?: string;
    qrcode_key: string;
  };
  return {
    key: qrcode_key,
    // 优先用接口返回的 url，与原库手工拼接的地址等价
    content:
      url ||
      `https://passport.bilibili.com/h5-app/passport/login/scan?&qrcode_key=${qrcode_key}&from=main_mini`,
  };
};

/** 把二维码内容渲染成 dataURL 供界面展示 */
const renderQrCode = (content: string): Promise<string> =>
  QRCode.toDataURL(content, {
    width: 260,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#111827", light: "#ffffff" },
  });

/** 从 set-cookie 响应头里提取 Cookie 字符串（对应原库的 cast_cookie_to_Str） */
const extractCookie = (setCookieHeader: unknown): string => {
  const list = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : typeof setCookieHeader === "string"
      ? [setCookieHeader]
      : [];
  return list
    .map((item) => item.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
};

type PollOutcome =
  | { status: "pending" }
  | { status: "scanned" }
  | { status: "expired" }
  | { status: "success"; cookie: string };

/** 轮询扫码结果（对应原库每 3 秒一次的轮询逻辑） */
const pollOnce = async (key: string): Promise<PollOutcome> => {
  const res = await axios({
    url: `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${key}&source=main_mini`,
    headers: LOGIN_HEADERS,
    validateStatus: () => true,
  });

  // 外层 code 表示请求本身是否成功，内层 data.code 才是扫码状态
  const stateCode = res.data?.data?.code;
  if (stateCode === 0) {
    return {
      status: "success",
      cookie: extractCookie(res.headers["set-cookie"]),
    };
  }
  if (stateCode === 86038) return { status: "expired" };
  if (stateCode === 86090) return { status: "scanned" };
  return { status: "pending" };
};

export interface NavResult {
  logged: boolean;
  user: BiliUser | null;
  /** 请求本身失败（如网络不通）时为 true，此时不能判定为「未登录」 */
  failed: boolean;
}

/** 查询当前登录用户信息，网络异常不抛错，交由调用方区分处理 */
export const fetchNavUser = async (): Promise<NavResult> => {
  try {
    const res = await axios.get(
      "https://api.bilibili.com/x/web-interface/nav",
      {
        headers: biliHeader,
        validateStatus: () => true,
      },
    );
    const data = res.data?.data;
    if (res.data?.code !== 0 || !data?.isLogin) {
      return { logged: false, user: null, failed: false };
    }
    return {
      logged: true,
      failed: false,
      user: {
        mid: data.mid,
        name: data.uname,
        face: data.face,
        vip: data.vipStatus === 1,
      },
    };
  } catch {
    return { logged: false, user: null, failed: true };
  }
};

/**
 * 一次扫码登录会话：生成二维码 -> 轮询 -> 成功回传 Cookie
 */
export class LoginSession {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private scanned = false;

  constructor(private readonly onUpdate: (state: LoginState) => void) {}

  async start(): Promise<void> {
    try {
      const { key, content } = await getOAuthKey();
      const qrcode = await renderQrCode(content);
      if (this.stopped) return;

      this.onUpdate({ status: "pending", qrcode });
      this.schedulePoll(key, Date.now() + QR_EXPIRES_IN * 1000);
    } catch (err) {
      this.onUpdate({ status: "error", message: (err as Error).message });
    }
  }

  private schedulePoll(key: string, deadline: number): void {
    this.timer = setInterval(async () => {
      if (this.stopped) return;
      if (Date.now() > deadline) {
        this.stopTimer();
        this.onUpdate({ status: "expired", message: "二维码已过期，请刷新" });
        return;
      }

      try {
        const outcome = await pollOnce(key);
        if (this.stopped) return;

        if (outcome.status === "expired") {
          this.stopTimer();
          this.onUpdate({ status: "expired", message: "二维码已过期，请刷新" });
          return;
        }
        if (outcome.status === "scanned") {
          if (!this.scanned) {
            this.scanned = true;
            this.onUpdate({
              status: "scanned",
              message: "已扫码，请在手机上确认",
            });
          }
          return;
        }
        if (outcome.status === "success") {
          this.stopTimer();
          setCookie(outcome.cookie);
          const nav = await fetchNavUser();
          this.onUpdate({ status: "success", user: nav.user });
        }
      } catch (err) {
        this.stopTimer();
        this.onUpdate({ status: "error", message: (err as Error).message });
      }
    }, POLL_INTERVAL);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  cancel(): void {
    this.stopped = true;
    this.stopTimer();
  }
}

export { getCookie, hasCookie, setCookie };
