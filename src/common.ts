import { resolve } from 'url'
import { Request, Response, createHeaders } from 'servie'
import { Middleware } from 'throwback'
import { PopsicleError } from './error'
import { createBody } from 'servie/dist/body/universal'

/**
 * Redirection types to handle.
 */
enum REDIRECT_TYPE {
  FOLLOW_WITH_GET,
  FOLLOW_WITH_CONFIRMATION
}

/**
 * Possible redirection status codes.
 */
const REDIRECT_STATUS: { [status: number]: number | undefined } = {
  '301': REDIRECT_TYPE.FOLLOW_WITH_GET,
  '302': REDIRECT_TYPE.FOLLOW_WITH_GET,
  '303': REDIRECT_TYPE.FOLLOW_WITH_GET,
  '307': REDIRECT_TYPE.FOLLOW_WITH_CONFIRMATION,
  '308': REDIRECT_TYPE.FOLLOW_WITH_CONFIRMATION
}

/**
 * Default header handling.
 */
export function normalizeRequest <T extends Request, U extends Response> (): Middleware<T, U> {
  return function (req, next) {
    // Block requests when already aborted.
    if (req.aborted) return Promise.reject(new PopsicleError('Request aborted', 'EABORT', req))

    // If we have no accept header set already, default to accepting
    // everything. This is needed because otherwise Firefox defaults to
    // an accept header of `html/xml`.
    if (!req.headers.get('Accept')) {
      req.headers.set('Accept', '*/*')
    }

    // Remove headers that should never be set by the user.
    req.headers.delete('Host')

    return next(req)
  }
}

/**
 * Redirect middleware configuration.
 */
export interface FollowRedirectsOptions {
  maxRedirects?: number
  confirmRedirect?: (request: Request, response: Response) => boolean
}

/**
 * Middleware function for following HTTP redirects.
 */
export function followRedirects <T extends Request, U extends Response> (
  options: FollowRedirectsOptions = {}
): Middleware<T, U> {
  return async function (initialRequest, next) {
    let req = initialRequest.clone()
    let redirectCount = 0
    const maxRedirects = typeof options.maxRedirects === 'number' ? options.maxRedirects : 5
    const confirmRedirect = options.confirmRedirect || (() => false)

    while (redirectCount++ < maxRedirects) {
      const res = await next(req as T)
      const redirect = REDIRECT_STATUS[res.statusCode]

      // Handle HTTP redirects.
      if (redirect !== undefined && res.headers.has('Location')) {
        const newUrl = resolve(req.url, res.headers.get('Location')!) // tslint:disable-line

        // Ignore the result of the response on redirect.
        req.abort()
        req.events.emit('redirect', newUrl)

        if (redirect === REDIRECT_TYPE.FOLLOW_WITH_GET) {
          req = initialRequest.clone()
          req.headers.set('Content-Length', '0')
          req.url = newUrl
          req.method = req.method.toUpperCase() === 'HEAD' ? 'HEAD' : 'GET'
          req.body = createBody(undefined)
          req.trailer = Promise.resolve(createHeaders())

          continue
        }

        if (redirect === REDIRECT_TYPE.FOLLOW_WITH_CONFIRMATION) {
          const method = req.method.toUpperCase()

          // Following HTTP spec by automatically redirecting with GET/HEAD.
          if (method === 'GET' || method === 'HEAD') {
            req = initialRequest.clone()
            req.url = newUrl

            continue
          }

          // Allow the user to confirm redirect according to HTTP spec.
          if (confirmRedirect(req, res)) {
            req = initialRequest.clone()
            req.url = newUrl

            continue
          }

          return res
        }
      }

      return res
    }

    throw new PopsicleError(`Maximum redirects exceeded: ${maxRedirects}`, 'EMAXREDIRECTS', req)
  }
}
