import pump = require('pump')
import { resolve } from 'url'
import { CookieJar } from 'tough-cookie'
import { compose, Middleware, Composed } from 'throwback'
import { request as httpRequest, IncomingMessage, ClientRequest, Agent } from 'http'
import { request as httpsRequest, RequestOptions } from 'https'
import { connect as netConnect, Socket, SocketConnectOpts, AddressInfo } from 'net'
import { connect as tlsConnect, SecureContext, TLSSocket, ConnectionOptions as TlsConnectOpts } from 'tls'
import { connect as http2Connect, IncomingHttpHeaders, constants as h2constants, ClientHttp2Session } from 'http2'
import { PassThrough, Writable } from 'stream'
import { createUnzip } from 'zlib'
import { Request, Response, createHeaders, Headers, ResponseOptions, BodyCommon } from 'servie'
import { createBody, Body } from 'servie/dist/body/node'
import { PopsicleError } from '../error'
import { normalizeRequest, NormalizeRequestOptions } from '../common'

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
  process: Composed<T, U>,
  options: FollowRedirectsOptions = {}
): Composed<T, U> {
  return async function (initialRequest, done) {
    let req = initialRequest.clone()
    let redirectCount = 0
    const maxRedirects = typeof options.maxRedirects === 'number' ? options.maxRedirects : 5
    const confirmRedirect = options.confirmRedirect || (() => false)

    while (redirectCount++ < maxRedirects) {
      const res = await process(req as T, done)
      const redirect = REDIRECT_STATUS[res.statusCode]

      if (redirect === undefined || !res.headers.has('Location')) return res

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
      }

      return res
    }

    throw new PopsicleError(`Maximum redirects exceeded: ${maxRedirects}`, 'EMAXREDIRECTS', req)
  }
}

/**
 * Track HTTP connections for reuse.
 */
export class ConnectionManager <T> {

  connections = new Map<string, T>()

  get (key: string) {
    return this.connections.get(key)
  }

  set (key: string, connection: T) {
    if (this.connections.has(key)) throw new TypeError('Connection exists for key')
    this.connections.set(key, connection)
    return connection
  }

  delete (key: string, connection: T) {
    const existing = this.connections.get(key)
    if (existing !== connection) throw new TypeError('Connection for key does not match')
    this.connections.delete(key)
    return connection
  }

}

export interface ConcurrencyConnectionManagerOptions {
  maxConnections?: number
  maxFreeConnections?: number
}

export interface ConnectionSet <T> {
  used?: Set<T>
  free?: Set<T>
  pend?: Array<(connection?: T) => void>
}

/**
 * Manage HTTP connection reuse.
 */
export class ConcurrencyConnectionManager <T> extends ConnectionManager<ConnectionSet<T>> {

  maxConnections = Infinity
  maxFreeConnections = 256

  constructor (protected options: ConcurrencyConnectionManagerOptions = {}) {
    super()

    if (options.maxConnections) this.maxConnections = options.maxConnections
    if (options.maxFreeConnections) this.maxFreeConnections = options.maxFreeConnections
  }

  /**
   * Create a new connection.
   */
  ready (key: string, onReady: (existingConnection?: T) => void): void {
    const pool = this.get(key) || this.set(key, Object.create(null))

    // Reuse free connections first.
    if (pool.free) return onReady(this.getFreeConnection(key))

    // If no other connections exist, `onReady` immediately.
    if (!pool.used) return onReady()

    // Add to "pending" queue.
    if (pool.used.size >= this.maxConnections) {
      if (!pool.pend) pool.pend = []
      pool.pend.push(onReady)
      return
    }

    return onReady()
  }

  getUsedConnection (key: string): T | undefined {
    const pool = this.get(key)
    if (pool && pool.used) return pool.used.values().next().value
  }

  getFreeConnection (key: string): T | undefined {
    const pool = this.get(key)
    if (pool && pool.free) return pool.free.values().next().value
  }

  use (key: string, connection: T): void {
    const pool = this.get(key) || this.set(key, Object.create(null))
    if (pool.free) pool.free.delete(connection)
    if (!pool.used) pool.used = new Set()
    pool.used.add(connection)
  }

  freed (key: string, connection: T, discard: () => void): void {
    const pool = this.get(key) || this.set(key, Object.create(null))

    // Remove from any possible "used".
    if (pool.used) pool.used.delete(connection)

    // Immediately send for connection.
    if (pool.pend) {
      const onReady = pool.pend.shift()!
      onReady(connection)
      if (!pool.pend.length) delete pool.pend
    }

    // Add to "free" connections pool.
    if (!pool.free) pool.free = new Set()
    if (pool.free.size >= this.maxFreeConnections) return discard()
    pool.free.add(connection)
  }

  remove (key: string, connection: T): void {
    const pool = this.get(key)

    if (!pool) return

    if (pool.used && pool.used.has(connection)) {
      pool.used.delete(connection)
      if (!pool.used.size) delete pool.used
    }

    if (pool.free && pool.free.has(connection)) {
      pool.free.delete(connection)
      if (!pool.free.size) delete pool.free
    }

    if (!pool.free && !pool.used && !pool.pend) this.delete(key, pool)
  }

}

/**
 * Configure HTTP version negotiation.
 */
export enum NegotiateHttpVersion {
  HTTP1_ONLY,
  HTTP2_FOR_HTTPS,
  HTTP2_ONLY
}

/**
 * Node.js HTTP request options.
 */
export interface SendOptions {
  keepAlive?: number
  servername?: string
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

// Global connection caches.
const globalNetConnections = new ConcurrencyConnectionManager<Socket>()
const globalTlsConnections = new ConcurrencyConnectionManager<TLSSocket>()
const globalHttp2Connections = new ConnectionManager<ClientHttp2Session>()

/**
 * Execute HTTP request.
 */
function execHttp1 (
  req: Request,
  protocol: string,
  host: string,
  port: number,
  keepAlive: number,
  socket: Socket | TLSSocket
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
      createConnection: () => socket
    }

    const rawRequest = request(arg)
    const requestStream = new PassThrough()

    // Reuse HTTP connections where possible.
    if (keepAlive > 0) {
      rawRequest.shouldKeepAlive = true
      rawRequest.setHeader('Connection', 'keep-alive')
    }

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
        rawResponse.once('end', () => resolve(createHeaders(rawResponse.rawTrailers)))
      })

      // Replace request error listener behaviour.
      rawRequest.removeListener('error', onError)
      rawRequest.on('error', err => req.events.emit('error', err))

      const { address: localAddress, port: localPort } = rawRequest.connection.address() as AddressInfo
      const { address: remoteAddress, port: remotePort } = rawResponse.connection.address() as AddressInfo
      const res = new HttpResponse({ statusCode, statusMessage, headers, trailer, body, url, httpVersion })

      // Update request connection.
      req.connection = { localAddress, localPort, remoteAddress, remotePort, encrypted }

      // https://github.com/serviejs/servie#implementers
      res.started = true
      req.events.emit('response', res)

      // Track response progress.
      rawResponse.on('data', (chunk: Buffer) => res.bytesTransferred += chunk.length)
      rawResponse.once('end', () => {
        req.closed = true
        res.finished = true
      })

      return resolve(res)
    }

    rawRequest.once('error', onError)
    rawRequest.once('response', onResponse)

    // https://github.com/serviejs/servie#implementers
    req.started = true
    req.events.once('abort', () => {
      socket.emit('agentRemove') // `abort` destroys the connection with no event.
      rawRequest.abort()
    })

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
  client: ClientHttp2Session
): Promise<Http2Response> {
  return new Promise<Http2Response>((resolve, reject) => {
    // HTTP2 formatted headers.
    const headers = Object.assign(req.headers.asObject(false), {
      [h2constants.HTTP2_HEADER_METHOD]: req.method,
      [h2constants.HTTP2_HEADER_PATH]: req.Url.path
    })

    const http2Stream = client.request(headers, { endStream: false })
    const requestStream = new PassThrough()

    ref(client.socket) // Request ref tracking.

    // Track when stream finishes.
    function onClose () {
      req.closed = true
      unref(client.socket)
    }

    // Trigger unavailable error when node.js errors before response.
    function onError (err: Error) {
      return reject(new PopsicleError(`Unable to connect to ${host}:${port}`, 'EUNAVAILABLE', req, err))
    }

    function onResponse (headers: IncomingHttpHeaders) {
      const encrypted = (client.socket as TLSSocket).encrypted === true
      const { localAddress, localPort, remoteAddress, remotePort } = client.socket

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
      http2Stream.once('end', () => res.finished = true)

      return resolve(res)
    }

    http2Stream.once('error', onError)
    http2Stream.once('close', onClose)
    http2Stream.once('response', onResponse)

    // https://github.com/serviejs/servie#implementers
    req.started = true
    req.events.once('abort', () => http2Stream.destroy())

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
  const {
    keepAlive = 5000, // Default to keeping a connection open briefly.
    negotiateHttpVersion = NegotiateHttpVersion.HTTP2_FOR_HTTPS
  } = options

  // TODO: Allow configuration in options.
  const tlsConnections = globalTlsConnections
  const netConnections = globalNetConnections
  const http2Connections = globalHttp2Connections

  return function (req: Request): Promise<HttpResponse> {
    const { hostname, protocol } = req.Url
    const host = hostname || 'localhost'

    if (protocol === 'http:') {
      const port = Number(req.Url.port) || 80
      const connectionKey = `${host}:${port}:${negotiateHttpVersion}`

      // Use existing HTTP2 session in HTTP2 mode.
      if (negotiateHttpVersion === NegotiateHttpVersion.HTTP2_ONLY) {
        const existingSession = http2Connections.get(connectionKey)

        if (existingSession) return execHttp2(req, protocol, host, port, existingSession)
      }

      return new Promise<HttpResponse>((resolve) => {
        return netConnections.ready(connectionKey, (freeSocket) => {
          const socketOptions: SocketConnectOpts = { host, port }
          const socket = freeSocket || setupSocket(connectionKey, keepAlive, netConnections, netConnect(socketOptions))

          socket.ref()
          netConnections.use(connectionKey, socket)

          if (negotiateHttpVersion === NegotiateHttpVersion.HTTP2_ONLY) {
            const authority = `${protocol}//${host}:${port}`
            const client = manageHttp2(authority, connectionKey, keepAlive, http2Connections, socket)

            return resolve(execHttp2(req, protocol, host, port, client))
          }

          return resolve(execHttp1(req, protocol, host, port, keepAlive, socket))
        })
      })
    }

    // Optionally negotiate HTTP2 connection.
    if (protocol === 'https:') {
      const { ca, cert, key, secureProtocol, secureContext } = options
      const port = Number(req.Url.port) || 443
      const servername = options.servername || calculateServerName(host, req.headers.get('host'))
      const rejectUnauthorized = options.rejectUnauthorized !== false
      const connectionKey = `${host}:${port}:${negotiateHttpVersion}:${servername}:${rejectUnauthorized}:${ca || ''}:${cert || ''}:${key || ''}:${secureProtocol || ''}`

      // Use an existing TLS session to speed up handshake.
      const existingSocket = tlsConnections.getFreeConnection(connectionKey) || tlsConnections.getUsedConnection(connectionKey)
      const session = existingSocket ? existingSocket.getSession() : undefined

      const socketOptions: TlsConnectOpts = {
        host, port, servername, rejectUnauthorized, ca, cert, key,
        session, secureProtocol, secureContext
      }

      // Use any existing HTTP2 session.
      if (
        negotiateHttpVersion === NegotiateHttpVersion.HTTP2_ONLY ||
        negotiateHttpVersion === NegotiateHttpVersion.HTTP2_FOR_HTTPS
      ) {
        const existingSession = http2Connections.get(connectionKey)

        if (existingSession) return execHttp2(req, protocol, host, port, existingSession)
      }

      return new Promise<HttpResponse>((resolve, reject) => {
        // Set up ALPN protocols for connection negotiation.
        if (negotiateHttpVersion === NegotiateHttpVersion.HTTP2_ONLY) {
          socketOptions.ALPNProtocols = ['h2']
        } else if (negotiateHttpVersion === NegotiateHttpVersion.HTTP2_FOR_HTTPS) {
          socketOptions.ALPNProtocols = ['h2', 'http/1.1']
        }

        return tlsConnections.ready(connectionKey, (freeSocket) => {
          const socket = freeSocket || setupSocket(connectionKey, keepAlive, tlsConnections, tlsConnect(socketOptions))

          socket.ref()
          tlsConnections.use(connectionKey, socket)

          if (negotiateHttpVersion === NegotiateHttpVersion.HTTP1_ONLY) {
            return resolve(execHttp1(req, protocol, host, port, keepAlive, socket))
          }

          if (negotiateHttpVersion === NegotiateHttpVersion.HTTP2_ONLY) {
            const client = manageHttp2(`${protocol}//${host}:${port}`, connectionKey, keepAlive, http2Connections, socket)

            return resolve(execHttp2(req, protocol, host, port, client))
          }

          socket.once('secureConnect', () => {
            const alpnProtocol: string = (socket as any).alpnProtocol

            // Successfully negotiated HTTP2 connection.
            if (alpnProtocol === 'h2') {
              const existingClient = http2Connections.get(connectionKey)

              if (existingClient) {
                socket.destroy() // Destroy socket in case of TLS connection race.

                return resolve(execHttp2(req, protocol, host, port, existingClient))
              }

              const client = manageHttp2(`${protocol}//${host}:${port}`, connectionKey, keepAlive, http2Connections, socket)

              return resolve(execHttp2(req, protocol, host, port, client))
            }

            if (alpnProtocol === 'http/1.1') {
              return resolve(execHttp1(req, protocol, host, port, keepAlive, socket))
            }

            return reject(new PopsicleError('No ALPN protocol negotiated', 'EALPNPROTOCOL', req))
          })

          socket.once('error', (err) => {
            return reject(new PopsicleError(`Unable to connect to ${host}:${port}`, 'EUNAVAILABLE', req, err))
          })
        })
      })
    }

    return Promise.reject(
      new PopsicleError(`Unsupported URL protocol: ${req.Url.protocol}`, 'EPROTOCOL', req)
    )
  }
}

/**
 * Setup the socket with the connection manager.
 *
 * Ref: https://github.com/nodejs/node/blob/531b4bedcac14044f09129ffb65dab71cc2707d9/lib/_http_agent.js#L254
 */
function setupSocket <T extends Socket | TLSSocket> (
  key: string,
  keepAlive: number,
  manager: ConcurrencyConnectionManager<T>,
  socket: T
) {
  const onFree = () => {
    if (keepAlive > 0) {
      socket.setKeepAlive(true, keepAlive)
      socket.unref()
    }

    manager.freed(key, socket, () => socket.destroy())
  }

  const onClose = () => manager.remove(key, socket)

  const onRemove = () => {
    socket.removeListener('free', onFree)
    socket.removeListener('close', onClose)
    manager.remove(key, socket)
  }

  socket.on('free', onFree)
  socket.once('close', onClose)
  socket.once('agentRemove', onRemove)

  return socket
}

/**
 * Set up a HTTP2 working session.
 */
function manageHttp2 <T extends Socket | TLSSocket> (
  authority: string,
  key: string,
  keepAlive: number,
  manager: ConnectionManager<ClientHttp2Session>,
  socket: T
) {
  // TODO: Fix node.js types.
  const connectOptions: any = { createConnection: () => socket }
  const client = http2Connect(authority, connectOptions)

  manager.set(key, client)
  client.once('close', () => manager.delete(key, client))
  client.setTimeout(keepAlive, () => client.close())

  return client
}

/**
 * Track socket usage.
 */
const SOCKET_REFS = new WeakMap<Socket | TLSSocket, number>()

/**
 * Track socket refs.
 */
function ref (socket: Socket | TLSSocket) {
  const count = SOCKET_REFS.get(socket) || 0
  if (count === 0) socket.ref()
  SOCKET_REFS.set(socket, count + 1)
}

/**
 * Track socket unrefs and globally unref.
 */
function unref (socket: Socket | TLSSocket) {
  const count = SOCKET_REFS.get(socket)
  if (!count) return
  if (count === 1) {
    socket.unref()
    SOCKET_REFS.delete(socket)
    return
  }
  SOCKET_REFS.set(socket, count - 1)
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
  const fns: Array<Middleware<Request, HttpResponse>> = []
  const { jar = new CookieJar(), unzip = true, follow = true } = options

  // Built-in behaviours.
  fns.push(normalizeRequest(options))
  fns.push(normalizeUserAgent(options))

  if (unzip) fns.push(autoUnzip())
  if (jar) fns.push(getCookies({ jar }), saveCookies({ jar }))

  const done = send(options)
  const middleware = follow ? followRedirects(compose(fns), options) : compose(fns)

  return (req: Request) => middleware(req, done)
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
