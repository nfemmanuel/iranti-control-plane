/* Iranti Control Plane — Full-page loading state */
/* Used when the app is initializing or the instance context is loading */

import { Spinner } from './Spinner'

export function LoadingPage() {
  return (
    <div
      role="status"
      aria-label="Loading Iranti Control Plane"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100%',
        background: 'var(--color-bg-base)',
        gap: '20px',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: '32px',
          color: 'var(--color-accent-primary)',
          lineHeight: 1,
        }}
      >
        ⬡
      </span>
      <Spinner size="lg" label="Loading Iranti Control Plane" />
      <span
        style={{
          fontSize: '13px',
          color: 'var(--color-text-secondary)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        Loading…
      </span>
    </div>
  )
}
