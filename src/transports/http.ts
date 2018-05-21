import pump = require('pump')
import { CookieJar } from 'tough-cookie'
import { compose, Middleware } from 'throwback'
import { request as httpRequest, IncomingMessage, ClientRequest, Agent } from 'http'
import { request as httpsRequest, RequestOptions } from 'https'
import { PassThrough } from 'stream'
import { createUnzip } from 'zlib'
import { Request, Response, createHeaders, Headers, ResponseOptions } from 'servie'
import { createBody, Body } from 'servie/dist/body/node'
import { parse } from 'url'
import { PopsicleError } from '../error'
import { followRedirects, FollowRedirectsOptions, normalizeRequest } from '../common'

/**
 * Extend response with URL.
 */
export interface HttpResponseOptions extends ResponseOptions {
  body: Body
}

/**
 * HTTP responses implement a node.js body.
 */
export class HttpResponse extends Response implements HttpResponseOptions {

  body: Body

  constructor (options: HttpResponseOptions) {
    super(options)
    this.body = options.body
  }

}

/**
 * Cookie middleware configuration.
 */
export interface CookieOptions {
  jar: CookieJar
}

/**
 * Read cookies from the cookie jar.
 */
export function getCookies <T extends Request, U extends Response> (options: CookieOptions): Middleware<T, U> {
  return function (req, next) {
    const prevCookies = req.headers.getAll('Cookie').join('; ')

    return new Promise<U>((resolve, reject) => {
      options.jar.getCookieString(req.url, (err: Error | null, cookies: string) => {
        if (err) return reject(err)

        if (cookies) {
          req.headers.set('Cookie', prevCookies ? `${prevCookies}; ${cookies}` : cookies)
        }

        return resolve(next())
      })
    })
  }
}

/**
 * Save response cookies into the cookie jar.
 */
export function saveCookies <T extends Request, U extends Response> (options: CookieOptions): Middleware<T, U> {
  return async function (req, next) {
    const res = await next()
    const cookies = res.headers.getAll('set-cookie')

    if (cookies.length) {
      await Promise.all(cookies.map(function (cookie) {
        return new Promise<void>(function (resolve, reject) {
          options.jar.setCookie(
            cookie,
            req.url,
            { ignoreError: true },
            (err: Error | null) => err ? reject(err) : resolve()
          )
        })
      }))
    }

    return res
  }
}

/**
 * Automatically support decoding zipped responses.
 */
export function autoUnzip <T extends Request, U extends HttpResponse> (): Middleware<T, U> {
  return async function (req, next) {
    if (!req.headers.has('Accept-Encoding')) {
      req.headers.set('Accept-Encoding', 'gzip,deflate')
    }

    const res = await next()
    const enc = res.headers.get('Content-Encoding')

    // Unzip body automatically when response is encoded.
    if (enc === 'deflate' || enc === 'gzip') {
      res.body = createBody(pump(res.body.stream(), createUnzip()), { headers: [] })
    }

    return res
  }
}

/**
 * Set default user-agent in node.js.
 */
export function normalizeUserAgent <T extends Request, U extends Response> (): Middleware<T, U> {
  return function (req, next) {
    if (!req.headers.has('User-Agent')) {
      req.headers.set('User-Agent', 'Popsicle (https://github.com/blakeembrey/popsicle)')
    }

    return next()
  }
}

/**
 * Node.js HTTP request options.
 */
export interface SendOptions {
  agent?: Agent
  rejectUnauthorized?: boolean
  ca?: string | Buffer | Array<string | Buffer>
  cert?: string | Buffer
  key?: string | Buffer
  secureProtocol?: string
}

/**
 * Function to execute HTTP request.
 */
export function send (options: SendOptions) {
  return function (req: Request): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve, reject) => {
      const { body } = req
      const arg: RequestOptions = parse(req.url)
      const encrypted = arg.protocol === 'https:'
      const engine: typeof httpRequest = encrypted ? httpsRequest : httpRequest

      // Attach request options.
      arg.method = req.method
      arg.headers = req.headers.asObject(false)
      arg.agent = options.agent
      arg.rejectUnauthorized = options.rejectUnauthorized !== false
      arg.ca = options.ca
      arg.cert = options.cert
      arg.key = options.key
      arg.secureProtocol = options.secureProtocol

      const rawRequest = engine(arg)
      const requestStream = new PassThrough()

      // Trigger unavailable error when node.js errors before response.
      function onError (err: Error) {
        reject(new PopsicleError('Unable to connect', 'EUNAVAILABLE', req, err))
      }

      // Track the node.js response.
      function onResponse (rawResponse: IncomingMessage) {
        const { statusCode, statusMessage } = rawResponse
        const headers = createHeaders(rawResponse.rawHeaders)
        const body = createBody(pump(rawResponse, new PassThrough()))

        // Trailers are populated on "end".
        const trailer = new Promise<Headers>(resolve => {
          rawResponse.on('end', () => resolve(createHeaders(rawResponse.rawTrailers)))
        })

        // Replace request error listener behaviour.
        rawRequest.removeListener('error', onError)
        rawRequest.on('error', err => req.events.emit('error', err))

        const { address: localAddress, port: localPort } = rawRequest.connection.address()
        const { address: remoteAddress, port: remotePort } = rawResponse.connection.address()
        const res = new HttpResponse({ statusCode, statusMessage, headers, trailer, body })

        // Update request connection.
        req.connection = { localAddress, localPort, remoteAddress, remotePort, encrypted }

        // https://github.com/serviejs/servie#implementers
        res.started = true
        req.events.emit('response', res)

        // Track response progress.
        rawResponse.on('data', (chunk: Buffer) => {
          res.bytesTransferred += chunk.length
        })

        rawResponse.on('end', () => res.finished = true)
        rawResponse.on('close', () => req.closed = true)

        return resolve(res)
      }

      // Track request upload progress.
      requestStream.on('data', (chunk: Buffer) => {
        req.bytesTransferred += chunk.length
      })

      // Listen for connection errors.
      rawRequest.once('error', onError)
      rawRequest.once('response', onResponse)

      // https://github.com/serviejs/servie#implementers
      req.started = true
      req.events.on('abort', () => rawRequest.abort())

      // Pump request body into HTTP request object.
      pump(requestStream, rawRequest, () => req.finished = true)

      // Pipe the body to the stream.
      if (body instanceof Body) {
        if (body.buffered) {
          body.buffer().then(x => requestStream.end(x), reject)
        } else {
          pump(body.stream(), requestStream)
        }
      } else {
        body.arrayBuffer().then(x => requestStream.end(Buffer.from(x)), reject)
      }
    })
  }
}

/**
 * Node.js HTTP transport configuration.
 */
export interface TransportOptions extends SendOptions, FollowRedirectsOptions, SendOptions {
  jar?: CookieJar
  unzip?: boolean
  follow?: boolean
}

/**
 * Create a request transport using node.js `http` libraries.
 */
export function transport (options: TransportOptions = {}) {
  const fns: Array<Middleware<Request, HttpResponse>> = [normalizeRequest(), normalizeUserAgent()]
  const { jar, unzip = true, follow = true } = options

  if (unzip) fns.push(autoUnzip())
  if (follow) fns.push(followRedirects(options))
  if (jar) fns.push(getCookies({ jar }), saveCookies({ jar }))

  const done = send(options)
  const middlware = compose<Request, HttpResponse>(fns)

  return (req: Request) => middlware(req, done)
}
