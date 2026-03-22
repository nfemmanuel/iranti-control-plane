/**
 * IrantiMark — five-node memory graph logo mark.
 * Amber center hub, four corner nodes with spokes.
 * Ported from iranti-site/src/components/Logo.tsx — adapted for CSS modules context.
 */

interface IrantiMarkProps {
  /** Outer size in px. The amber square fills this. Default: 22 */
  size?: number
}

export function IrantiMark({ size = 22 }: IrantiMarkProps) {
  const innerSize = Math.round(size * 0.57)

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: '#f59e0b',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <svg
        width={innerSize}
        height={innerSize}
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        {/* Spokes: center → each corner node */}
        <line x1="7" y1="7" x2="2"  y2="4"  stroke="#080808" strokeWidth="0.6" strokeOpacity="0.4" />
        <line x1="7" y1="7" x2="12" y2="4"  stroke="#080808" strokeWidth="0.6" strokeOpacity="0.4" />
        <line x1="7" y1="7" x2="2"  y2="10" stroke="#080808" strokeWidth="0.6" strokeOpacity="0.3" />
        <line x1="7" y1="7" x2="12" y2="10" stroke="#080808" strokeWidth="0.6" strokeOpacity="0.3" />
        {/* Corner nodes */}
        <circle cx="2"  cy="4"  r="1.4" fill="#080808" opacity="0.65" />
        <circle cx="12" cy="4"  r="1.4" fill="#080808" opacity="0.65" />
        <circle cx="2"  cy="10" r="1.4" fill="#080808" opacity="0.45" />
        <circle cx="12" cy="10" r="1.4" fill="#080808" opacity="0.45" />
        {/* Center hub */}
        <circle cx="7" cy="7" r="2.4" fill="#080808" />
      </svg>
    </span>
  )
}
