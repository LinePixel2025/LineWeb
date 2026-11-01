import type { ReactNode } from 'react'

/**
 * LineWeb 统一图标集（2026-11「重绘图标」）
 *
 * 口径：
 * - 24×24 网格、1.7 描边、圆头圆角，视觉重量与 SF Symbols 接近；
 * - 主体描边 + 低透明度填充（duotone），避免纯线框在毛玻璃上发灰；
 * - 一律 currentColor，颜色交给父级（激活态/危险态只需改 color）；
 * - 不再从 Feather / Octicons 直接拷贝，路径按同一套圆角与留白重画。
 */
export type IconName =
  | 'logo' | 'menu' | 'sun' | 'moon' | 'auto'
  | 'chevron-down' | 'chevron-right' | 'chevron-left' | 'chevron-up'
  | 'home' | 'dashboard' | 'book' | 'folder' | 'compass' | 'gamepad' | 'paw' | 'chart'
  | 'chat' | 'coin' | 'sparkles' | 'globe' | 'user' | 'settings' | 'shield' | 'toggles'
  | 'code' | 'power' | 'plus' | 'upload' | 'download' | 'search' | 'filter' | 'refresh'
  | 'close' | 'check' | 'star' | 'trash' | 'edit' | 'more' | 'panel' | 'grid' | 'list'
  | 'clock' | 'copy' | 'move' | 'select-all' | 'file' | 'image' | 'video' | 'audio'
  | 'pdf' | 'archive' | 'heart' | 'link' | 'mail' | 'lock' | 'logout'
  | 'arrow-up' | 'arrow-down' | 'arrow-left' | 'folder-plus' | 'cloud' | 'users' | 'message' | 'ai'
  | 'api' | 'trophy' | 'calendar' | 'tag' | 'bell' | 'eye' | 'database' | 'wallet' | 'send' | 'megaphone'
  | 'bookOpen' | 'music'
  | 'play' | 'pause' | 'volume' | 'repeat' | 'shuffle' | 'skip-back' | 'skip-forward'

interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
  /** 仅星标使用：实心（收藏/评分） */
  filled?: boolean
  title?: string
}

const TINT = { fill: 'currentColor', stroke: 'none', opacity: 0.13 } as const

const glyphs: Record<IconName, ReactNode> = {
  logo: (
    <>
      <rect x="2.5" y="2.5" width="19" height="19" rx="6.25" {...TINT} />
      <path d="M7.75 6.5v11h8.75" />
      <path d="M16 6.5 7.75 14.75" opacity=".45" />
    </>
  ),
  menu: <path d="M4 7.25h16M4 12h10.5M4 16.75h16" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.75v2.1M12 19.15v2.1M2.75 12h2.1M19.15 12h2.1M5.45 5.45l1.5 1.5M17.05 17.05l1.5 1.5M18.55 5.45l-1.5 1.5M6.95 17.05l-1.5 1.5" />
    </>
  ),
  moon: (
    <path d="M20.2 14.7A8.6 8.6 0 0 1 9.3 3.8 8.6 8.6 0 1 0 20.2 14.7Z" fill="currentColor" fillOpacity=".13" />
  ),
  auto: (
    <>
      <circle cx="12" cy="12" r="7.75" />
      <path d="M12 4.25a7.75 7.75 0 0 1 0 15.5Z" {...TINT} />
      <path d="M12 4.25a7.75 7.75 0 0 1 0 15.5" />
      <path d="M12 2.5v1M12 20.5v1M2.5 12h1M20.5 12h1" opacity=".55" />
    </>
  ),
  'chevron-down': <path d="m6.5 9.25 5.5 5.5 5.5-5.5" />,
  'chevron-right': <path d="m9.25 6.5 5.5 5.5-5.5 5.5" />,
  'chevron-left': <path d="m14.75 6.5-5.5 5.5 5.5 5.5" />,
  'chevron-up': <path d="m6.5 14.75 5.5-5.5 5.5 5.5" />,
  home: (
    <>
      <path d="M3.5 10.6 12 3.35l8.5 7.25" />
      <path d="M5.4 9.25v10.15a1.25 1.25 0 0 0 1.25 1.25h10.7a1.25 1.25 0 0 0 1.25-1.25V9.25" />
      <path d="M9.6 20.65v-5.4h4.8v5.4" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3.25" y="3.25" width="7.4" height="7.4" rx="2.2" {...TINT} />
      <rect x="13.35" y="3.25" width="7.4" height="7.4" rx="2.2" />
      <rect x="3.25" y="13.35" width="7.4" height="7.4" rx="2.2" />
      <rect x="13.35" y="13.35" width="7.4" height="7.4" rx="2.2" />
    </>
  ),
  book: (
    <>
      <path d="M4.5 5.1c0-1.05.85-1.9 1.9-1.9H19.5v15.9H6.4a1.9 1.9 0 0 0-1.9 1.9V5.1Z" {...TINT} />
      <path d="M4.5 5.1c0-1.05.85-1.9 1.9-1.9H19.5v15.9H6.4a1.9 1.9 0 0 0-1.9 1.9V5.1Z" />
      <path d="M4.5 18.4c0-1.05.85-1.9 1.9-1.9h13.1M8.6 7.4h6.2M8.6 10.6h4.3" />
    </>
  ),
  folder: (
    <>
      <path d="M3.1 7.3c0-1.15.93-2.08 2.08-2.08h3.7c.55 0 1.08.22 1.47.61l1.18 1.18h6.44c1.15 0 2.08.93 2.08 2.08v8.51c0 1.15-.93 2.08-2.08 2.08H5.18A2.08 2.08 0 0 1 3.1 17.6V7.3Z" {...TINT} />
      <path d="M3.1 7.3c0-1.15.93-2.08 2.08-2.08h3.7c.55 0 1.08.22 1.47.61l1.18 1.18h6.44c1.15 0 2.08.93 2.08 2.08v8.51c0 1.15-.93 2.08-2.08 2.08H5.18A2.08 2.08 0 0 1 3.1 17.6V7.3Z" />
      <path d="M3.35 9.65h17.3" opacity=".5" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="m14.9 9.1-1.55 4.25L9.1 14.9l1.55-4.25L14.9 9.1Z" {...TINT} />
      <path d="m14.9 9.1-1.55 4.25L9.1 14.9l1.55-4.25L14.9 9.1Z" />
      <circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  gamepad: (
    <>
      <path d="M8.1 8.1h7.8a4.7 4.7 0 0 1 4.55 5.87l-.62 2.5a2.35 2.35 0 0 1-4.25.72l-1.05-1.7H9.47l-1.05 1.7a2.35 2.35 0 0 1-4.25-.72l-.62-2.5A4.7 4.7 0 0 1 8.1 8.1Z" {...TINT} />
      <path d="M8.1 8.1h7.8a4.7 4.7 0 0 1 4.55 5.87l-.62 2.5a2.35 2.35 0 0 1-4.25.72l-1.05-1.7H9.47l-1.05 1.7a2.35 2.35 0 0 1-4.25-.72l-.62-2.5A4.7 4.7 0 0 1 8.1 8.1Z" />
      <path d="M6.55 11.2v2.1M5.5 12.25h2.1" />
      <circle cx="15.7" cy="11.65" r=".75" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="13.35" r=".75" fill="currentColor" stroke="none" />
    </>
  ),
  paw: (
    <>
      <path d="M7.9 12.15c-1.55.72-2.65 2.26-2.65 3.95 0 1.9 1.45 3.2 3.45 3.2 1.1 0 2.2-.4 3.3-.4s2.2.4 3.3.4c2 0 3.45-1.3 3.45-3.2 0-1.69-1.1-3.23-2.65-3.95-1.28-.6-2.65-.95-4.1-.95s-2.82.35-4.1.95Z" {...TINT} />
      <path d="M7.9 12.15c-1.55.72-2.65 2.26-2.65 3.95 0 1.9 1.45 3.2 3.45 3.2 1.1 0 2.2-.4 3.3-.4s2.2.4 3.3.4c2 0 3.45-1.3 3.45-3.2 0-1.69-1.1-3.23-2.65-3.95-1.28-.6-2.65-.95-4.1-.95s-2.82.35-4.1.95Z" />
      <ellipse cx="5.3" cy="8.65" rx="1.55" ry="1.8" transform="rotate(-18 5.3 8.65)" />
      <ellipse cx="9.55" cy="6.1" rx="1.55" ry="1.85" />
      <ellipse cx="14.45" cy="6.1" rx="1.55" ry="1.85" />
      <ellipse cx="18.7" cy="8.65" rx="1.55" ry="1.8" transform="rotate(18 18.7 8.65)" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4.5v15h16" opacity=".55" />
      <path d="m7 15.4 3.25-3.65 3.05 2.45L19 8.4" />
      <path d="M16.25 8.4H19v2.75" />
      <circle cx="7" cy="15.4" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  chat: (
    <>
      <path d="M4.4 5.7A2.7 2.7 0 0 1 7.1 3h9.8a2.7 2.7 0 0 1 2.7 2.7v7.1a2.7 2.7 0 0 1-2.7 2.7h-5.3l-4.6 3.3v-3.3h-.1a2.7 2.7 0 0 1-2.7-2.7V5.7Z" {...TINT} />
      <path d="M4.4 5.7A2.7 2.7 0 0 1 7.1 3h9.8a2.7 2.7 0 0 1 2.7 2.7v7.1a2.7 2.7 0 0 1-2.7 2.7h-5.3l-4.6 3.3v-3.3h-.1a2.7 2.7 0 0 1-2.7-2.7V5.7Z" />
      <path d="M8.25 8.4h7.5M8.25 11.35h4.6" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="6.2" opacity=".5" />
      <path d="m12 7.85 1.22 2.93 2.93 1.22-2.93 1.22L12 16.15l-1.22-2.93L7.85 12l2.93-1.22L12 7.85Z" {...TINT} />
      <path d="m12 7.85 1.22 2.93 2.93 1.22-2.93 1.22L12 16.15l-1.22-2.93L7.85 12l2.93-1.22L12 7.85Z" />
    </>
  ),
  sparkles: (
    <>
      <path d="m10 3.1 1.65 4.25L15.9 9l-4.25 1.65L10 14.9l-1.65-4.25L4.1 9l4.25-1.65L10 3.1Z" {...TINT} />
      <path d="m10 3.1 1.65 4.25L15.9 9l-4.25 1.65L10 14.9l-1.65-4.25L4.1 9l4.25-1.65L10 3.1Z" />
      <path d="m18.2 13.1.85 2.15 2.15.85-2.15.85-.85 2.15-.85-2.15-2.15-.85 2.15-.85.85-2.15Z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M3.35 12h17.3M12 3.25c2.35 2.45 3.5 5.35 3.5 8.75s-1.15 6.3-3.5 8.75M12 3.25C9.65 5.7 8.5 8.6 8.5 12s1.15 6.3 3.5 8.75" />
      <path d="M5 6.35c1.85 1.15 4.15 1.8 7 1.8s5.15-.65 7-1.8M5 17.65c1.85-1.15 4.15-1.8 7-1.8s5.15.65 7 1.8" opacity=".55" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.1" r="4.15" {...TINT} />
      <circle cx="12" cy="8.1" r="4.15" />
      <path d="M4.4 20.4a7.6 7.6 0 0 1 15.2 0" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h7.2M15.1 7H20M4 17h4.9M12.8 17H20" />
      <circle cx="13.15" cy="7" r="2" />
      <circle cx="10.85" cy="17" r="2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.9 4.75 5.65v5.2c0 4.15 2.95 7.7 7.25 9.05 4.3-1.35 7.25-4.9 7.25-9.05v-5.2L12 2.9Z" {...TINT} />
      <path d="M12 2.9 4.75 5.65v5.2c0 4.15 2.95 7.7 7.25 9.05 4.3-1.35 7.25-4.9 7.25-9.05v-5.2L12 2.9Z" />
      <path d="m9.1 11.8 2.05 2.05 3.9-4.15" />
    </>
  ),
  toggles: (
    <>
      <rect x="3.1" y="8.4" width="17.8" height="7.2" rx="3.6" {...TINT} />
      <rect x="3.1" y="8.4" width="17.8" height="7.2" rx="3.6" />
      <circle cx="16.35" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  code: <path d="m8.25 7.25-4.75 4.75 4.75 4.75M15.75 7.25 20.5 12l-4.75 4.75M13.4 4.6l-2.8 14.8" />,
  power: (
    <>
      <path d="M12 3.1v8.1" />
      <path d="M6.55 6.55a7.7 7.7 0 1 0 10.9 0" />
    </>
  ),
  plus: <path d="M12 4.75v14.5M4.75 12h14.5" />,
  upload: (
    <>
      <path d="M4.1 15.6v3.15a1.65 1.65 0 0 0 1.65 1.65h12.5a1.65 1.65 0 0 0 1.65-1.65V15.6" />
      <path d="M7.6 8.4 12 4l4.4 4.4M12 4.4v11.2" />
    </>
  ),
  download: (
    <>
      <path d="M4.1 15.6v3.15a1.65 1.65 0 0 0 1.65 1.65h12.5a1.65 1.65 0 0 0 1.65-1.65V15.6" />
      <path d="m7.6 11.4 4.4 4.4 4.4-4.4M12 4.1v11.7" />
    </>
  ),
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="6.4" />
      <path d="m15.6 15.6 4.1 4.1" />
    </>
  ),
  filter: (
    <>
      <path d="M3.6 5.35h16.8l-6.5 7.35v5.35L10.1 20v-7.3L3.6 5.35Z" {...TINT} />
      <path d="M3.6 5.35h16.8l-6.5 7.35v5.35L10.1 20v-7.3L3.6 5.35Z" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.85 5.55v4.7h-4.7" />
      <path d="M4.15 18.45v-4.7h4.7" />
      <path d="M6.15 9.3a6.3 6.3 0 0 1 10.45-2.4l3.25 3.35M17.85 14.7a6.3 6.3 0 0 1-10.45 2.4L4.15 13.75" />
    </>
  ),
  close: <path d="m6.25 6.25 11.5 11.5M17.75 6.25l-11.5 11.5" />,
  check: <path d="m4.75 12.4 4.6 4.6L19.4 6.9" />,
  star: (
    <path
      d="m12 3.35 2.7 5.5 6.05.88-4.38 4.27 1.04 6.03L12 17.18l-5.41 2.85 1.04-6.03-4.38-4.27 6.05-.88L12 3.35Z"
    />
  ),
  trash: (
    <>
      <path d="M4.35 6.75h15.3M9.1 3.6h5.8M6.7 6.75l.9 12.2a1.7 1.7 0 0 0 1.7 1.55h5.4a1.7 1.7 0 0 0 1.7-1.55l.9-12.2" />
      <path d="M10 10.35v6.1M14 10.35v6.1" opacity=".6" />
    </>
  ),
  edit: (
    <>
      <path d="M13.1 5.4 18.6 10.9 8.2 21.3H2.7v-5.5L13.1 5.4Z" {...TINT} />
      <path d="M13.1 5.4 18.6 10.9 8.2 21.3H2.7v-5.5L13.1 5.4Z" />
      <path d="m15.15 3.35 1.5-1.5a1.9 1.9 0 0 1 2.7 0l2.8 2.8a1.9 1.9 0 0 1 0 2.7l-1.5 1.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5.4" cy="12" r="1.45" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.45" fill="currentColor" stroke="none" />
      <circle cx="18.6" cy="12" r="1.45" fill="currentColor" stroke="none" />
    </>
  ),
  panel: (
    <>
      <rect x="3.25" y="4" width="17.5" height="16" rx="2.7" />
      <path d="M9 4v16" />
      <path d="M5.8 8h.9M5.8 12h.9" opacity=".6" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.25h11M9 12h11M9 17.75h11" />
      <circle cx="4.6" cy="6.25" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="17.75" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4v4.95l3.3 1.95" />
    </>
  ),
  copy: (
    <>
      <rect x="8.35" y="8.35" width="12.2" height="12.2" rx="2.5" />
      <path d="M15.65 8.35V5.95a2.5 2.5 0 0 0-2.5-2.5H5.95a2.5 2.5 0 0 0-2.5 2.5v7.2a2.5 2.5 0 0 0 2.5 2.5h2.4" />
    </>
  ),
  move: (
    <>
      <path d="M12 3.25v17.5M3.25 12h17.5" opacity=".45" />
      <path d="m8.55 6.7 3.45-3.45 3.45 3.45M8.55 17.3l3.45 3.45 3.45-3.45M6.7 8.55 3.25 12l3.45 3.45M17.3 8.55 20.75 12l-3.45 3.45" />
    </>
  ),
  'select-all': (
    <>
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4" opacity=".5" />
      <path d="m7.4 12.2 3.05 3.05 6.15-6.5" />
    </>
  ),
  file: (
    <>
      <path d="M6.15 3.1h7.3L19 8.7v12.2H6.15V3.1Z" {...TINT} />
      <path d="M6.15 3.1h7.3L19 8.7v12.2H6.15V3.1Z" />
      <path d="M13.25 3.3v5.55H19" />
    </>
  ),
  bookOpen: (
    <>
      <path d="M12 6.6C10.4 5 8.1 4.35 4.4 4.3a1 1 0 0 0-1.05 1v11.4a1 1 0 0 0 1.05 1c3.4.05 5.55.65 7.05 2.05 1.5-1.4 3.65-2 7.05-2.05a1 1 0 0 0 1.05-1V5.3a1 1 0 0 0-1.05-1c-3.7.05-6 .7-7.6 2.3Z" {...TINT} />
      <path d="M12 6.6C10.4 5 8.1 4.35 4.4 4.3a1 1 0 0 0-1.05 1v11.4a1 1 0 0 0 1.05 1c3.4.05 5.55.65 7.05 2.05 1.5-1.4 3.65-2 7.05-2.05a1 1 0 0 0 1.05-1V5.3a1 1 0 0 0-1.05-1c-3.7.05-6 .7-7.6 2.3Z" />
      <path d="M12 6.6v13.15" opacity=".45" />
    </>
  ),
  music: (
    <>
      <path d="M9.4 18.35V6.05a1 1 0 0 1 .78-.98l8-1.75a1 1 0 0 1 1.22.98v11.4" {...TINT} />
      <path d="M9.4 18.35V6.05a1 1 0 0 1 .78-.98l8-1.75a1 1 0 0 1 1.22.98v11.4" />
      <ellipse cx="6.7" cy="18.55" rx="2.7" ry="2.45" />
      <ellipse cx="16.7" cy="16.25" rx="2.7" ry="2.45" />
    </>
  ),
  image: (
    <>
      <rect x="3.25" y="4.25" width="17.5" height="15.5" rx="3" {...TINT} />
      <rect x="3.25" y="4.25" width="17.5" height="15.5" rx="3" />
      <circle cx="8.6" cy="9.4" r="1.55" />
      <path d="m4.6 17.1 4.4-4.3 3.05 2.8 3.2-3.3 4.2 4.4" />
    </>
  ),
  video: (
    <>
      <rect x="2.9" y="4.9" width="13.4" height="14.2" rx="3" {...TINT} />
      <rect x="2.9" y="4.9" width="13.4" height="14.2" rx="3" />
      <path d="m16.3 10.1 3.4-2.2a.9.9 0 0 1 1.4.75v6.7a.9.9 0 0 1-1.4.75l-3.4-2.2" />
      <path d="m7.75 9.5 3.1 2.5-3.1 2.5v-5Z" fill="currentColor" stroke="none" />
    </>
  ),
  audio: (
    <>
      <path d="M9.25 17.6V5.4l9.5-1.55v11.75" {...TINT} />
      <path d="M9.25 17.6V5.4l9.5-1.55v11.75" />
      <ellipse cx="6.55" cy="18.05" rx="2.7" ry="2.3" />
      <ellipse cx="16.05" cy="16.4" rx="2.7" ry="2.3" />
    </>
  ),
  pdf: (
    <>
      <path d="M6.15 3.1h7.3L19 8.7v12.2H6.15V3.1Z" {...TINT} />
      <path d="M6.15 3.1h7.3L19 8.7v12.2H6.15V3.1Z" />
      <path d="M13.25 3.3v5.55H19M9 12.4h6M9 15.2h6M9 18h3.6" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="3.6" width="18" height="5" rx="1.9" {...TINT} />
      <rect x="3" y="3.6" width="18" height="5" rx="1.9" />
      <path d="M4.9 8.6v9.6a1.9 1.9 0 0 0 1.9 1.9h10.4a1.9 1.9 0 0 0 1.9-1.9V8.6" />
      <path d="M9.9 12.4h4.2" />
    </>
  ),
  heart: (
    <path d="M12 20.35s-7.9-4.75-7.9-10.55a4.15 4.15 0 0 1 7.2-2.8L12 7.7l.7-.7a4.15 4.15 0 0 1 7.2 2.8c0 5.8-7.9 10.55-7.9 10.55Z" fill="currentColor" fillOpacity=".13" />
  ),
  link: (
    <>
      <path d="M10.15 13.85a4.35 4.35 0 0 0 6.15 0l2.55-2.55a4.35 4.35 0 1 0-6.15-6.15L11.3 6.55" />
      <path d="M13.85 10.15a4.35 4.35 0 0 0-6.15 0L5.15 12.7a4.35 4.35 0 1 0 6.15 6.15l1.4-1.4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" {...TINT} />
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4.5 7.5 7.5 5.3 7.5-5.3" />
    </>
  ),
  lock: (
    <>
      <rect x="4.8" y="10.4" width="14.4" height="10.4" rx="3" {...TINT} />
      <rect x="4.8" y="10.4" width="14.4" height="10.4" rx="3" />
      <path d="M8.2 10.4V7.9a3.8 3.8 0 0 1 7.6 0v2.5" />
      <circle cx="12" cy="15.4" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  logout: (
    <>
      <path d="M10.25 4.2H5.8A2.3 2.3 0 0 0 3.5 6.5v11a2.3 2.3 0 0 0 2.3 2.3h4.45" />
      <path d="M14.2 7.75 18.45 12l-4.25 4.25M8.8 12h9.65" />
    </>
  ),
  'arrow-up': <path d="M12 20V4.4M6.5 9.9 12 4.4l5.5 5.5" />,
  'arrow-down': <path d="M12 4v15.6M6.5 14.1l5.5 5.5 5.5-5.5" />,
  'arrow-left': <path d="M20 12H4.4M9.9 6.5 4.4 12l5.5 5.5" />,
  'folder-plus': (
    <>
      <path d="M3.1 7.3c0-1.15.93-2.08 2.08-2.08h3.7c.55 0 1.08.22 1.47.61l1.18 1.18h6.44c1.15 0 2.08.93 2.08 2.08v8.51c0 1.15-.93 2.08-2.08 2.08H5.18A2.08 2.08 0 0 1 3.1 17.6V7.3Z" {...TINT} />
      <path d="M3.1 7.3c0-1.15.93-2.08 2.08-2.08h3.7c.55 0 1.08.22 1.47.61l1.18 1.18h6.44c1.15 0 2.08.93 2.08 2.08v8.51c0 1.15-.93 2.08-2.08 2.08H5.18A2.08 2.08 0 0 1 3.1 17.6V7.3Z" />
      <path d="M12 10.9v5.2M9.4 13.5h5.2" />
    </>
  ),
  cloud: (
    <path d="M7.2 18.4h10.1a4.15 4.15 0 0 0 .85-8.2A6.15 6.15 0 0 0 6.2 9.05 4.7 4.7 0 0 0 7.2 18.4Z" fill="currentColor" fillOpacity=".13" />
  ),
  users: (
    <>
      <circle cx="9.2" cy="8" r="3.5" {...TINT} />
      <circle cx="9.2" cy="8" r="3.5" />
      <path d="M3.2 19.3a6 6 0 0 1 12 0" />
      <path d="M15.6 5.1a3.15 3.15 0 0 1 0 5.8M17.3 14.1a4.8 4.8 0 0 1 3.5 4.6" />
    </>
  ),
  message: (
    <>
      <path d="M4.4 5.7A2.7 2.7 0 0 1 7.1 3h9.8a2.7 2.7 0 0 1 2.7 2.7v7.1a2.7 2.7 0 0 1-2.7 2.7h-5.3l-4.6 3.3v-3.3h-.1a2.7 2.7 0 0 1-2.7-2.7V5.7Z" />
      <path d="M8.25 8.4h7.5M8.25 11.35h4.6" opacity=".6" />
    </>
  ),
  ai: (
    <>
      <path d="m9.4 2.8 1.55 4 4 1.55-4 1.55-1.55 4-1.55-4-4-1.55 4-1.55 1.55-4Z" {...TINT} />
      <path d="m9.4 2.8 1.55 4 4 1.55-4 1.55-1.55 4-1.55-4-4-1.55 4-1.55 1.55-4Z" />
      <path d="m17.5 12.4.95 2.35 2.35.95-2.35.95-.95 2.35-.95-2.35-2.35-.95 2.35-.95.95-2.35Z" />
    </>
  ),
  api: (
    <>
      <path d="M8.3 4.2H7.2a2.2 2.2 0 0 0-2.2 2.2v2.2c0 1.2-.95 2.2-2.1 2.2v2.4c1.15 0 2.1 1 2.1 2.2v2.2a2.2 2.2 0 0 0 2.2 2.2h1.1" />
      <path d="M15.7 4.2h1.1a2.2 2.2 0 0 1 2.2 2.2v2.2c0 1.2.95 2.2 2.1 2.2v2.4c-1.15 0-2.1 1-2.1 2.2v2.2a2.2 2.2 0 0 1-2.2 2.2h-1.1" />
      <circle cx="12" cy="8.4" r="1.05" fill="currentColor" stroke="none" />
      <path d="M12 10.4v5.2" opacity=".6" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4.4h8v4.25a4 4 0 0 1-8 0V4.4Z" {...TINT} />
      <path d="M8 4.4h8v4.25a4 4 0 0 1-8 0V4.4ZM8 5.9H5.4v1.35a3 3 0 0 0 3 3M16 5.9h2.6v1.35a3 3 0 0 1-3 3" />
      <path d="M12 12.65v4.1M8.75 19.6h6.5M9.75 16.75h4.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.4" y="5.2" width="17.2" height="15.4" rx="3" {...TINT} />
      <rect x="3.4" y="5.2" width="17.2" height="15.4" rx="3" />
      <path d="M3.4 9.7h17.2M7.8 3.2v4M16.2 3.2v4" />
      <path d="M7.6 13.2h2.1M11 13.2h2.1M14.4 13.2h2.1M7.6 16.5h2.1M11 16.5h2.1" opacity=".6" />
    </>
  ),
  tag: (
    <>
      <path d="M3.4 10.4V4.3a.9.9 0 0 1 .9-.9h6.1c.24 0 .47.1.64.27l9.14 9.14a.9.9 0 0 1 0 1.27l-6.1 6.1a.9.9 0 0 1-1.27 0L3.67 11.04a.9.9 0 0 1-.27-.64Z" {...TINT} />
      <path d="M3.4 10.4V4.3a.9.9 0 0 1 .9-.9h6.1c.24 0 .47.1.64.27l9.14 9.14a.9.9 0 0 1 0 1.27l-6.1 6.1a.9.9 0 0 1-1.27 0L3.67 11.04a.9.9 0 0 1-.27-.64Z" />
      <circle cx="8.15" cy="8.15" r="1.45" />
    </>
  ),
  bell: (
    <>
      <path d="M6.2 9.8a5.8 5.8 0 0 1 11.6 0c0 4.2 1.4 5.7 2.2 6.5H4c.8-.8 2.2-2.3 2.2-6.5Z" {...TINT} />
      <path d="M6.2 9.8a5.8 5.8 0 0 1 11.6 0c0 4.2 1.4 5.7 2.2 6.5H4c.8-.8 2.2-2.3 2.2-6.5ZM9.75 19.2a2.35 2.35 0 0 0 4.5 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S5.9 5.8 12 5.8 21.5 12 21.5 12 18.1 18.2 12 18.2 2.5 12 2.5 12Z" {...TINT} />
      <path d="M2.5 12S5.9 5.8 12 5.8 21.5 12 21.5 12 18.1 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3.05" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.8" rx="7.8" ry="3" {...TINT} />
      <ellipse cx="12" cy="5.8" rx="7.8" ry="3" />
      <path d="M4.2 5.8v12.4c0 1.66 3.49 3 7.8 3s7.8-1.34 7.8-3V5.8M4.2 12c0 1.66 3.49 3 7.8 3s7.8-1.34 7.8-3" />
    </>
  ),
  wallet: (
    <>
      <rect x="3.2" y="6" width="17.6" height="13.8" rx="3.2" {...TINT} />
      <rect x="3.2" y="6" width="17.6" height="13.8" rx="3.2" />
      <path d="M3.2 9.5h17.6M15.3 13.8h5.5v3.2h-5.5a1.6 1.6 0 0 1 0-3.2Z" />
    </>
  ),
  send: (
    <>
      <path d="M20.6 3.4 3.5 10.2l6.45 2.9 2.9 6.45L20.6 3.4Z" {...TINT} />
      <path d="M20.6 3.4 3.5 10.2l6.45 2.9 2.9 6.45L20.6 3.4ZM9.95 13.1l10.65-9.7" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3.4 9.4v3.1c0 .5.36.93.85 1.02L6 14V7.6l-1.75.78A1.04 1.04 0 0 0 3.4 9.4Z" {...TINT} />
      <path d="M6 7.6 18.3 3.1a.7.7 0 0 1 .95.66v14.48a.7.7 0 0 1-.95.66L6 14V7.6ZM6 7.6v6.4" />
      <path d="M7.2 14.3v3.2a1.5 1.5 0 0 0 1.5 1.5h.55a1.5 1.5 0 0 0 1.5-1.5v-2.2M21.5 9.2v3.6" />
    </>
  ),
  play: <path d="M8.4 4.9a.9.9 0 0 1 1.35-.78l9.2 5.9a1.15 1.15 0 0 1 0 1.96l-9.2 5.9a.9.9 0 0 1-1.35-.78V4.9Z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6.6" y="4.6" width="3.9" height="14.8" rx="1.5" fill="currentColor" />
      <rect x="13.5" y="4.6" width="3.9" height="14.8" rx="1.5" fill="currentColor" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.4h3.1L11.4 6v12L7.1 14.6H4a.8.8 0 0 1-.8-.8v-3.6a.8.8 0 0 1 .8-.8Z" {...TINT} />
      <path d="M4 9.4h3.1L11.4 6v12L7.1 14.6H4a.8.8 0 0 1-.8-.8v-3.6a.8.8 0 0 1 .8-.8Z" />
      <path d="M14.6 9.1a4.1 4.1 0 0 1 0 5.8M17.3 6.4a7.9 7.9 0 0 1 0 11.2" />
    </>
  ),
  repeat: (
    <>
      <path d="M5.4 9.3a3.9 3.9 0 0 1 3.9-3.9h7.6" />
      <path d="m14.4 2.9 3 2.5-3 2.5" />
      <path d="M18.6 14.7a3.9 3.9 0 0 1-3.9 3.9H7.1" />
      <path d="m9.6 16.1-3 2.5 3 2.5" />
    </>
  ),
  shuffle: (
    <>
      <path d="M4.2 6.6h2.9c1.05 0 2.03.5 2.64 1.35l4.52 6.3a3.3 3.3 0 0 0 2.64 1.35h2.9" />
      <path d="m17.4 12.9 3.4 2.7-3.4 2.7" />
      <path d="M4.2 17.4h2.9c1.05 0 2.03-.5 2.64-1.35l.9-1.25M13.4 9.2l.86-1.25A3.3 3.3 0 0 1 16.9 6.6h2.9" />
      <path d="m17.4 3.9 3.4 2.7-3.4 2.7" />
    </>
  ),
  'skip-back': (
    <>
      <path d="M18.6 5.6v12.8L9.4 12l9.2-6.4Z" fill="currentColor" fillOpacity=".13" />
      <path d="M18.6 5.6v12.8L9.4 12l9.2-6.4Z" />
      <path d="M5.9 5.4v13.2" />
    </>
  ),
  'skip-forward': (
    <>
      <path d="M5.4 5.6v12.8L14.6 12 5.4 5.6Z" fill="currentColor" fillOpacity=".13" />
      <path d="M5.4 5.6v12.8L14.6 12 5.4 5.6Z" />
      <path d="M18.1 5.4v13.2" />
    </>
  ),
}

export default function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className,
  filled = false,
  title,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {name === 'star' ? (
        <g fill={filled ? 'currentColor' : 'none'}>{glyphs.star}</g>
      ) : (
        glyphs[name]
      )}
    </svg>
  )
}
