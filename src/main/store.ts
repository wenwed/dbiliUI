import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_QUALITY } from './bili/constants'
import type { BiliUser } from './bili/login'

/**
 * 配置持久化。
 * 存到 %APPDATA%/<appName>/config.json（即 app.getPath('userData')），
 * 不引入 electron-store，避免其 ESM-only 版本带来的加载问题。
 */

export interface AppConfig {
    /** 下载目录 */
    downloadDir: string
    /** 默认清晰度 id */
    quality: number
    /** 登录后的 Cookie 字符串 */
    cookie: string
    /** 登录用户信息，仅用于界面展示 */
    user: BiliUser | null
}

const configFile = (): string => path.join(app.getPath('userData'), 'config.json')

const defaultConfig = (): AppConfig => ({
    downloadDir: path.join(app.getPath('downloads'), 'BiliDownloader'),
    quality: DEFAULT_QUALITY,
    cookie: '',
    user: null
})

let cache: AppConfig | null = null

/** 读取配置（首次读取时从磁盘加载，损坏则回退默认值） */
export const getConfig = (): AppConfig => {
    if (cache) return cache

    try {
        const raw = fs.readFileSync(configFile(), 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AppConfig>
        cache = { ...defaultConfig(), ...parsed }
    } catch {
        cache = defaultConfig()
    }
    return cache
}

/** 合并写入配置并立刻落盘 */
export const updateConfig = (patch: Partial<AppConfig>): AppConfig => {
    const next: AppConfig = { ...getConfig(), ...patch }
    cache = next

    const file = configFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(next, null, 4), 'utf-8')
    return next
}

/** 下载临时目录，用于存放待合并的分片流 */
export const getTempDir = (): string => path.join(app.getPath('temp'), 'bili-downloader')