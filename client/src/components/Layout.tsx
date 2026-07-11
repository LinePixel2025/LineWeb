import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import { useWallpaper } from '../contexts/WallpaperContext'

export default function Layout() {
  const { bgUrl, bgType, solidColor, copyright, loaded } = useWallpaper()

  return (
    <div className="layout-root">
      {/* Background */}
      {bgType === 'wallpaper' && bgUrl ? (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 0,
              background: `url(${bgUrl}) center/cover no-repeat`,
              transition: 'opacity var(--lg-transition)',
              opacity: loaded ? 1 : 0,
              transform: 'scale(1.02)',
            }}
          />
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1,
              background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.40) 100%)',
              opacity: loaded ? 1 : 0,
              transition: 'opacity var(--lg-transition)',
            }}
          />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: solidColor }} />
      )}

      <Navbar />
      <main style={{ position: 'relative', zIndex: 2 }}>
        <div className="page-transition">
          <Outlet />
        </div>
      </main>

      {/* Copyright — with safe-area inset */}
      {copyright && (
        <div style={{
          position: 'fixed', bottom: 'max(12px, var(--lg-safe-bottom))', left: 0, right: 0, zIndex: 3,
          display: 'flex', justifyContent: 'center', pointerEvents: 'none',
          padding: '0 16px',
        }}>
          <span className="lg-surface" style={{
            fontSize: '0.7rem', padding: '3px 14px',
            borderRadius: '9999px',
            color: 'rgba(255,255,255,0.5)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: '100%',
            background: 'rgba(255,255,255,0.05)',
          }}>
            {copyright}
          </span>
        </div>
      )}
    </div>
  )
}
