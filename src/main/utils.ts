import fs from 'node:fs'
import path from 'node:path'

/** 递归确保目录存在（对应原库的 ensure_dir） */
export const ensureDir = (dir: string): void => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }
}

/**
 * 清洗文件名：B站标题里经常带 / \ : * ? " < > | 等 Windows 非法字符
 * @param name 原始名称
 */
export const sanitizeFileName = (name: string): string => {
    const cleaned = name
        // eslint-disable-next-line no-control-regex
        .replace(/[\\/:*?"<>|\r\n\t\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.+$/, '')
        .slice(0, 120)
        .trim()
    return cleaned || 'video'
}

/** 若目标文件已存在，自动追加 (1) (2) … 避免覆盖 */
export const uniqueFilePath = (dir: string, baseName: string, ext: string): string => {
    let candidate = path.join(dir, `${baseName}${ext}`)
    let index = 1
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${baseName} (${index})${ext}`)
        index += 1
    }
    return candidate
}

/** B站接口经常返回 http 的图片地址，统一升级为 https，否则会被渲染层的 CSP 拦掉 */
export const toHttps = (url: string | undefined): string =>
    url ? url.replace(/^http:\/\//i, 'https://') : ''

/** 删除临时文件，失败时静默忽略 */
export const removeFileQuietly = (filePath?: string): void => {
    if (!filePath) return
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {
        /* ignore */
    }
}