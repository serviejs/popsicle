import pump = require('pump')
import { CookieJar } from 'tough-cookie'
import { compose, Middleware } from 'throwback'
import { request as httpRequest, IncomingMessage, ClientRequest, Agent } from 'http'
import { request as httpsRequest, RequestOptions } from 'https'
import { connect as netConnect, Socket, NetConnectOpts } from 'net'
import { connect as tlsConnect, SecureContext, TLSSocket, ConnectionOptions as TlsConnectOpts } from 'tls'
import { connect as http2Connect, IncomingHttpHeaders, constants as h2constants } from 'http2'
import { PassThrough, Writable } from 'stream'
import { createUnzip } from 'zlib'
import { Request, Response, createHeaders, Headers, ResponseOptions, BodyCommon } from 'servie'
import { createBody, Body } from 'servie/dist/body/node'
import { PopsicleError } from '../error'
import { followRedirects, FollowRedirectsOptions, normalizeRequest, NormalizeRequestOptions } from '../common'

/**
 * Extend response with URL.
 */
export interface HttpResponseOptions extends ResponseOptions {
  url: string
  body: Body
  httpVersion: string
}

/**
 * HTTP responses implement a node.js body.
 */
export class HttpResponse extends Response implements HttpResponseOptions {

  url: string
  body: Body
  httpVersion: string

  constructor (options: HttpResponseOptions) {
    super(options)
    this.url = options.url
    this.body = options.body
    this.httpVersion = options.httpVersion
  }

}

export class Http2Response extends HttpResponse {
  // TODO: Add HTTP2 features.
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
 * Override the default user-agent header.
 */
export interface NormalizeUserAgentOptions {
  userAgent?: string
}

/**
 * Set default user-agent in node.js.
 */
export function normalizeUserAgent <T extends Request, U extends Response> (
  options: NormalizeUserAgentOptions = {}
): Middleware<T, U> {
  const userAgent = options.userAgent || 'Popsicle (https://github.com/serviejs/popsicle)'

  return function (req, next) {
    if (!req.headers.has('User-Agent')) req.headers.set('User-Agent', userAgent)

    return next()
  }
}

export enum NegotiateHttpVersion {
  HTTP1_ONLY,
  HTTP2_FOR_HTTPS,
  HTTP2_ONLY
}

/**
 * Node.js HTTP request options.
 */
export interface SendOptions {
  rejectUnauthorized?: boolean
  ca?: string | Buffer | Array<string | Buffer>
  cert?: string | Buffer
  key?: string | Buffer
  agent?: Agent
  secureContext?: SecureContext
  secureProtocol?: string
  negotiateHttpVersion?: NegotiateHttpVersion
}

/**
 * Write Servie body object to node.js stream.
 */
function sendBody (body: BodyCommon, stream: Writable, onError: (err: Error) => void) {
  // Pipe the body to the stream.
  if (body instanceof Body) {
    if (body.buffered) {
      body.buffer().then(x => stream.end(x), onError)
    } else {
      pump(body.stream(), stream)
    }
  } else {
    body.arrayBuffer().then(x => stream.end(Buffer.from(x)), onError)
  }
}

/**
 * Execute HTTP request.
 */
function execHttp (
  req: Request,
  protocol: string,
  host: string,
  port: number,
  socket: Socket | TLSSocket,
  agent?: Agent
): Promise<HttpResponse> {
  return new Promise<HttpResponse>((resolve, reject) => {
    const { url, body, Url } = req
    const encrypted = Url.protocol === 'https:'
    const request: typeof httpRequest = encrypted ? httpsRequest : httpRequest

    const arg: RequestOptions = {
      protocol,
      host,
      port,
      method: req.method,
      path: Url.path,
      headers: req.headers.asObject(false),
      auth: Url.auth,
      agent,
      createConnection: () => socket
    }

    const rawRequest = request(arg)
    const requestStream = new PassThrough()

    // Trigger unavailable error when node.js errors before response.
    function onError (err: Error) {
      return reject(new PopsicleError(`Unable to connect to ${host}:${port}`, 'EUNAVAILABLE', req, err))
    }

    // Track the node.js response.
    function onResponse (rawResponse: IncomingMessage) {
      const { statusCode, statusMessage, httpVersion } = rawResponse
      const headers = createHeaders(rawResponse.rawHeaders)
      const body = createBody(pump(rawResponse, new PassThrough()), { headers: {} })

      // Trailers are populated on "end".
      const trailer = new Promise<Headers>(resolve => {
        rawResponse.on('end', () => resolve(createHeaders(rawResponse.rawTrailers)))
      })

      // Replace request error listener behaviour.
      rawRequest.removeListener('error', onError)
      rawRequest.on('error', err => req.events.emit('error', err))

      const { address: localAddress, port: localPort } = rawRequest.connection.address()
      const { address: remoteAddress, port: remotePort } = rawResponse.connection.address()
      const res = new HttpResponse({ statusCode, statusMessage, headers, trailer, body, url, httpVersion })

      // Update request connection.
      req.connection = { localAddress, localPort, remoteAddress, remotePort, encrypted }

      // https://github.com/serviejs/servie#implementers
      res.started = true
      req.events.emit('response', res)

      // Track response progress.
      rawResponse.on('data', (chunk: Buffer) => res.bytesTransferred += chunk.length)
      rawResponse.on('end', () => res.finished = true)
      rawResponse.on('close', () => req.closed = true)

      return resolve(res)
    }

    rawRequest.once('error', onError)
    rawRequest.once('response', onResponse)

    // https://github.com/serviejs/servie#implementers
    req.started = true
    req.events.on('abort', () => rawRequest.abort())

    // Track request upload progress.
    requestStream.on('data', (chunk: Buffer) => req.bytesTransferred += chunk.length)
    pump(requestStream, rawRequest, () => req.finished = true)

    return sendBody(body, requestStream, reject)
  })
}

/**
 * Execute a HTTP2 connection.
 */
function execHttp2 (
  req: Request,
  protocol: string,
  host: string,
  port: number,
  socket: TLSSocket | Socket
): Promise<Http2Response> {
  return new Promise<Http2Response>((resolve, reject) => {
    // HTTP2 formatted headers.
    const headers = Object.assign(req.headers.asObject(false), {
      [h2constants.HTTP2_HEADER_METHOD]: req.method,
      [h2constants.HTTP2_HEADER_PATH]: req.Url.path
    })

    // TODO: Fix node.js types.
    const connectOptions: any = {
      createConnection: () => socket
    }

    const authority = `${protocol}//${host}:${port}`
    const client = http2Connect(authority, connectOptions)
    const http2Stream = client.request(headers, { endStream: false })
    const requestStream = new PassThrough()

    // Trigger unavailable error when node.js errors before response.
    function onError (err: Error) {
      return reject(new PopsicleError(`Unable to connect to ${host}:${port}`, 'EUNAVAILABLE', req, err))
    }

    function onResponse (headers: IncomingHttpHeaders) {
      const encrypted = (socket as TLSSocket).encrypted === true
      const { localAddress, localPort, remoteAddress, remotePort } = socket

      // Replace request error listener behaviour with proxy.
      http2Stream.removeListener('error', onError)
      http2Stream.on('error', err => req.events.emit('error', err))

      const res = new Http2Response({
        statusCode: Number(headers[h2constants.HTTP2_HEADER_STATUS]),
        url: req.url,
        httpVersion: '2.0',
        headers: createHeaders(headers),
        body: createBody(pump(http2Stream, new PassThrough()), { headers: {} })
      })

      // https://github.com/serviejs/servie#implementers
      res.started = true
      req.connection = { localAddress, localPort, remoteAddress, remotePort, encrypted }

      // Track response progress.
      http2Stream.on('data', (chunk: Buffer) => res.bytesTransferred += chunk.length)

      // Close HTTP2 session when request ends.
      http2Stream.on('end', () => {
        req.closed = true
        res.finished = true
        ;(client as any).close()
      })

      return resolve(res)
    }

    client.once('error', onError)
    http2Stream.once('error', onError)
    http2Stream.once('response', onResponse)

    // https://github.com/serviejs/servie#implementers
    req.started = true
    req.events.on('abort', () => http2Stream.destroy())

    // Track request upload progress.
    requestStream.on('data', (chunk: Buffer) => req.bytesTransferred += chunk.length)
    pump(requestStream, http2Stream, () => req.finished = true)

    return sendBody(req.body, requestStream, reject)
  })
}

/**
 * Function to execute HTTP request.
 */
export function send (options: SendOptions) {
  // Mirror common browser behaviour by default.
  const { negotiateHttpVersion = NegotiateHttpVersion.HTTP2_FOR_HTTPS } = options

  return function (req: Request): Promise<HttpResponse> {
    const { hostname, protocol } = req.Url
    const host = hostname || 'localhost'

    if (protocol === 'http:') {
      const port = Number(req.Url.port) || 80
      const socketOptions: NetConnectOpts = { host, port }

      if (negotiateHttpVersion === NegotiateHttpVersion.HTTP2_ONLY) {
        return execHttp2(req, protocol, host, port, netConnect(socketOptions))
      }

      return execHttp(req, protocol, host, port, netConnect(socketOptions), options.agent)
    }

    // Optionally negotiate HTTP2 connection.
    if (protocol === 'https:') {
      const port = Number(req.Url.port) || 443

      const socketOptions: TlsConnectOpts = {
        host,
        port,
        servername: calculateServerName(host, req.headers.get('host')),
        rejectUnauthorized: options.rejectUnauthorized !== false,
        ca: options.ca,
        cert: options.cert,
        key: options.key,
        secureProtocol: options.secureProtocol,
        secureContext: options.secureContext
      }

      if (negotiateHttpVersion === NegotiateHttpVersion.HTTP1_ONLY) {
        return execHttp(req, protocol, host, port, tlsConnect(socketOptions), options.agent)
      }

      if (negotiateHttpVersion === NegotiateHttpVersion.HTTP2_ONLY) {
        socketOptions.ALPNProtocols = ['h2'] // Only requesting HTTP2 support.
        return execHttp2(req, protocol, host, port, tlsConnect(socketOptions))
      }

      return new Promise<HttpResponse>((resolve, reject) => {
        socketOptions.ALPNProtocols = ['h2', 'http/1.1'] // Request HTTP2 or HTTP1.
        const socket = tlsConnect(socketOptions)

        socket.once('secureConnect', () => {
          const alpnProtocol: string = (socket as any).alpnProtocol

          // Successfully negotiated HTTP2 connection.
          if (alpnProtocol === 'h2') {
            return resolve(execHttp2(req, protocol, host, port, socket))
          }

          if (alpnProtocol === 'http/1.1') {
            return resolve(execHttp(req, protocol, host, port, socket, options.agent))
          }

          return reject(new PopsicleError('No ALPN protocol negotiated', 'EALPNPROTOCOL', req))
        })

        socket.once('error', (err) => {
          return reject(new PopsicleError(`Unable to connect to ${host}:${port}`, 'EUNAVAILABLE', req, err))
        })
      })
    }

    return Promise.reject(
      new PopsicleError(`Unsupported URL protocol: ${req.Url.protocol}`, 'EPROTOCOL', req)
    )
  }
}

/**
 * Node.js HTTP transport configuration.
 */
export interface TransportOptions extends SendOptions,
  FollowRedirectsOptions,
  SendOptions,
  NormalizeRequestOptions,
  NormalizeUserAgentOptions {
  jar?: CookieJar | false
  unzip?: false
  follow?: false
}

/**
 * Create a request transport using node.js `http` libraries.
 */
export function transport (options: TransportOptions = {}) {
  const fns: Array<Middleware<Request, HttpResponse>> = [normalizeRequest(options), normalizeUserAgent(options)]
  const { jar = new CookieJar(), unzip = true, follow = true } = options

  if (unzip) fns.push(autoUnzip())
  if (follow) fns.push(followRedirects(options))
  if (jar) fns.push(getCookies({ jar }), saveCookies({ jar }))

  const done = send(options)
  const middlware = compose<Request, HttpResponse>(fns)

  return (req: Request) => middlware(req, done)
}

/**
 * Ref: https://github.com/nodejs/node/blob/5823938d156f4eb6dc718746afbf58f1150f70fb/lib/_http_agent.js#L231
 */
function calculateServerName (host: string, hostHeader?: string) {
  if (!hostHeader) return host
  if (hostHeader.charAt(0) === '[') {
    const index = hostHeader.indexOf(']')
    if (index === -1) return hostHeader
    return hostHeader.substr(1, index - 1)
  }
  return hostHeader.split(':', 1)[0]
}
