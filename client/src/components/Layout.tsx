import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import { useWallpaper } from '../contexts/WallpaperContext'

export default function Layout() {
  const { bgUrl, copyright, loaded } = useWallpaper()

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* Global Bing wallpaper background */}
      {bgUrl ? (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 0,
              background: `url(${bgUrl}) center/cover no-repeat`,
              transition: 'opacity 0.8s ease',
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
              transition: 'opacity 0.8s ease',
            }}
          />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: 'var(--lg-bg)' }} />
      )}

      <Navbar />
      <main style={{ position: 'relative', zIndex: 2 }}>
        <Outlet />
      </main>

      {/* Copyright — with safe-area inset */}
      {copyright && (
        <div style={{
          position: 'fixed', bottom: 'max(12px, var(--lg-safe-bottom))', left: 0, right: 0, zIndex: 3,
          display: 'flex', justifyContent: 'center', pointerEvents: 'none',
          padding: '0 16px',
        }}>
          <span style={{
            fontSize: '0.7rem', padding: '3px 14px',
            borderRadius: '9999px',
            background: 'rgba(0,0,0,0.35)',
            backdropFilter: 'blur(6px)',
            color: 'rgba(255,255,255,0.5)',
            WebkitBackdropFilter: 'blur(6px)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}>
            {copyright}
          </span>
        </div>
      )}
    </div>
  )
}
