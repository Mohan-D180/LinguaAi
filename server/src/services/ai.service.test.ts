import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../env.js', () => ({
  env: {
    OLLAMA_BASE_URL: 'http://ollama:11434',
    OLLAMA_MODEL: 'llama3.2:3b',
    OLLAMA_TIMEOUT_MS: 1000
  }
}))

import { AiServiceError, checkAiHealth, generateTutorResponse } from './ai.service.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

const validTutorResponse = {
  reply: 'I went to the market yesterday.',
  correction: 'I went to the market yesterday.',
  explanation: 'Use the past-tense verb for a completed action.',
  suggestion: 'Yesterday, I visited the market.',
  nextQuestion: 'What did you buy there?'
}

describe('Ollama tutor service', () => {
  it('sends server instructions and persisted chat history to the selected model', async () => {
    let requestBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body))
      return Response.json({ message: { content: JSON.stringify(validTutorResponse) } })
    }))

    const result = await generateTutorResponse({
      targetLanguage: 'English',
      nativeLanguage: 'Bengali',
      level: 'A2',
      topic: 'Daily life',
      history: [{ role: 'user', content: 'I like this market.' }],
      message: 'I go to the market yesterday.'
    })

    const messages = requestBody?.messages as Array<{ role: string; content: string }>
    expect(requestBody).toMatchObject({ model: 'llama3.2:3b', stream: false, format: 'json' })
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('"English"')
    expect(messages[1]).toEqual({ role: 'user', content: 'I like this market.' })
    expect(messages[2]).toEqual({ role: 'user', content: 'I go to the market yesterday.' })
    expect(result).toEqual(validTutorResponse)
  })

  it('uses a safe tutor response when Ollama returns malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      message: { content: 'not valid json' }
    })))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await generateTutorResponse({
      targetLanguage: 'English',
      nativeLanguage: 'Bengali',
      level: 'A2',
      topic: 'Daily life',
      history: [],
      message: 'Hello'
    })

    expect(result.reply).toContain('keep practicing')
    expect(result.nextQuestion).toContain('target language')
  })

  it('reports an unavailable Ollama service without leaking request content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')))

    await expect(generateTutorResponse({
      targetLanguage: 'English',
      nativeLanguage: 'Bengali',
      level: 'A2',
      topic: 'Daily life',
      history: [],
      message: 'private practice message'
    })).rejects.toMatchObject({ code: 'unavailable' } satisfies Partial<AiServiceError>)
  })

  it('classifies aborted requests as timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'AbortError')))

    await expect(generateTutorResponse({
      targetLanguage: 'English',
      nativeLanguage: 'Bengali',
      level: 'A2',
      topic: 'Daily life',
      history: [],
      message: 'Hello'
    })).rejects.toMatchObject({ code: 'timeout' } satisfies Partial<AiServiceError>)
  })

  it('identifies a model that is not installed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('model not found', { status: 404 })))

    await expect(generateTutorResponse({
      targetLanguage: 'English',
      nativeLanguage: 'Bengali',
      level: 'A2',
      topic: 'Daily life',
      history: [],
      message: 'Hello'
    })).rejects.toMatchObject({ code: 'model_missing' } satisfies Partial<AiServiceError>)
  })

  it('reports model readiness from Ollama tags', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ models: [{ name: 'llama3.2:3b' }] })))

    await expect(checkAiHealth()).resolves.toEqual({ status: 'ready', model: 'llama3.2:3b' })
  })
})
