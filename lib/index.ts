import { request as httpRequest, IncomingMessage, ClientRequest } from 'http'
import { request as httpsRequest, RequestOptions } from 'https'
import { PassThrough } from 'stream'
import urlLib = require('url')
import extend = require('xtend')
import arrify = require('arrify')
import concat = require('concat-stream')
import { Cookie } from 'tough-cookie'
import Promise = require('any-promise')
import { createUnzip } from 'zlib'
import { Headers } from './base'
import Request from './request'
import Response from './response'
import { stringify, headers } from './plugins/index'
import { parse, textTypes, TextTypes } from './utils'

export type Types = 'buffer' | 'array' | 'uint8array' | 'stream' | TextTypes | string

/**
 * List of valid node response types.
 */
const validTypes = ['buffer', 'array', 'uint8array', 'stream', ...textTypes]

/**
 * Node transport options.
 */
export interface Options {
  type?: Types
  unzip?: boolean
  jar?: any
  agent?: any
  maxRedirects?: number
  rejectUnauthorized?: boolean
  followRedirects?: boolean
  confirmRedirect?: (request: ClientRequest, response: IncomingMessage) => boolean
  ca?: string | Buffer | Array<string | Buffer>
  cert?: string | Buffer
  key?: string | Buffer
  maxBufferSize?: number
}

/**
 * Create a transport object.
 */
export function createTransport (options: Options) {
  return {
    use,
    abort,
    open (request: Request) {
      return handle(request, options)
    }
  }
}

/**
 * Default uses.
 */
const use = [stringify(), headers()]

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
function handle (request: Request, options: Options) {
  const { followRedirects, type, unzip, rejectUnauthorized, ca, key, cert, agent } = options
  const { url, method, body } = request
  const maxRedirects = num(options.maxRedirects, 5)
  const maxBufferSize = num(options.maxBufferSize, type === 'stream' ? Infinity : 2 * 1000 * 1000)
  const storeCookies = getStoreCookies(request, options)
  const attachCookies = getAttachCookies(request, options)
  const confirmRedirect = options.confirmRedirect || falsey
  let requestCount = 0

  if (type && validTypes.indexOf(type) === -1) {
    return Promise.reject(
      request.error(`Unsupported type: ${type}`, 'ETYPE')
    )
  }

  // Automatically enable unzipping.
  if (unzip !== false && request.get('Accept-Encoding') == null) {
    request.set('Accept-Encoding', 'gzip,deflate')
  }

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
          arg.agent = agent
          arg.rejectUnauthorized = rejectUnauthorized !== false
          arg.ca = ca
          arg.cert = cert
          arg.key = key

          const rawRequest = engine(arg)

          // Track upload/download progress through a stream.
          const requestStream = new PassThrough()
          const responseStream = new PassThrough()
          let uploadedBytes = 0
          let downloadedBytes = 0

          requestStream.on('data', function (chunk: Buffer) {
            uploadedBytes += chunk.length
            request.uploadedBytes = uploadedBytes
          })

          requestStream.on('end', function () {
            request.uploadedBytes = request.uploadLength = uploadedBytes
          })

          responseStream.on('data', function (chunk: Buffer) {
            downloadedBytes += chunk.length
            request.downloadedBytes = downloadedBytes

            // Abort on the max buffer size.
            if (downloadedBytes > maxBufferSize) {
              rawRequest.abort()
              responseStream.emit('error', request.error('Response too large', 'ETOOLARGE'))
            }
          })

          responseStream.on('end', function () {
            request.downloadedBytes = request.downloadLength = downloadedBytes
          })

          // Handle the HTTP response.
          function response (incomingMessage: IncomingMessage) {
            const { headers, rawHeaders, statusCode: status, statusMessage: statusText } = incomingMessage
            const redirect = REDIRECT_STATUS[status]

            // Handle HTTP redirects.
            if (followRedirects !== false && redirect != null && headers.location) {
              const newUrl = urlLib.resolve(url, headers.location)

              // Ignore the result of the response on redirect.
              incomingMessage.resume()

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
                if (confirmRedirect(rawRequest, incomingMessage)) {
                  return get(newUrl, method, body)
                }
              }
            }

            request.downloadLength = num(headers['content-length'], 0)
            incomingMessage.pipe(responseStream)

            return handleResponse(request, responseStream, headers, options)
              .then(function (body) {
                return new Response({
                  status,
                  headers,
                  statusText,
                  rawHeaders,
                  body,
                  url
                })
              })
          }

          // Emit a request error.
          function emitError (error: Error) {
            // Abort request on error.
            rawRequest.abort()
            reject(error)
          }

          rawRequest.on('response', function (message: IncomingMessage) {
            resolve(storeCookies(url, message.headers).then(() => response(message)))
          })

          rawRequest.on('error', function (error: Error) {
            emitError(request.error(`Unable to connect to "${url}"`, 'EUNAVAILABLE', error))
          })

          request._raw = rawRequest
          request.uploadLength = num(rawRequest.getHeader('content-length'), 0)
          requestStream.pipe(rawRequest)
          requestStream.on('error', emitError)

          // Pipe the body to the stream.
          if (body) {
            if (typeof body.pipe === 'function') {
              body.pipe(requestStream)
              body.on('error', emitError)
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
function abort (request: Request) {
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
function getAttachCookies (request: Request, options: Options): (url: string) => Promise<any> {
  const { jar } = options
  const cookie = request.get('Cookie')

  if (!jar) {
    return () => Promise.resolve()
  }

  return function (url: string) {
    return new Promise(function (resolve, reject) {
      request.set('Cookie', cookie)

      options.jar.getCookies(url, function (err: Error, cookies: Cookie[]) {
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
function getStoreCookies (request: Request, options: Options): (url: string, headers: { [key: string]: any }) => Promise<any> {
  const { jar } = options

  if (!jar) {
    return () => Promise.resolve()
  }

  return function (url, headers) {
    const cookies = arrify(headers['set-cookie'])

    if (!cookies.length) {
      return Promise.resolve()
    }

    const storeCookies = cookies.map(function (cookie) {
      return new Promise(function (resolve, reject) {
        jar.setCookie(cookie, url, { ignoreError: true }, function (err: Error) {
          return err ? reject(err) : resolve()
        })
      })
    })

    return Promise.all(storeCookies)
  }
}

/**
 * Handle the HTTP response body encoding.
 */
function handleResponse (
  request: Request,
  stream: PassThrough,
  headers: { [key: string]: any },
  options: Options
) {
  const type = options.type || 'text'
  const unzip = options.unzip !== false
  const isText = textTypes.indexOf(type) > -1

  const result = new Promise<any>((resolve, reject) => {
    if (unzip) {
      const enc = headers['content-encoding']

      if (enc === 'deflate' || enc === 'gzip') {
        const unzip = createUnzip()
        stream.pipe(unzip)
        stream.on('error', (err: Error) => unzip.emit('error', err))
        stream = unzip
      }
    }

    // Return the raw stream.
    if (type === 'stream') {
      return resolve(stream)
    }

    const encoding = isText ? 'string' : type
    const concatStream = concat({ encoding }, resolve)

    stream.on('error', reject)
    stream.pipe(concatStream)
  })

  // Manual intervention for JSON parsing.
  if (isText) {
    return result.then(str => parse(request, str, type))
  }

  return result
}
