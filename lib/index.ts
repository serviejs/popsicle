import { request as httpRequest, IncomingMessage } from 'http'
import { request as httpsRequest, RequestOptions } from 'https'
import { PassThrough } from 'stream'
import urlLib = require('url')
import extend = require('xtend')
import arrify = require('arrify')
import { Cookie } from 'tough-cookie'
import Promise = require('any-promise')
import { Headers } from './base'
import Request from './request'
import Response from './response'
import { defaults as use } from './plugins/index'

/**
 * Export default instance with node transportation layer.
 */
export { open, abort, use }

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
const REDIRECT_STATUS: { [status: number]: number } = {
  '300': REDIRECT_TYPE.FOLLOW_WITH_GET,
  '301': REDIRECT_TYPE.FOLLOW_WITH_GET,
  '302': REDIRECT_TYPE.FOLLOW_WITH_GET,
  '303': REDIRECT_TYPE.FOLLOW_WITH_GET,
  '305': REDIRECT_TYPE.FOLLOW_WITH_GET,
  '307': REDIRECT_TYPE.FOLLOW_WITH_CONFIRMATION,
  '308': REDIRECT_TYPE.FOLLOW_WITH_CONFIRMATION
}

/**
 * Open a HTTP request with node.
 */
function open (request: Request<Response>) {
  const { url, method, body, options } = request
  const maxRedirects = num(options.maxRedirects, 5)
  const followRedirects = options.followRedirects !== false
  const storeCookies = getStoreCookies(request)
  const attachCookies = getAttachCookies(request)
  let requestCount = 0

  const confirmRedirect = typeof options.followRedirects === 'function' ?
    options.followRedirects : falsey

  /**
   * Create the HTTP request, in a way we can re-use this.
   */
  function get (url: string, method: string, body?: any) {
    // Check redirection count before executing request.
    if (requestCount++ > maxRedirects) {
      return Promise.reject(
        request.error(`Exceeded maximum of ${maxRedirects} redirects`, 'EMAXREDIRECTS')
      )
    }

    return attachCookies(url)
      .then(function () {
        return new Promise((resolve, reject) => {
          const arg: any = urlLib.parse(url)
          const isHttp = arg.protocol !== 'https:'
          const engine: typeof httpRequest = isHttp ? httpRequest : httpsRequest

          // Attach request options.
          arg.method = method
          arg.headers = request.toHeaders()
          arg.agent = options.agent
          arg.rejectUnauthorized = options.rejectUnauthorized !== false
          arg.ca = options.ca
          arg.cert = options.cert
          arg.key = options.key

          const rawRequest = engine(arg)

          // Track upload/download progress through a stream.
          const requestStream = new PassThrough()
          const responseStream = new PassThrough()

          requestStream.on('data', function (chunk: Buffer) {
            request.uploadedBytes += chunk.length
          })

          requestStream.on('end', function () {
            request.uploadedBytes = request.uploadLength
          })

          responseStream.on('data', function (chunk: Buffer) {
            request.downloadedBytes += chunk.length
          })

          responseStream.on('end', function () {
            request.downloadedBytes = request.downloadLength
          })

          // Handle the HTTP response.
          function response (rawResponse: IncomingMessage) {
            const status = rawResponse.statusCode
            const redirect = REDIRECT_STATUS[status]

            // Handle HTTP redirects.
            if (followRedirects && redirect != null && rawResponse.headers.location) {
              const newUrl = urlLib.resolve(url, rawResponse.headers.location)

              // Ignore the result of the response on redirect.
              rawResponse.resume()

              if (redirect === REDIRECT_TYPE.FOLLOW_WITH_GET) {
                // Update the "Content-Length" for updated redirection body.
                request.set('Content-Length', '0')

                return get(newUrl, 'GET')
              }

              if (redirect === REDIRECT_TYPE.FOLLOW_WITH_CONFIRMATION) {
                // Following HTTP spec by automatically redirecting with GET/HEAD.
                if (arg.method === 'GET' || arg.method === 'HEAD') {
                  return get(newUrl, method, body)
                }

                // Allow the user to confirm redirect according to HTTP spec.
                if (confirmRedirect(rawRequest, rawResponse)) {
                  return get(newUrl, method, body)
                }
              }
            }

            request.downloadLength = num(rawResponse.headers['content-length'], 0)

            rawResponse.pipe(responseStream)

            return Promise.resolve(new Response({
              body: responseStream,
              status: status,
              statusText: rawResponse.statusMessage,
              headers: rawResponse.headers,
              rawHeaders: rawResponse.rawHeaders,
              url: url
            }))
          }

          // Emit a request error.
          function emitError (error: Error) {
            // Abort request on error.
            rawRequest.abort()
            reject(error)
          }

          rawRequest.once('response', function (message: IncomingMessage) {
            resolve(storeCookies(url, message).then(() => response(message)))
          })

          rawRequest.once('error', function (error: Error) {
            emitError(request.error(`Unable to connect to "${url}"`, 'EUNAVAILABLE', error))
          })

          request._raw = rawRequest
          request.uploadLength = num(rawRequest.getHeader('content-length'), 0)
          requestStream.pipe(rawRequest)
          requestStream.once('error', emitError)

          // Pipe the body to the stream.
          if (body) {
            if (typeof body.pipe === 'function') {
              body.pipe(requestStream)
              body.once('error', emitError)
            } else {
              requestStream.end(body)
            }
          } else {
            requestStream.end()
          }
        })
      })
  }

  return get(url, method, body)
}

/**
 * Close the current HTTP request.
 */
function abort (request: Request<Response>) {
  request._raw.abort()
}

/**
 * Parse a value into a number.
 */
function num (value: any, fallback?: number) {
  if (value == null) {
    return fallback
  }

  return isNaN(value) ? fallback : Number(value)
}

/**
 * Used to check redirection support.
 */
function falsey () {
  return false
}

/**
 * Read cookies from the cookie jar.
 */
function getAttachCookies (request: Request<Response>): (url: string) => Promise<any> {
  const { jar } = request.options
  const cookie = request.get('Cookie')

  if (!jar) {
    return () => Promise.resolve()
  }

  return function (url: string) {
    return new Promise(function (resolve, reject) {
      request.set('Cookie', cookie)

      request.options.jar.getCookies(url, function (err: Error, cookies: Cookie[]) {
        if (err) {
          return reject(err)
        }

        if (cookies.length) {
          request.append('Cookie', cookies.join('; '))
        }

        return resolve()
      })
    })
  }
}

/**
 * Put cookies in the cookie jar.
 */
function getStoreCookies (request: Request<Response>): (url: string, message: IncomingMessage) => Promise<any> {
  const { jar } = request.options

  if (!jar) {
    return () => Promise.resolve()
  }

  return function (url, message) {
    const cookies = arrify(message.headers['set-cookie'])

    if (!cookies.length) {
      return Promise.resolve()
    }

    const setCookies = cookies.map(function (cookie) {
      return new Promise(function (resolve, reject) {
        jar.setCookie(cookie, url, { ignoreError: true }, function (err: Error) {
          return err ? reject(err) : resolve()
        })
      })
    })

    return Promise.all(setCookies)
  }
}
