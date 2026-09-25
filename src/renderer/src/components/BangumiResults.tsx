import type { BangumiSearchItem } from "../../../main/bili/bangumi";
import Cover from "./Cover";
import { BangumiIcon, SpinnerIcon } from "./Icons";

interface BangumiResultsProps {
  items: BangumiSearchItem[];
  /** 正在加载详情的那一项 */
  loadingId: number | null;
  onSelect: (item: BangumiSearchItem) => void;
}

const BangumiResults = ({
  items,
  loadingId,
  onSelect,
}: BangumiResultsProps) => (
  <section className="card bangumi-results">
    <div className="bangumi-results__head">
      <h2>
        搜索结果
        <span className="badge">{items.length}</span>
      </h2>
      <span className="bangumi-results__hint">点选一部番剧查看剧集</span>
    </div>

    <div className="bangumi-results__grid">
      {items.map((item) => (
        <button
          type="button"
          key={item.seasonId}
          className="bangumi-item"
          disabled={loadingId !== null}
          onClick={() => onSelect(item)}
        >
          <Cover
            className="bangumi-item__cover"
            src={item.cover}
            alt={item.title}
            fallback={<BangumiIcon width={30} height={30} />}
          />

          <div className="bangumi-item__meta">
            <span className="bangumi-item__title" title={item.title}>
              {item.title}
            </span>

            <span className="bangumi-item__tags">
              {item.score > 0 && (
                <span className="bangumi-item__score">
                  {item.score.toFixed(1)}
                </span>
              )}
              <span className="tag">{item.typeName}</span>
              {item.indexShow && <span className="tag">{item.indexShow}</span>}
            </span>

            <span className="bangumi-item__sub">
              {[item.areas, item.styles].filter(Boolean).join(" · ")}
            </span>

            {item.desc && <span className="bangumi-item__desc">{item.desc}</span>}
          </div>

          {loadingId === item.seasonId && (
            <span className="bangumi-item__loading">
              <SpinnerIcon className="spin" width={20} height={20} />
            </span>
          )}
        </button>
      ))}
    </div>
  </section>
);

export default BangumiResults;