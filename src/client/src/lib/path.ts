/**
 * path.ts — Browser-safe path utilities.
 *
 * Node's `path` module is not available in the browser. This module provides
 * minimal path helpers (currently just `basename`) that work in both contexts.
 */

/** Get the last path segment from a file path string (browser-safe). */
export function basename(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
}
