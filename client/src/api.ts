const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1'
let accessToken: string | null = null
export type User = { id: string; name: string; email: string; nativeLanguage: string; targetLanguage: string; level: string }
export type Message = { id: string; role: 'user'|'assistant'; content: string; createdAt: string }
export type TutorResponse = { reply: string; correction: string; explanation: string; suggestion: string; nextQuestion: string }
async function rawRequest<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      ...options, credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(options.headers || {}) }
    })
  } catch {
    throw new Error(`Cannot reach the API at ${API}. Confirm the server is running and retry.`)
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      const refreshed = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' })
      const payload = await refreshed.json()
      if (refreshed.ok && payload.data?.accessToken) {
        accessToken = payload.data.accessToken
        return rawRequest<T>(path, options, false)
      }
    } catch {}
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body.data as T
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return rawRequest<T>(path, options)
}
function rememberToken(result: { accessToken: string }) { accessToken = result.accessToken }
export const api = {
  register: async (payload: {name:string;email:string;password:string;nativeLanguage:string;targetLanguage:string;level:string}) => {
    const result = await request<{user:User;accessToken:string}>('/auth/register',{method:'POST',body:JSON.stringify(payload)})
    rememberToken(result); return result
  },
  login: async (email:string,password:string) => {
    const result = await request<{user:User;accessToken:string}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})})
    rememberToken(result); return result
  },
  logout: async () => { try { return await request('/auth/logout',{method:'POST'}) } finally { accessToken = null } },
  me: async () => {
    if (!accessToken) {
      const refreshed = await fetch(`${API}/auth/refresh`, { method:'POST', credentials:'include' })
      const payload = await refreshed.json().catch(()=>({}))
      if (!refreshed.ok || !payload.data?.accessToken) throw new Error('Not signed in')
      accessToken = payload.data.accessToken
    }
    return request<{user:User}>('/auth/me')
  },
  sessions: () => request<{sessions:any[]}>('/chat/sessions'),
  createSession: (language:string, topic:string) => request<{session:any}>('/chat/sessions',{method:'POST',body:JSON.stringify({language,topic})}),
  messages: (id:string) => request<{messages:Message[]}>(`/chat/sessions/${id}`),
  send: (id:string, content:string, inputType:'text'|'voice') => request<{message:Message;reply:Message;tutor:TutorResponse}>(`/chat/sessions/${id}/messages`,{method:'POST',body:JSON.stringify({content,inputType})}),
  overview: () => request<any>('/progress/overview')
}
