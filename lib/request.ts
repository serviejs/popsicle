import arrify = require('arrify')
import extend = require('xtend')
import Promise = require('any-promise')
import { compose } from 'throwback'
import Base, { BaseOptions, Headers } from './base'
import Response, { ResponseOptions, ResponseJSON } from './response'
import PopsicleError from './error'

export interface DefaultsOptions extends BaseOptions {
  url?: string
  method?: string
  timeout?: number
  body?: any
  use?: Middleware[]
  progress?: ProgressFunction[]
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
  method: string
  response: ResponseJSON
}

export interface TransportOptions {
  open: (request: Request) => Promise<Response>
  abort?: (request: Request) => any
  use?: Middleware[]
}

export type Middleware = (request: Request, next: () => Promise<Response>) => Response | Promise<Response>
export type ProgressFunction = (request: Request) => any

export default class Request extends Base implements Promise<Response> {
  method: string
  timeout: number
  body: any
  transport: TransportOptions
  response: Response
  middleware: Middleware[] = []

  opened = false
  aborted = false
  uploaded = 0
  downloaded = 0
  uploadedBytes: number
  downloadedBytes: number
  uploadLength: number
  downloadLength: number

  _raw: any
  _progress: ProgressFunction[] = []

  private _promise: Promise<Response>
  private _resolve: (response: Response) => void
  private _reject: (error: Error) => void

  constructor (options: RequestOptions) {
    super(options)

    this.timeout = (options.timeout | 0)
    this.method = (options.method || 'GET').toUpperCase()
    this.body = options.body

    // Internal promise representation.
    const $promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })

    // Extend to avoid mutations of the transport object.
    this.transport = extend(options.transport)

    // Automatically `use` default middleware functions.
    this.use(options.use || this.transport.use)
    this.progress(options.progress)

    // External promise representation, resolves _after_ middleware has been
    // attached by relying on promises always resolving on the "next tick".
    this._promise = Promise.resolve()
      .then(() => {
        const run = compose(this.middleware)

        const cb = () => {
          this._handle()
          return $promise
        }

        return run(this, cb)
      })
  }

  error (message: string, code: string, original?: Error): PopsicleError {
    return new PopsicleError(message, code, original, this)
  }

  then (onFulfilled: (response: Response) => any, onRejected?: (error: PopsicleError) => any) {
    return this._promise.then(onFulfilled, onRejected)
  }

  catch (onRejected: (error: PopsicleError) => any) {
    return this._promise.then(null, onRejected)
  }

  exec (cb: (error: PopsicleError | void, response?: Response) => void) {
    this.then(function (response) {
      cb(null, response)
    }, cb)
  }

  toOptions (): RequestOptions {
    return {
      url: this.url,
      method: this.method,
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
      method: this.method,
      headers: this.headers,
      body: this.body,
      timeout: this.timeout,
      response: this.response ? this.response.toJSON() : null
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
        response => {
          this.response = response
          this._resolve(response)
        },
        err => this._reject(err)
      )
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

  _setUploadedBytes (bytes: number, uploaded?: number) {
    if (bytes !== this.uploadedBytes) {
      this.uploaded = uploaded || bytes / this.uploadLength
      this.uploadedBytes = bytes
      this._emit()
    }
  }

  _setDownloadedBytes (bytes: number, downloaded?: number) {
    if (bytes !== this.downloadedBytes) {
      this.downloaded = downloaded || bytes / this.downloadLength
      this.downloadedBytes = bytes
      this._emit()
    }
  }

}
