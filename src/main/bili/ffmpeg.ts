import fs from 'node:fs'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'

let currentPath = 'ffmpeg'

/**
 * 解析 ffmpeg 可执行文件路径。
 * 优先用 @ffmpeg-installer/ffmpeg 自带的二进制（与原库一致），
 * 拿不到时降级到系统 PATH 里的 ffmpeg。
 */
export const configureFfmpeg = (): string => {
    // 兼容 rollup 的 cjs interop：可能是 { path } 也可能是 { default: { path } }
    const mod = ffmpegInstaller as unknown as { path?: string; default?: { path?: string } }
    const installerPath = mod?.path ?? mod?.default?.path

    currentPath = installerPath && fs.existsSync(installerPath) ? installerPath : 'ffmpeg'
    ffmpeg.setFfmpegPath(currentPath)
    return currentPath
}

export const getFfmpegPath = (): string => currentPath