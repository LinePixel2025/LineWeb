// client/src/pages/GlassTestPage.tsx
import { useState } from 'react'
import LiquidGlass from '../components/glass/LiquidGlass'
import { useGlassCapabilities } from '../components/glass/useGlassCapabilities'

/**
 * Dev test page for visual comparison of glass rendering modes.
 * Shows the current browser's capabilities and renders test cards
 * with all variant/interactive/chromatic combinations.
 */
export default function GlassTestPage() {
  const capabilities = useGlassCapabilities()
  const [variant, setVariant] = useState<'regular' | 'strong' | 'blur'>('regular')
  const [interactive, setInteractive] = useState(true)
  const [chromatic, setChromatic] = useState(true)

  return (
    <div className="page container" style={{ padding: '40px 20px' }}>
      <h1 style={{ marginBottom: 8 }}>Glass Effect Test</h1>
      <p style={{ color: 'var(--lg-text-secondary)', marginBottom: 32 }}>
        Browser: {capabilities.supportsDisplacement
          ? '✅ Chromium — SVG displacement active'
          : '⚠️ Non-Chromium — CSS fallback active'}
        {' · '}Mobile: {capabilities.isMobile ? 'Yes' : 'No'}
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--lg-text-secondary)' }}>
          Variant:
          <select
            value={variant}
            onChange={(e) => setVariant(e.target.value as typeof variant)}
            style={{
              padding: '4px 8px',
              borderRadius: 8,
              background: 'var(--lg-bg-secondary)',
              color: 'var(--lg-text-primary)',
              border: '1px solid var(--lg-glass-border)',
            }}
          >
            <option value="regular">regular</option>
            <option value="strong">strong</option>
            <option value="blur">blur</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--lg-text-secondary)' }}>
          <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} />
          interactive
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--lg-text-secondary)' }}>
          <input type="checkbox" checked={chromatic} onChange={(e) => setChromatic(e.target.checked)} />
          chromatic
        </label>
      </div>

      {/* Test cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
        <LiquidGlass variant={variant} interactive={interactive} chromatic={chromatic}>
          <div style={{ padding: 24 }}>
            <h2 style={{ marginBottom: 12 }}>Card 1 — Simple</h2>
            <p style={{ color: 'var(--lg-text-secondary)' }}>
              Basic glass card. Move your mouse over to see interactive effects.
            </p>
          </div>
        </LiquidGlass>

        <LiquidGlass variant={variant} interactive={interactive} chromatic={chromatic}>
          <div style={{ padding: 24 }}>
            <h2 style={{ marginBottom: 12 }}>Card 2 — Rich Content</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--lg-accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 600,
              }}>
                JD
              </div>
              <div>
                <p style={{ fontWeight: 500 }}>John Doe</p>
                <p style={{ fontSize: 14, color: 'var(--lg-text-tertiary)' }}>Software Engineer</p>
              </div>
            </div>
            <p style={{ color: 'var(--lg-text-secondary)', fontSize: 14 }}>
              Tests complex content layouts inside glass.
            </p>
          </div>
        </LiquidGlass>

        <LiquidGlass variant={variant} interactive={false} chromatic={chromatic}>
          <div style={{ padding: 24 }}>
            <h2 style={{ marginBottom: 12 }}>Card 3 — Static (interactive=false)</h2>
            <p style={{ color: 'var(--lg-text-secondary)' }}>
              No mouse-following highlight. Used for content-heavy areas like article text.
            </p>
          </div>
        </LiquidGlass>

        <LiquidGlass variant={variant} interactive={interactive} chromatic={false}>
          <div style={{ padding: 24 }}>
            <h2 style={{ marginBottom: 12 }}>Card 4 — No Chromatic</h2>
            <p style={{ color: 'var(--lg-text-secondary)' }}>
              No color separation at edges (chromatic=false).
            </p>
          </div>
        </LiquidGlass>
      </div>

      {/* Full-width surface */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{ marginBottom: 16 }}>Full-width Surface</h2>
        <LiquidGlass variant="strong" interactive={interactive} chromatic={chromatic}>
          <div style={{ padding: 32 }}>
            <p style={{ color: 'var(--lg-text-secondary)' }}>
              Wide glass surface test. In advanced mode, SVG displacement refraction shows
              visible edge bending. In legacy mode, you see CSS-only frosted glass.
            </p>
          </div>
        </LiquidGlass>
      </div>
    </div>
  )
}
