import { Request, createHeaders, CreateHeaders } from 'servie'
import { CookieJar, Store } from 'tough-cookie'
import { createBody, CreateBody } from 'servie/dist/body/node'

// Use `http` transport by default.
export * from './transports/http'

/**
 * Create a cookie jar instance.
 */
export function cookieJar (store?: Store) {
  return new CookieJar(store)
}

/**
 * Universal request options.
 */
export interface RequestOptions {
  method?: string
  headers?: CreateHeaders
  trailer?: CreateHeaders | Promise<CreateHeaders>
  body?: CreateBody
}

/**
 * Simple universal request creator.
 */
export function request (url: string, options: RequestOptions = {}) {
  const { method } = options
  const headers = createHeaders(options.headers)
  const body = createBody(options.body)
  const trailer = Promise.resolve<CreateHeaders | undefined>(options.trailer).then(createHeaders)

  return new Request({ url, method, headers, body, trailer })
}
