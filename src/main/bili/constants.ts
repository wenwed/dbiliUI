/**
 * B站清晰度定义，与 dbili/modules/downloadVideo.js 的 DEFINITION 保持一致
 */
export const DEFINITION = Object.freeze({
    '360p': 16,
    '480p': 32,
    '720p': 64,
    '720p60': 74,
    '1080p': 80,
    '1080p+': 112,
    '1080p60': 116
})

export interface QualityOption {
    id: number
    label: string
    /** 该清晰度通常需要登录（大会员）才能获取 */
    vip?: boolean
}

export const QUALITY_OPTIONS: QualityOption[] = [
    { id: DEFINITION['360p'], label: '360P 流畅' },
    { id: DEFINITION['480p'], label: '480P 清晰' },
    { id: DEFINITION['720p'], label: '720P 高清' },
    { id: DEFINITION['720p60'], label: '720P60 高帧率', vip: true },
    { id: DEFINITION['1080p'], label: '1080P 高清' },
    { id: DEFINITION['1080p+'], label: '1080P+ 高码率', vip: true },
    { id: DEFINITION['1080p60'], label: '1080P60 高帧率', vip: true }
]

export const DEFAULT_QUALITY = DEFINITION['720p']