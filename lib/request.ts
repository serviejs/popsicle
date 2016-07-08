import arrify = require('arrify')
import extend = require('xtend')
import Promise = require('any-promise')
import { compose } from 'throwback'
import Base, { BaseOptions, Headers } from './base'
import Response, { ResponseOptions } from './response'
import PopsicleError from './error'

export interface DefaultsOptions <T extends Response> extends BaseOptions {
  url?: string
  method?: string
  timeout?: number
  body?: any
  options?: any
  use?: Middleware[]
  progress?: ProgressFunction[]
  transport?: TransportOptions<T>
}

export interface RequestOptions <T extends Response> extends DefaultsOptions<T> {
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

export interface TransportOptions <T extends Response> {
  open: (request: Request<T>) => Promise<T>
  abort?: (request: Request<T>) => any
  use?: Middleware[]
}

export type Middleware = (request: Request<any>, next: () => Promise<Response>) => Response | Promise<Response>
export type ProgressFunction = (request: Request<any>) => any

export default class Request <T extends Response> extends Base implements Promise<T> {
  method: string
  timeout: number
  body: any
  options: any
  transport: TransportOptions<T>
  middleware: Middleware[] = []

  opened = false
  aborted = false
  uploadLength: number = null
  downloadLength: number = null
  private _uploadedBytes: number = null
  private _downloadedBytes: number = null

  _raw: any
  _progress: ProgressFunction[] = []

  private _promise: Promise<Response>
  private _resolve: (response: Response) => void
  private _reject: (error: Error) => void

  constructor (options: RequestOptions<T>) {
    super(options)

    this.timeout = (options.timeout | 0)
    this.method = (options.method || 'GET').toUpperCase()
    this.body = options.body
    this.options = extend(options.options)

    // Internal promise representation.
    const promised = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })

    // External promise representation, resolves _after_ middleware.
    this._promise = new Promise((resolve) => {
      process.nextTick(() => {
        const handle = compose(this.middleware)

        const cb = () => {
          this._handle()
          return promised
        }

        return resolve(handle(this, cb))
      })
    })

    // Extend to avoid mutations of the transport object.
    this.transport = extend(options.transport)

    // Automatically `use` default middleware functions.
    this.use(options.use || this.transport.use)
    this.progress(options.progress)
  }

  error (message: string, code: string, original?: Error): PopsicleError {
    return new PopsicleError(message, code, original, this)
  }

  then (onFulfilled: (response?: T) => any, onRejected?: (error?: PopsicleError) => any) {
    return this._promise.then(onFulfilled, onRejected)
  }

  catch (onRejected: (error?: PopsicleError) => any) {
    return this._promise.then(null, onRejected)
  }

  exec (cb: (err: PopsicleError, response?: T) => any) {
    this.then(function (response) {
      cb(null, response)
    }, cb)
  }

  toOptions (): RequestOptions<T> {
    return {
      url: this.url,
      method: this.method,
      options: this.options,
      body: this.body,
      transport: this.transport,
      timeout: this.timeout,
      rawHeaders: this.rawHeaders,
      use: this.middleware,
      progress: this._progress
    }
  }

  toJSON (): RequestJSON {
    return {
      url: this.url,
      headers: this.headers,
      body: this.body,
      options: this.options,
      timeout: this.timeout,
      method: this.method
    }
  }

  clone () {
    return new Request(this.toOptions())
  }

  use (fns: Middleware | Middleware[]) {
    for (const fn of arrify(fns)) {
      this.middleware.push(fn)
    }

    return this
  }

  progress (fns: ProgressFunction | ProgressFunction[]) {
    for (const fn of arrify(fns)) {
      this._progress.push(fn)
    }

    return this
  }

  abort () {
    if (this.completed === 1 || this.aborted) {
      return
    }

    // Abort the current handler.
    this.aborted = true

    // Sometimes it's just not possible to abort.
    if (this.opened) {
      // Emit a final progress event.
      this._emit()

      if (this.transport.abort) {
        this.transport.abort(this)
      }
    }

    // Reject _after_ the transport handles abort resolution.
    this._reject(this.error('Request aborted', 'EABORT'))

    return this
  }

  private _emit () {
    const fns = this._progress

    try {
      for (let fn of fns) {
        fn(this)
      }
    } catch (err) {
      this._reject(err)
      this.abort()
    }
  }

  private _handle () {
    const { timeout, url } = this
    let timer: any

    // Skip handling when already aborted.
    if (this.aborted) {
      return
    }

    this.opened = true

    // Catch URLs that will cause the request to hang indefinitely in
    // CORS disabled environments. E.g. Atom Editor.
    if (/^https?\:\/*(?:[~#\\\?;\:]|$)/.test(url)) {
      this._reject(this.error(`Refused to connect to invalid URL "${url}"`, 'EINVALID'))
      return
    }

    // Enable transportation layer timeout.
    if (timeout > 0) {
      timer = setTimeout(() => {
        this._reject(this.error(`Timeout of ${timeout}ms exceeded`, 'ETIMEOUT'))
        this.abort()
      }, timeout)
    }

    // Proxy the transport promise into the current request.
    return this.transport.open(this)
      .then(
        res => this._resolve(res),
        err => this._reject(err)
      )
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
      this._emit()
    }
  }

  get downloadedBytes () {
    return this._downloadedBytes
  }

  set downloadedBytes (bytes: number) {
    if (bytes !== this._downloadedBytes) {
      this._downloadedBytes = bytes
      this._emit()
    }
  }

}
