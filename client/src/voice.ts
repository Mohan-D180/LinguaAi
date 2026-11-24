type RecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

declare global {
  interface Window {
    SpeechRecognition?: new () => RecognitionInstance
    webkitSpeechRecognition?: new () => RecognitionInstance
  }
}

export function getSpeechVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices()
}

type SpeechVoice = Pick<SpeechSynthesisVoice, 'voiceURI' | 'lang' | 'default'>

export function selectSpeechVoice<T extends SpeechVoice>(
  voices: T[],
  lang: string,
  preferredVoiceURI = ''
): T | undefined {
  if (preferredVoiceURI) {
    const preferred = voices.find(voice => voice.voiceURI === preferredVoiceURI)
    if (preferred) return preferred
  }

  const normalizedLang = lang.toLowerCase()
  const language = normalizedLang.split('-')[0]
  return voices.find(voice => voice.lang.toLowerCase() === normalizedLang)
    || voices.find(voice => voice.lang.toLowerCase().split('-')[0] === language)
    || voices.find(voice => voice.default)
    || voices[0]
}

export function speak(
  text: string,
  lang: string,
  preferredVoiceURI = '',
  onError?: (message: string) => void
): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onError?.('Speech playback is not supported in this browser.')
    return false
  }

  try {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    const voice = selectSpeechVoice(getSpeechVoices(), lang, preferredVoiceURI)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang || lang
    }
    utterance.onerror = () => onError?.('Could not play the tutor voice. Check your browser audio settings.')
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    return true
  } catch {
    onError?.('Could not play the tutor voice. Check your browser audio settings.')
    return false
  }
}

export function startSpeechRecognition(
  lang: string,
  onText: (text: string) => void,
  onError: (message: string) => void,
  onEnd: () => void
) {
  const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Constructor) {
    onError('Speech recognition is not supported in this browser. Try Chrome or Edge, or type your message.')
    return () => {}
  }
  const recognition = new Constructor()
  recognition.lang = lang
  recognition.continuous = false
  recognition.interimResults = false
  recognition.onresult = event => {
    const transcript = Array.from(event.results as ArrayLike<any>).map((result: any) => result[0].transcript).join(' ')
    onText(transcript)
  }
  recognition.onerror = event => onError(`Microphone error: ${event.error || 'Please check microphone permissions.'}`)
  recognition.onend = onEnd
  try {
    recognition.start()
  } catch {
    onError('Could not start microphone. Check browser permissions.')
    onEnd()
  }
  return () => {
    try {
      recognition.stop()
    } catch {}
  }
}
