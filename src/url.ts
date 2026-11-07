/**
 * The address without its trailing slashes: `https://auth.example.com/` and
 * `https://auth.example.com` name the same issuer. A loop, not `/\/+$/`,
 * which backtracks over a long run of slashes.
 */
export function withoutTrailingSlashes(s: string): string {
  let end = s.length
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--
  return s.slice(0, end)
}

/**
 * Whether `candidate` is a path on the page's own origin: it starts with one
 * `/`, holds no backslash and no control character (a browser drops a tab or
 * a newline, so `/\t/host` would become `//host`), and resolves against an
 * origin to that same origin. The check of `localPath` in `@cauthyhq/node`.
 */
export function isLocalPath(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return false
  try {
    return new URL(candidate, 'http://x').origin === 'http://x'
  } catch {
    return false
  }
}
