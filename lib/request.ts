import arrify = require('arrify')
import extend = require('xtend')
import Promise = require('native-or-bluebird')
import Base, { BaseOptions, Headers } from './base'
import Response, { ResponseOptions } from './response'
import PopsicleError from './error'

export interface DefaultsOptions extends BaseOptions {
  url?: string
  method?: string
  timeout?: number
  body?: any
  options?: any
  use?: Middleware[]
  transport?: TransportOptions
}

export interface RequestOptions extends DefaultsOptions {
  url: string
}

export interface RequestJSON {
  url: string
  headers: Headers
  body: any
  timeout: number
  options: any
  method: string
}

export interface TransportOptions {
  open: OpenHandler
  abort?: AbortHandler
  use?: Middleware[]
}

export type Middleware = (request?: Request) => any

export type RequestPluginFunction = (request?: Request) => any
export type ResponsePluginFunction = (response?: Response) => any

export type OpenHandler = (request: Request) => Promise<ResponseOptions>
export type AbortHandler = (request: Request) => any

export default class Request extends Base implements Promise<Response> {
  method: string
  timeout: number
  body: any
  options: any
  response: Response
  raw: any
  errored: PopsicleError
  transport: TransportOptions

  aborted = false
  timedout = false
  opened = false
  started = false

  uploadLength: number = null
  downloadLength: number = null
  private _uploadedBytes: number = null
  private _downloadedBytes: number = null

  private _promise: Promise<Response>

  private _before: Function[] = []
  private _after: Function[] = []
  private _always: Function[] = []
  private _progress: Function[] = []

  constructor (options: RequestOptions) {
    super(options)

    this.timeout = Number(options.timeout) || 0
    this.method = (options.method || 'GET').toUpperCase()
    this.body = options.body
    this.options = extend(options.options)

    // Start resolving the promise interally on the next tick.
    // This allows time for the plugins to be #use'd.
    this._promise = new Promise((resolve, reject) => {
      process.nextTick(() => start(this).then(resolve, reject))
    })

    // Extend to avoid mutations of the transport object.
    this.transport = extend(options.transport)

    // Automatically `use` default middleware functions.
    this.use(options.use || this.transport.use)

    this.always(removeListeners)
  }

  use (fn: Middleware | Middleware[]) {
    arrify(fn).forEach((fn) => fn(this))

    return this
  }

  error (message: string, code: string, original?: Error): PopsicleError {
    return new PopsicleError(message, code, original, this)
  }

  then (onFulfilled: (response?: Response) => any, onRejected?: (error?: PopsicleError) => any) {
    return this._promise.then(onFulfilled, onRejected)
  }

  catch (onRejected: (error?: PopsicleError) => any) {
    return this.then(null, onRejected)
  }

  exec (cb: (err: PopsicleError, response?: Response) => any) {
    this.then(function (response) {
      cb(null, response)
    }).catch(cb)
  }

  toJSON (): RequestJSON {
    return {
      url: this.fullUrl(),
      headers: this.get(),
      body: this.body,
      options: this.options,
      timeout: this.timeout,
      method: this.method
    }
  }

  progress (fn: RequestPluginFunction) {
    return pluginFunction(this, '_progress', fn)
  }

  before (fn: RequestPluginFunction) {
    return pluginFunction(this, '_before', fn)
  }

  after (fn: ResponsePluginFunction) {
    return pluginFunction(this, '_after', fn)
  }

  always (fn: RequestPluginFunction) {
    return pluginFunction(this, '_always', fn)
  }

  abort () {
    if (this.completed === 1 || this.aborted) {
      return this
    }

    this.aborted = true
    this.errored = this.errored || this.error('Request aborted', 'EABORT')

    // Sometimes it's just not possible to abort.
    if (this.opened) {
      // Emit a final progress event.
      emitProgress(this)
      this._progress = null

      if (this.transport.abort) {
        this.transport.abort(this)
      }
    }

    return this
  }

  get uploaded () {
    return this.uploadLength ? this.uploadedBytes / this.uploadLength : 0
  }

  get downloaded () {
    return this.downloadLength ? this.downloadedBytes / this.downloadLength : 0
  }

  get completed () {
    return (this.uploaded + this.downloaded) / 2
  }

  get completedBytes () {
    return this.uploadedBytes + this.downloadedBytes
  }

  get totalBytes () {
    return this.uploadLength + this.downloadLength
  }

  get uploadedBytes () {
    return this._uploadedBytes
  }

  set uploadedBytes (bytes: number) {
    if (bytes !== this._uploadedBytes) {
      this._uploadedBytes = bytes

      emitProgress(this)
    }
  }

  get downloadedBytes () {
    return this._downloadedBytes
  }

  set downloadedBytes (bytes: number) {
    if (bytes !== this._downloadedBytes) {
      this._downloadedBytes = bytes

      emitProgress(this)
    }
  }

}

/**
 * Attach plugin functions to the request object.
 */
function pluginFunction (request: Request, property: string, fn: Function) {
  if (request.started) {
    throw new TypeError('Plugins can not be used after the request has started')
  }

  if (typeof fn !== 'function') {
    throw new TypeError(`Expected a function, but got ${fn} instead`)
  }

  (<any> request)[property].push(fn)

  return request
}

/**
 * Start the HTTP request.
 */
function start (request: Request) {
  const req = <any> request
  const { timeout } = request
  const url = request.fullUrl()
  let timer: any

  request.started = true

  if (request.errored) {
    return Promise.reject(request.errored)
  }

  // Catch URLs that will cause the request to hang indefinitely in
  // CORS disabled environments. E.g. Atom Editor.
  if (/^https?\:\/*(?:[~#\\\?;\:]|$)/.test(url)) {
    return Promise.reject(request.error(`Refused to connect to invalid URL "${url}"`, 'EINVALID'))
  }

  return chain(req._before, request)
    .then(function () {
      if (request.errored) {
        return Promise.reject(request.errored)
      }

      if (timeout) {
        timer = setTimeout(function () {
          const error = request.error(`Timeout of ${request.timeout}ms exceeded`, 'ETIMEOUT')

          request.errored = error
          request.timedout = true
          request.abort()
        }, timeout)
      }

      req.opened = true

      return req.transport.open(request)
    })
    .then(function (options: ResponseOptions) {
      if (request.errored) {
        return Promise.reject(request.errored)
      }

      const response = new Response(options)

      response.request = request
      request.response = response

      return response
    })
    .then(function (response) {
      return chain(req._after, response)
    })
    .then(
      function () {
        return chain(req._always, request).then(() => request.response)
      },
      function (error: any) {
        return chain(req._always, request).then(() => Promise.reject(request.errored || error))
      }
    )
    .then(function (response) {
      // Check if the request has errored before the end.
      if (request.errored) {
        return Promise.reject(request.errored)
      }

      return response
    })
}

/**
 * Chain an array of promises sequentially.
 */
function chain (fns: Function[], arg: any) {
  return fns.reduce(function (p, fn) {
    return p.then(() => fn(arg))
  }, Promise.resolve())
}

/**
 * Remove all plugin functions.
 */
function removeListeners (request: Request) {
  ;(<any> request)._before = null
  ;(<any> request)._after = null
  ;(<any> request)._always = null
  ;(<any> request)._progress = null
}

/**
 * Emit a request progress event (upload or download).
 */
function emitProgress (request: Request) {
  const fns = (<any> request)._progress

  if (!fns || request.errored) {
    return
  }

  try {
    for (let fn of fns) {
      fn(request)
    }
  } catch (err) {
    request.errored = err
    request.abort()
  }
}
