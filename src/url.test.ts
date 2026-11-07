import { describe, expect, it } from 'vitest'
import { isLocalPath } from './url'

describe('a local path', () => {
  it('is a path on this origin', () => {
    for (const ok of ['/', '/deals', '/deals?id=1#top', '/api/auth']) expect(isLocalPath(ok), ok).toBe(true)
  })

  it('is never another origin, however it is written', () => {
    for (const bad of ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com', '/\t/evil.example.com', '/\n/evil.example.com', '/\r/evil.example.com', '/a\u007fb', 'deals', '', undefined, null, 42]) {
      expect(isLocalPath(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})
