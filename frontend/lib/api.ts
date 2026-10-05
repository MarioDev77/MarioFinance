const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')
let csrfToken = typeof window !== 'undefined' ? localStorage.getItem('mariofin_csrf') || '' : ''

export function setCsrfToken(token: string) { csrfToken = token; if (typeof window !== 'undefined') localStorage.setItem('mariofin_csrf', token) }
export function clearCsrfToken() { csrfToken = ''; if (typeof window !== 'undefined') localStorage.removeItem('mariofin_csrf') }

export async function api<T=any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type','application/json')
  if (options.method && !['GET','HEAD'].includes(options.method.toUpperCase()) && csrfToken) headers.set('X-CSRF-Token', csrfToken)
  const response = await fetch(`${API_URL}/api/${path.replace(/^\//,'')}`, { ...options, headers, credentials:'include', cache:'no-store' })
  const payload = await response.json().catch(()=>({}))
  if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível concluir a operação.')
  if (payload?.csrfToken) setCsrfToken(payload.csrfToken)
  return payload
}

export async function login(email:string,password:string){const data=await api<any>('auth/login',{method:'POST',body:JSON.stringify({email,password})});if(data.csrfToken)setCsrfToken(data.csrfToken);return data}
export async function logout(){try{await api('auth/logout',{method:'POST'})}finally{clearCsrfToken()}}
