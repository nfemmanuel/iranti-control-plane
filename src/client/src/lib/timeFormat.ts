import type { TimezonePreference } from './settings'

/** Resolve the timezone option for Intl formatters. undefined = browser local. */
function resolveTimeZone(tz: TimezonePreference): string | undefined {
  return tz === 'local' ? undefined : tz
}

export function formatAbsoluteTime(iso: string | null, tz: TimezonePreference = 'local'): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    timeZone: resolveTimeZone(tz),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatTimestamp(iso: string | null, tz: TimezonePreference = 'local'): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    timeZone: resolveTimeZone(tz),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}

/** Time-only format for event streams (hh:mm:ss). */
export function formatTime(iso: string | null, tz: TimezonePreference = 'local'): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], {
    timeZone: resolveTimeZone(tz),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Current timezone label for display in the UI. */
export function timezoneLabel(tz: TimezonePreference): string {
  if (tz === 'local') {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  }
  return tz
}

/** Common timezone choices for the settings picker. */
export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'local', label: `Local (${Intl.DateTimeFormat().resolvedOptions().timeZone})` },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Chicago', label: 'US Central' },
  { value: 'America/Denver', label: 'US Mountain' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Africa/Lagos', label: 'Lagos (WAT)' },
  { value: 'Africa/Nairobi', label: 'Nairobi (EAT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Kolkata', label: 'Kolkata (IST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
]
