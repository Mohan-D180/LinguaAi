import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectSpeechVoice, speak } from './voice'

const voices = [
  { voiceURI: 'english', name: 'English Voice', lang: 'en-US', default: true },
  { voiceURI: 'spanish', name: 'Spanish Voice', lang: 'es-ES', default: false },
  { voiceURI: 'mexican', name: 'Mexican Voice', lang: 'es-MX', default: false }
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('speech voice selection', () => {
  it('uses the voice explicitly selected by the user', () => {
    expect(selectSpeechVoice(voices, 'en-US', 'mexican')?.voiceURI).toBe('mexican')
  })

  it('matches the practice language when automatic selection is enabled', () => {
    expect(selectSpeechVoice(voices, 'es-ES')?.voiceURI).toBe('spanish')
  })

  it('falls back to a voice for the same base language', () => {
    expect(selectSpeechVoice(voices, 'es-AR')?.voiceURI).toBe('spanish')
  })

  it('speaks with the voice selected by the user', () => {
    class FakeUtterance {
      lang = ''
      voice: SpeechSynthesisVoice | null = null
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null

      constructor(readonly text: string) {}
    }
    const play = vi.fn((utterance: FakeUtterance) => utterance)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: () => voices,
        cancel: vi.fn(),
        speak: play
      }
    })

    expect(speak('Hola', 'es-ES', 'mexican')).toBe(true)
    expect(play.mock.calls[0][0].voice?.voiceURI).toBe('mexican')
    expect(play.mock.calls[0][0].lang).toBe('es-MX')
  })
})
