import { request as httpRequest, IncomingMessage } from 'http'
import { request as httpsRequest } from 'https'
import agent = require('infinity-agent')
import through2 = require('through2')
import urlLib = require('url')
import extend = require('xtend')
import { http as getHeaders } from 'get-headers'
import Promise = require('native-or-bluebird')
import { Headers } from './base'
import Request from './request'
import Response from './response'
import { defaults, Popsicle } from './common'
import { defaults as use } from './plugins/index'

/**
 * Export default instance with node transportation layer.
 */
export = defaults({
  transport: { open, abort, use }
})


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
function open (request: Request) {
  return new Promise(function (resolve, reject) {
    const maxRedirects = num(request.options.maxRedirects, 5)
    const followRedirects = request.options.followRedirects !== false
    let requestCount = 0

    const confirmRedirect = typeof request.options.followRedirects === 'function' ?
      request.options.followRedirects : falsey

    // Track upload progress through a stream.
    const requestProxy = through2(function (chunk, enc, cb) {
      request.uploadedBytes = request.uploadedBytes + chunk.length
      this.push(chunk)
      cb()
    }, function (cb) {
      request.uploadedBytes = request.uploadLength
      cb()
    })

    // Track download progress through a stream.
    const responseProxy = through2(function (chunk, enc, cb) {
      request.downloadedBytes = request.downloadedBytes + chunk.length
      this.push(chunk)
      cb()
    }, function (cb) {
      request.downloadedBytes = request.downloadLength
      cb()
    })

    /**
     * Create the HTTP request.
     */
    function get (url: string, opts?: any, body?: any) {
      // Check redirection count before executing request.
      if (requestCount++ > maxRedirects) {
        reject(request.error(`Exceeded maximum of ${maxRedirects} redirects`, 'EMAXREDIRECTS'))
        return
      }

      const arg: any = extend(urlLib.parse(url), opts)
      const isHttp = arg.protocol !== 'https:'
      const engine: typeof httpRequest = isHttp ? httpRequest : httpsRequest

      // Always attach certain options.
      arg.agent = request.options.agent || (isHttp ? agent.http.globalAgent : agent.https.globalAgent)
      arg.rejectUnauthorized = request.options.rejectUnauthorized !== false

      const req = engine(arg)

      req.once('response', function (res: IncomingMessage) {
        const status = res.statusCode
        const redirect = REDIRECT_STATUS[status]

        // Handle HTTP redirects.
        if (followRedirects && redirect != null && res.headers.location) {
          const newUrl = urlLib.resolve(url, res.headers.location)

          res.resume()

          if (redirect === REDIRECT_TYPE.FOLLOW_WITH_GET) {
            get(newUrl, { method: 'GET' })
            return
          }

          if (redirect === REDIRECT_TYPE.FOLLOW_WITH_CONFIRMATION) {
            // Following HTTP spec by automatically redirecting with GET/HEAD.
            if (arg.method === 'GET' || arg.method === 'HEAD') {
              get(newUrl, opts, body)
              return
            }

            // Allow the user to confirm redirect according to HTTP spec.
            if (confirmRedirect(req, res)) {
              get(newUrl, opts, body)
              return
            }
          }
        }

        request.downloadLength = num(res.headers['content-length'], 0)

        // Track download progress.
        res.pipe(responseProxy)

        return resolve({
          body: responseProxy,
          status: status,
          headers: getHeaders(res),
          url: url
        })
      })

      // io.js has an abort event instead of "error".
      req.once('abort', function () {
        return reject(request.error('Request aborted', 'EABORT'))
      })

      req.once('error', function (error: Error) {
        return reject(request.error(`Unable to connect to "${url}"`, 'EUNAVAILABLE', error))
      })

      // Node 0.10 needs to catch errors on the request proxy.
      requestProxy.once('error', reject)

      request.raw = req
      request.uploadLength = num(req.getHeader('content-length'), 0)
      requestProxy.pipe(req)

      // Pipe the body to the stream.
      if (body) {
        if (typeof body.pipe === 'function') {
          body.pipe(requestProxy)
        } else {
          requestProxy.end(body)
        }
      } else {
        requestProxy.end()
      }
    }

    get(request.fullUrl(), {
      headers: request.get(),
      method: request.method
    }, request.body)
  })
}

/**
 * Close the current HTTP request.
 */
function abort (request: Request) {
  request.raw.abort()
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
