import { useEffect, useState } from "react";
import type { BiliUser } from "../../../main/bili/login";
import {
  CloseIcon,
  MaximizeIcon,
  MinimizeIcon,
  RestoreIcon,
  SettingsIcon,
} from "./Icons";
import { classNames } from "../utils";

interface TitleBarProps {
  user: BiliUser | null;
  logged: boolean;
  onOpenSettings: () => void;
}

const TitleBar = ({ user, logged, onOpenSettings }: TitleBarProps) => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => window.api.onWindowState((state) => setMaximized(state.maximized)), []);

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4.5 4.5 2M17 4.5 19.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            <rect x="2.5" y="4.5" width="19" height="15" rx="4" />
            <path d="M10 10.5v5l4.5-2.5z" fill="#0f1117" />
          </svg>
        </span>
        <div className="titlebar__titles">
          <strong>BiliDownloader</strong>
          <span>B站视频 / 音频下载</span>
        </div>
      </div>

      <div className="titlebar__actions">
        <button
          type="button"
          className={classNames("account-chip", logged && "account-chip--active")}
          onClick={onOpenSettings}
          title={logged ? "账号设置" : "点击扫码登录"}
        >
          {logged && user?.face ? (
            <img className="account-chip__avatar" src={user.face} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="account-chip__dot" />
          )}
          <span className="account-chip__text">{logged ? (user?.name ?? "已登录") : "未登录"}</span>
        </button>

        <button type="button" className="icon-button" onClick={onOpenSettings} title="设置">
          <SettingsIcon />
        </button>

        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            onClick={() => void window.api.minimize()}
            title="最小化"
          >
            <MinimizeIcon width={15} height={15} />
          </button>
          <button
            type="button"
            className="window-control"
            onClick={() => void window.api.toggleMaximize()}
            title={maximized ? "还原" : "最大化"}
          >
            {maximized ? <RestoreIcon width={15} height={15} /> : <MaximizeIcon width={15} height={15} />}
          </button>
          <button
            type="button"
            className="window-control window-control--close"
            onClick={() => void window.api.close()}
            title="关闭"
          >
            <CloseIcon width={15} height={15} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default TitleBar;