/** Get the last path segment from a file path string (browser-safe). */
export function basename(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
}
