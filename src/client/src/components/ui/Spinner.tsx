/* Iranti Control Plane — Spinner component */
/* PM decision: css-loaders.com/spinner/ loader #3 — conic-gradient arc */

import styles from './Spinner.module.css'

const SIZE_PX: Record<'sm' | 'md' | 'lg', number> = {
  sm: 20,
  md: 32,
  lg: 48,
}

const PADDING_PX: Record<'sm' | 'md' | 'lg', number> = {
  sm: 4,
  md: 6,
  lg: 8,
}

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

export function Spinner({ size = 'md', label = 'Loading' }: SpinnerProps) {
  const px = SIZE_PX[size]
  const padding = PADDING_PX[size]

  return (
    <div
      className={styles.spinner}
      role="status"
      aria-label={label}
      style={{
        width: `${px}px`,
        padding: `${padding}px`,
        // aspect-ratio: 1 is implied by equal width + padding
        aspectRatio: '1',
      }}
    />
  )
}
