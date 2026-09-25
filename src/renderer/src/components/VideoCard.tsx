import { useState } from "react";
import type { VideoQueryPayload } from "../../../main/ipc";
import type { QualityOption } from "../../../main/bili/constants";
import type { DownloadKind } from "../../../main/download-manager";
import Cover from "./Cover";
import {
  ClockIcon,
  FolderIcon,
  MusicIcon,
  SpinnerIcon,
  VideoIcon,
} from "./Icons";
import { classNames, formatCount, formatDate, formatDuration } from "../utils";

interface VideoCardProps {
  result: VideoQueryPayload;
  qualities: QualityOption[];
  quality: number;
  downloadDir: string;
  busy: boolean;
  onSelectPage: (page: number) => void;
  onQualityChange: (quality: number) => void;
  onDownload: (kind: DownloadKind) => void;
  onChangeFolder: () => void;
}

const VideoCard = ({
  result,
  qualities,
  quality,
  downloadDir,
  busy,
  onSelectPage,
  onQualityChange,
  onDownload,
  onChangeFolder,
}: VideoCardProps) => {
  const { detail, page, pageDuration } = result;
  const [descExpanded, setDescExpanded] = useState(false);

  const stats = [
    { label: "播放", value: formatCount(detail.stat.view) },
    { label: "弹幕", value: formatCount(detail.stat.danmaku) },
    { label: "点赞", value: formatCount(detail.stat.like) },
    { label: "收藏", value: formatCount(detail.stat.favorite) },
  ];

  return (
    <section className="card video-card">
      <div className="video-card__head">
        <Cover src={detail.pic} alt={detail.title} />

        <div className="video-card__meta">
          <h1 className="video-card__title" title={detail.title}>
            {detail.title}
          </h1>

          <div className="video-card__owner">
            <img
              className="avatar"
              src={detail.owner.face}
              alt=""
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
            <span className="video-card__owner-name">{detail.owner.name}</span>
            <span className="tag">{detail.tname}</span>
            <span className="video-card__bvid">{detail.bvid}</span>
          </div>

          <div className="video-card__stats">
            {stats.map((item) => (
              <span key={item.label}>
                {item.label} <b>{item.value}</b>
              </span>
            ))}
            <span>
              时长 <b>{formatDuration(detail.duration)}</b>
            </span>
            <span>{formatDate(detail.pubdate)}</span>
          </div>

          {detail.desc && (
            <p
              className={classNames(
                "video-card__desc",
                descExpanded && "video-card__desc--open",
              )}
              onClick={() => setDescExpanded((value) => !value)}
              title={descExpanded ? "点击收起" : "点击展开"}
            >
              {detail.desc}
            </p>
          )}
        </div>
      </div>

      {detail.videos > 1 && (
        <div className="field">
          <div className="field__label">
            分P 选择
            <span className="field__hint">共 {detail.videos} P</span>
          </div>
          <div className="chip-row">
            {detail.pages.map((item) => (
              <button
                type="button"
                key={item.cid}
                className={classNames(
                  "chip",
                  item.page === page && "chip--active",
                )}
                onClick={() => onSelectPage(item.page)}
                title={item.part}
              >
                <span className="chip__index">P{item.page}</span>
                <span className="chip__text">
                  {item.part || `第 ${item.page} 集`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <div className="field__label">
          清晰度
          <span className="field__hint">高清晰度需要登录大会员账号</span>
        </div>
        <div className="chip-row">
          {qualities.map((item) => (
            <button
              type="button"
              key={item.id}
              className={classNames(
                "chip chip--quality",
                quality === item.id && "chip--active",
              )}
              onClick={() => onQualityChange(item.id)}
            >
              {item.label}
              {item.vip && <span className="chip__vip">VIP</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="video-card__actions">
        <div className="video-card__buttons">
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => onDownload("video")}
          >
            {busy ? (
              <SpinnerIcon className="spin" width={17} height={17} />
            ) : (
              <VideoIcon width={17} height={17} />
            )}
            下载视频
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => onDownload("audio")}
          >
            <MusicIcon width={17} height={17} />
            下载音频
          </button>
        </div>

        <div className="video-card__summary">
          <ClockIcon width={14} height={14} />
          当前分P {formatDuration(pageDuration)}
        </div>
      </div>

      <button
        type="button"
        className="folder-bar"
        onClick={onChangeFolder}
        title="点击更改下载文件夹"
      >
        <FolderIcon width={15} height={15} />
        <span className="folder-bar__path">{downloadDir}</span>
        <span className="folder-bar__action">更改</span>
      </button>
    </section>
  );
};

export default VideoCard;
