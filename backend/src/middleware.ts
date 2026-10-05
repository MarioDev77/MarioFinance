import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export function middleware(req: NextRequest) {
  const requestedOrigin = req.headers.get('origin')
  const res = NextResponse.next()
  const allowed = ALLOWED_ORIGINS.includes(requestedOrigin ?? '')
  if (requestedOrigin && allowed) {
    res.headers.set('Access-Control-Allow-Origin', requestedOrigin)
    res.headers.set('Access-Control-Allow-Credentials', 'true')
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token')
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.headers.set('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') return res

  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }

  // CSRF em profundidade (o token CSRF e validado nas rotas; aqui checamos a origem)
  if (
    req.nextUrl.pathname.startsWith('/api') &&
    req.method !== 'GET' &&
    req.method !== 'HEAD'
  ) {
    const origin = req.headers.get('origin') ?? req.headers.get('referer')
    const host = req.headers.get('host')
    if (origin && host) {
      try {
        const o = new URL(origin)
        if (o.host !== host && !ALLOWED_ORIGINS.includes(o.origin)) {
          return new NextResponse(null, { status: 403 })
        }
      } catch {
        return new NextResponse(null, { status: 403 })
      }
    }
  }

  return res
}

export const config = {
  matcher: ['/api/:path*'],
}
