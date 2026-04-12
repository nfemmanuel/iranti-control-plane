/**
 * path-utils.ts — Portable path helpers for cross-platform path resolution.
 *
 * The control plane runs on Windows, macOS, and Linux. Paths received from
 * instance env files may be Windows-style (C:\...) even when the host OS is
 * POSIX (e.g., WSL or a mounted drive). These helpers detect the path style
 * and delegate to the correct Node path module so resolution is always correct.
 */

import path, { win32 } from 'path'

export function looksLikeWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
}

export function isAbsolutePathPortable(value: string): boolean {
  return path.isAbsolute(value) || looksLikeWindowsAbsolutePath(value)
}

function pickPathModule(value: string): typeof path {
  return looksLikeWindowsAbsolutePath(value) ? win32 : path
}

export function resolvePortable(base: string, ...segments: string[]): string {
  return pickPathModule(base).resolve(base, ...segments)
}

export function dirnamePortable(value: string): string {
  return pickPathModule(value).dirname(value)
}

export function basenamePortable(value: string): string {
  return pickPathModule(value).basename(value)
}

export function joinPortable(base: string, ...segments: string[]): string {
  return pickPathModule(base).join(base, ...segments)
}

