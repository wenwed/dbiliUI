import { useState, type ReactNode } from "react";
import { VideoIcon } from "./Icons";
import { classNames } from "../utils";

interface CoverProps {
  src?: string;
  alt: string;
  className?: string;
  /** 加载失败或没有地址时显示的图标 */
  fallback?: ReactNode;
}

const Cover = ({ src, alt, className, fallback }: CoverProps) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={classNames("cover", "cover--placeholder", className)}>
        {fallback ?? <VideoIcon width={34} height={34} />}
      </div>
    );
  }

  return (
    <img
      className={classNames("cover", className)}
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
};

export default Cover;