import type { DownloadTask } from "../../../main/download-manager";
import {
  AlertIcon,
  BangumiIcon,
  CheckIcon,
  ExternalIcon,
  FolderIcon,
  MusicIcon,
  SpinnerIcon,
  TrashIcon,
  VideoIcon,
  XIcon,
} from "./Icons";
import { classNames, formatBytes, formatSpeed } from "../utils";

interface DownloadListProps {
  tasks: DownloadTask[];
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onShowItem: (path: string) => void;
  onOpenFolder: (path: string) => void;
  downloadDir: string;
}

const STATUS_TEXT: Record<DownloadTask["status"], string> = {
  pending: "排队中",
  downloading: "下载中",
  merging: "处理中",
  done: "已完成",
  error: "失败",
  cancelled: "已取消",
};

const StatusIcon = ({ status }: { status: DownloadTask["status"] }) => {
  if (status === "done") return <CheckIcon width={15} height={15} />;
  if (status === "error") return <AlertIcon width={15} height={15} />;
  if (status === "cancelled") return <XIcon width={15} height={15} />;
  return <SpinnerIcon className="spin" width={15} height={15} />;
};

const KindIcon = ({
  kind,
  size,
}: {
  kind: DownloadTask["kind"];
  size: number;
}) => {
  if (kind === "bangumi") return <BangumiIcon width={size} height={size} />;
  if (kind === "audio") return <MusicIcon width={size} height={size} />;
  return <VideoIcon width={size} height={size} />;
};

const DownloadList = ({
  tasks,
  onCancel,
  onRemove,
  onShowItem,
  onOpenFolder,
  downloadDir,
}: DownloadListProps) => {
  if (tasks.length === 0) {
    return (
      <section className="card download-list download-list--empty">
        <div className="empty-state">
          <span className="empty-state__icon">
            <VideoIcon width={26} height={26} />
          </span>
          <p className="empty-state__title">还没有下载任务</p>
          <p className="empty-state__hint">
            在上方输入 BV 号 / av 号查询视频，或按名称搜索番剧，然后点击下载
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="card download-list">
      <div className="download-list__head">
        <h2>
          下载任务
          <span className="badge">{tasks.length}</span>
        </h2>
        <button
          type="button"
          className="link-button"
          onClick={() => onOpenFolder(downloadDir)}
        >
          <FolderIcon width={14} height={14} />
          打开下载目录
        </button>
      </div>

      <ul className="task-list">
        {tasks.map((task) => {
          const active =
            task.status === "downloading" ||
            task.status === "merging" ||
            task.status === "pending";
          const percent = Math.round(task.progress);
          const indeterminate =
            active &&
            task.status === "downloading" &&
            task.total === 0 &&
            task.progress === 0;

          return (
            <li
              key={task.id}
              className={classNames("task", `task--${task.status}`)}
            >
              <div className="task__thumb">
                {task.cover ? (
                  <img src={task.cover} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="task__thumb-fallback">
                    <KindIcon kind={task.kind} size={18} />
                  </span>
                )}
                <span
                  className={classNames(
                    "task__kind",
                    `task__kind--${task.kind}`,
                  )}
                >
                  <KindIcon kind={task.kind} size={11} />
                </span>
              </div>

              <div className="task__body">
                <div className="task__top">
                  <span className="task__title" title={task.title}>
                    {task.title}
                  </span>
                  <span
                    className={classNames(
                      "task__status",
                      `task__status--${task.status}`,
                    )}
                  >
                    <StatusIcon status={task.status} />
                    {STATUS_TEXT[task.status]}
                    {active && task.status === "downloading" && ` ${percent}%`}
                  </span>
                </div>

                <div
                  className={classNames(
                    "progress",
                    indeterminate && "progress--indeterminate",
                  )}
                >
                  <span
                    className="progress__bar"
                    style={{ width: indeterminate ? undefined : `${percent}%` }}
                  />
                </div>

                <div className="task__bottom">
                  <span className="task__stage">
                    {task.error ?? task.note ?? task.stage}
                  </span>
                  <span className="task__metrics">
                    {active && task.total > 0 && (
                      <>
                        {task.episodeCount &&
                          `${task.doneEpisodes ?? 0}/${task.episodeCount} 集 · `}
                        {formatBytes(task.received)} / {formatBytes(task.total)}
                        {task.speed > 0 && ` · ${formatSpeed(task.speed)}`}
                      </>
                    )}
                    {task.status === "done" &&
                      task.outputPath &&
                      (task.episodeCount
                        ? `${task.episodeCount} 集`
                        : formatBytes(task.total))}
                  </span>
                </div>
              </div>

              <div className="task__actions">
                {task.status === "done" && task.outputPath && (
                  <>
                    <button
                      type="button"
                      className="icon-button icon-button--small"
                      title="在文件夹中显示"
                      onClick={() => onShowItem(task.outputPath as string)}
                    >
                      <ExternalIcon width={15} height={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button--small"
                      title="移除记录"
                      onClick={() => onRemove(task.id)}
                    >
                      <TrashIcon width={15} height={15} />
                    </button>
                  </>
                )}
                {active && (
                  <button
                    type="button"
                    className="icon-button icon-button--small icon-button--danger"
                    title="取消下载"
                    onClick={() => onCancel(task.id)}
                  >
                    <XIcon width={15} height={15} />
                  </button>
                )}
                {!active && task.status !== "done" && (
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    title="移除记录"
                    onClick={() => onRemove(task.id)}
                  >
                    <TrashIcon width={15} height={15} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default DownloadList;
