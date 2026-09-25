import { useEffect } from "react";
import type { AppState } from "../../../main/ipc";
import type { LoginState } from "../../../main/bili/login";
import {
  CloseIcon,
  FolderIcon,
  ExternalIcon,
  LogoutIcon,
  RefreshIcon,
  SpinnerIcon,
} from "./Icons";
import { classNames } from "../utils";

interface SettingsModalProps {
  open: boolean;
  state: AppState | null;
  loginState: LoginState | null;
  onClose: () => void;
  onPickFolder: () => void;
  onOpenFolder: () => void;
  onQualityChange: (quality: number) => void;
  onLogin: () => void;
  onCancelLogin: () => void;
  onLogout: () => void;
}

const LOGIN_STATUS_TEXT: Record<LoginState["status"], string> = {
  pending: "请使用 B站手机客户端扫码",
  scanned: "已扫码，请在手机上确认登录",
  success: "登录成功",
  expired: "二维码已过期，请点击刷新",
  error: "登录失败，请重试",
};

const SettingsModal = ({
  open,
  state,
  loginState,
  onClose,
  onPickFolder,
  onOpenFolder,
  onQualityChange,
  onLogin,
  onCancelLogin,
  onLogout,
}: SettingsModalProps) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !state) return null;

  const { config, qualities, logged, ffmpegPath } = state;
  const user = config.user;
  const loginBusy = loginState?.status === "pending" || loginState?.status === "scanned";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal__head">
          <h2>设置</h2>
          <button type="button" className="icon-button icon-button--small" onClick={onClose} title="关闭">
            <CloseIcon width={16} height={16} />
          </button>
        </header>

        <div className="modal__body">
          <section className="settings-group">
            <h3>下载文件夹</h3>
            <p className="settings-group__hint">配置会持久化保存在本地，重启应用后依然生效</p>
            <div className="path-box">
              <FolderIcon width={15} height={15} />
              <span className="path-box__text" title={config.downloadDir}>
                {config.downloadDir}
              </span>
            </div>
            <div className="settings-group__actions">
              <button type="button" className="button button--ghost button--small" onClick={onPickFolder}>
                选择文件夹
              </button>
              <button type="button" className="button button--ghost button--small" onClick={onOpenFolder}>
                <ExternalIcon width={14} height={14} />
                打开目录
              </button>
            </div>
          </section>

          <section className="settings-group">
            <h3>默认清晰度</h3>
            <p className="settings-group__hint">1080P 及以上清晰度通常需要登录大会员账号</p>
            <div className="chip-row">
              {qualities.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={classNames("chip", "chip--quality", config.quality === item.id && "chip--active")}
                  onClick={() => onQualityChange(item.id)}
                >
                  {item.label}
                  {item.vip && <span className="chip__vip">VIP</span>}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <h3>账号</h3>
            {logged ? (
              <div className="account-row">
                {user?.face ? (
                  <img className="avatar avatar--large" src={user.face} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="avatar avatar--large avatar--fallback" />
                )}
                <div className="account-row__info">
                  <strong>{user?.name ?? "已登录"}</strong>
                  <span>
                    {user?.vip ? "大会员" : "普通账号"}
                    {user?.mid ? ` · UID ${user.mid}` : ""}
                  </span>
                </div>
                <button type="button" className="button button--ghost button--small" onClick={onLogout}>
                  <LogoutIcon width={14} height={14} />
                  退出登录
                </button>
              </div>
            ) : (
              <div className="login-panel">
                {loginState?.qrcode && loginBusy ? (
                  <div className="qr-box">
                    <img className="qr-box__image" src={loginState.qrcode} alt="登录二维码" />
                  </div>
                ) : null}

                <div className="login-panel__side">
                  <p className="login-panel__status">
                    {loginState ? LOGIN_STATUS_TEXT[loginState.status] : "登录后可下载 1080P+ 与会员专享内容"}
                  </p>
                  {loginState?.status === "success" ? (
                    <p className="login-panel__ok">已成功登录，Cookie 已保存</p>
                  ) : (
                    <div className="login-panel__actions">
                      <button type="button" className="button button--primary button--small" onClick={onLogin}>
                        {loginBusy ? <SpinnerIcon className="spin" width={15} height={15} /> : <RefreshIcon width={15} height={15} />}
                        {loginState?.qrcode ? "刷新二维码" : "扫码登录"}
                      </button>
                      {loginBusy && (
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          onClick={onCancelLogin}
                        >
                          取消
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="settings-group settings-group--footer">
            <h3>运行环境</h3>
            <div className="kv">
              <span>ffmpeg</span>
              <code title={ffmpegPath}>{ffmpegPath}</code>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;