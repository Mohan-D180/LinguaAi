import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API network failures', () => {
  it('explains how to recover when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(api.register({
      name: 'Test User',
      email: 'test@example.test',
      password: 'password123',
      nativeLanguage: 'Bengali',
      targetLanguage: 'English',
      level: 'A2'
    })).rejects.toThrow(/Cannot reach the API/)
  })
})
