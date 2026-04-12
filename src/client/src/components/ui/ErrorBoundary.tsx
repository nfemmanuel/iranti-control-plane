/**
 * ErrorBoundary.tsx — React error boundary for graceful UI error recovery.
 *
 * Wraps subtrees to catch unhandled render errors and display a user-visible
 * fallback with a "Try again" reset and a link back to /overview.
 */

import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-6)',
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: 32, color: 'var(--color-text-tertiary)' }} aria-hidden="true">
          ⚠
        </span>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Something went wrong</h2>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            maxWidth: 420,
            lineHeight: 1.5,
          }}
        >
          This page encountered an error while rendering. You can try again or navigate to another section.
        </p>
        <pre
          style={{
            margin: 0,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-status-error)',
            background: 'var(--color-bg-sunken)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--border-radius-sm)',
            padding: 'var(--space-2) var(--space-3)',
            maxWidth: 520,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {this.state.error.message}
        </pre>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <button
            onClick={this.handleReset}
            style={{
              padding: '0 14px',
              height: 36,
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-bg-base)',
              color: 'var(--color-text-primary)',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <Link
            to="/overview"
            onClick={this.handleReset}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
              height: 36,
              border: '1px solid var(--color-accent-primary)',
              borderRadius: 'var(--border-radius-md)',
              background: 'color-mix(in srgb, var(--color-accent-primary) 18%, var(--color-bg-base))',
              color: 'var(--color-text-primary)',
              textDecoration: 'none',
              font: 'inherit',
            }}
          >
            Go to Overview
          </Link>
        </div>
      </div>
    )
  }
}
