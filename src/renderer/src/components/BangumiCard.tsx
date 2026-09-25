import { useState } from "react";
import type {
  BangumiEpisode,
  BangumiSeason,
} from "../../../main/bili/bangumi";
import type { QualityOption } from "../../../main/bili/constants";
import Cover from "./Cover";
import {
  BangumiIcon,
  CheckIcon,
  ClockIcon,
  FolderIcon,
  SpinnerIcon,
} from "./Icons";
import { classNames, formatDuration } from "../utils";

interface BangumiCardProps {
  season: BangumiSeason;
  qualities: QualityOption[];
  quality: number;
  downloadDir: string;
  busy: boolean;
  onBack: () => void;
  onQualityChange: (quality: number) => void;
  onDownload: (episodes: BangumiEpisode[]) => void;
  onChangeFolder: () => void;
}

const BangumiCard = ({
  season,
  qualities,
  quality,
  downloadDir,
  busy,
  onBack,
  onQualityChange,
  onDownload,
  onChangeFolder,
}: BangumiCardProps) => {
  const { episodes } = season;
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(episodes.map((episode) => episode.epId)),
  );

  const toggle = (epId: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(epId)) {
        next.delete(epId);
      } else {
        next.add(epId);
      }
      return next;
    });
  };

  const chosen = episodes.filter((episode) => selected.has(episode.epId));
  const totalDuration = chosen.reduce(
    (total, episode) => total + episode.duration,
    0,
  );

  return (
    <section className="card video-card">
      <div className="video-card__head">
        <Cover
          src={season.cover}
          alt={season.title}
          fallback={<BangumiIcon width={34} height={34} />}
        />

        <div className="video-card__meta">
          <h1 className="video-card__title" title={season.title}>
            {season.title}
          </h1>

          <div className="video-card__owner">
            {season.score > 0 && (
              <span className="bangumi-item__score">
                {season.score.toFixed(1)}
              </span>
            )}
            <span className="tag">{season.typeName}</span>
            {season.areas && <span className="tag">{season.areas}</span>}
            {season.styles && <span className="tag">{season.styles}</span>}
            <span className="video-card__bvid">共 {episodes.length} 集</span>
          </div>

          {season.evaluate && (
            <p className="video-card__desc video-card__desc--open">
              {season.evaluate}
            </p>
          )}
        </div>
      </div>

      <div className="field">
        <div className="field__label">
          剧集选择
          <span className="field__hint">
            已选 {chosen.length}/{episodes.length} 集 · {formatDuration(totalDuration)}
          </span>
          <span className="field__actions">
            <button
              type="button"
              className="link-button"
              onClick={() =>
                setSelected(new Set(episodes.map((episode) => episode.epId)))
              }
            >
              全选
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => setSelected(new Set())}
            >
              清空
            </button>
          </span>
        </div>

        <div className="chip-row chip-row--episodes">
          {episodes.map((episode) => {
            const active = selected.has(episode.epId);
            return (
              <button
                type="button"
                key={episode.epId}
                className={classNames("chip", active && "chip--active")}
                title={episode.showTitle}
                onClick={() => toggle(episode.epId)}
              >
                {active && <CheckIcon width={12} height={12} />}
                <span className="chip__text">{episode.showTitle}</span>
                {episode.badge && (
                  <span className="chip__vip">{episode.badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <div className="field__label">
          清晰度
          <span className="field__hint">番剧高清晰度需要大会员账号</span>
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
            disabled={busy || chosen.length === 0}
            onClick={() => onDownload(chosen)}
          >
            {busy ? (
              <SpinnerIcon className="spin" width={17} height={17} />
            ) : (
              <BangumiIcon width={17} height={17} />
            )}
            下载选中 {chosen.length} 集
          </button>
          <button type="button" className="button button--ghost" onClick={onBack}>
            返回搜索
          </button>
        </div>

        <div className="video-card__summary">
          <ClockIcon width={14} height={14} />
          每集约 {formatDuration(episodes[0]?.duration ?? 0)}
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

export default BangumiCard;