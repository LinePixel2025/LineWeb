import { memo } from 'react'
import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import { useWallpaper } from '../contexts/WallpaperContext'

export default memo(function Layout() {
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
              background: `url(${bgUrl}) center/cover no-repeat`, // P18: CSS background cannot use loading="lazy" — acceptable for hero image
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

      {/* Ambient blobs — slow floating light orbs */}
      <div className="ambient-blob" style={{
        width: '600px', height: '600px',
        top: '-10%', right: '-15%',
        background: 'radial-gradient(circle, var(--ambient-blue) 0%, transparent 70%)',
        animation: 'ambient-float-1 30s ease-in-out infinite',
        opacity: loaded ? 0.6 : 0,
        transition: 'opacity 1s ease',
      }} />
      <div className="ambient-blob" style={{
        width: '500px', height: '500px',
        bottom: '-5%', left: '-10%',
        background: 'radial-gradient(circle, var(--ambient-coral) 0%, transparent 70%)',
        animation: 'ambient-float-2 25s ease-in-out infinite',
        opacity: loaded ? 0.5 : 0,
        transition: 'opacity 1s ease',
      }} />
      <div className="ambient-blob" style={{
        width: '400px', height: '400px',
        top: '40%', left: '50%',
        background: 'radial-gradient(circle, var(--ambient-light) 0%, transparent 70%)',
        animation: 'ambient-float-3 35s ease-in-out infinite',
        opacity: loaded ? 0.3 : 0,
        transition: 'opacity 1s ease',
      }} />

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
})
