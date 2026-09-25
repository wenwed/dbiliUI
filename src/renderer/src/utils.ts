/** 字节数 -> 可读体积 */
export const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

/** 秒 -> mm:ss / h:mm:ss */
export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
};

/** 播放量等大数字 -> 万 / 亿 */
export const formatCount = (value: number): string => {
  const count = value || 0;
  if (count >= 100000000) return `${(count / 100000000).toFixed(1)} 亿`;
  if (count >= 10000) return `${(count / 10000).toFixed(1)} 万`;
  return String(count);
};

/** Unix 秒 -> YYYY-MM-DD */
export const formatDate = (timestamp: number): string => {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 字节/秒 -> 可读速度 */
export const formatSpeed = (bytesPerSecond: number): string =>
  bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : "";

export const classNames = (...values: Array<string | false | undefined | null>): string =>
  values.filter(Boolean).join(" ");