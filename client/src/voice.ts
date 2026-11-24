type RecognitionResult = { transcript: string }
type RecognitionInstance = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  start: () => void; stop: () => void
}
declare global { interface Window { SpeechRecognition?: new () => RecognitionInstance; webkitSpeechRecognition?: new () => RecognitionInstance } }
export function startSpeechRecognition(lang: string, onText: (text:string)=>void, onError:(message:string)=>void, onEnd:()=>void) {
  const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Constructor) { onError('Speech recognition is not supported in this browser. Try Chrome or Edge, or type your message.'); return () => {} }
  const recognition = new Constructor()
  recognition.lang = lang; recognition.continuous = false; recognition.interimResults = false
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results as ArrayLike<any>).map((r:any)=>r[0].transcript).join(' ')
    onText(transcript)
  }
  recognition.onerror = (event) => onError(`Microphone error: ${event.error || 'Please check microphone permissions.'}`)
  recognition.onend = onEnd
  try { recognition.start() } catch { onError('Could not start microphone. Check browser permissions.'); onEnd() }
  return () => { try { recognition.stop() } catch {} }
}
export function speak(text:string, lang:string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  window.speechSynthesis.speak(utterance)
}
