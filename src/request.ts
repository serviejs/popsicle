import { Base, BaseOptions, Headers } from './base'
import { Response } from './response'
import { splice } from './support'
import PopsicleError from './error'

export interface DefaultsOptions extends BaseOptions {
  method?: string
  timeout?: number
  body?: any
  use?: Middleware[]
  transport?: TransportOptions
}

export interface RequestOptions extends DefaultsOptions {
  url: string
  events?: Events
}

export interface RequestJSON {
  url: string
  headers: Headers
  body: any
  timeout: number
  method: string
}

export interface Events {
  abort: EventList<(this: Request) => void>
  progress: EventList<(this: Request) => void>
}

export interface TransportOptions {
  open: (request: Request) => Promise<Response>
  abort?: (request: Request) => any
  use?: Middleware[]
}

export type EventList <T extends (...args: any[]) => void> = Array<EventFn<T>>
export type EventFn <T extends (...args: any[]) => void> = T & { listener?: T }
export type Middleware = (request: Request, next: () => Promise<Response>) => Response | Promise<Response>

export class Request extends Base {
  method: string
  timeout: number
  body: any
  transport: TransportOptions
  events: Events
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
  _promise: Promise<Response>

  constructor (options: RequestOptions) {
    super(options)

    this.timeout = (options.timeout || 0)
    this.method = (options.method || 'GET').toUpperCase()
    this.body = options.body
    this.events = options.events || Object.create(null)

    // Extend to avoid mutations of the transport object.
    this.transport = Object.assign({}, options.transport)

    var optionsUse: Middleware[] = options.use as Middleware[]
    var transportUse: Middleware[] = this.transport.use as Middleware[]

    // Automatically `use` default middleware functions.
    this.use(optionsUse || transportUse)

    // External promise representation, resolves _after_ middleware has been
    // attached by relying on promises always resolving on the "next tick".
    this._promise = Promise.resolve().then(() => exec(this))

    // Attach an abort listener.
    this.once('abort', () => {
      if (this.completed === 1) {
        return
      }

      this.aborted = true
    })
  }

  error (message: string, code: string, original?: Error): PopsicleError {
    return new PopsicleError(message, code, original as Error, this)
  }

  then <T> (
    onFulfilled?: (response: Response) => T | PromiseLike<T>,
    onRejected?: (error: PopsicleError) => T | PromiseLike<T>
  ): Promise<T> {
    return this._promise.then(onFulfilled, onRejected)
  }

  catch <T> (onRejected: (error: PopsicleError) => T): Promise<T | Response> {
    return this._promise.then(null, onRejected)
  }

  exec (cb: (error: PopsicleError | null, response?: Response) => void) {
    void this.then(res => cb(null, res), cb)
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
      events: this.events
    }
  }

  toJSON (): RequestJSON {
    return {
      url: this.url,
      method: this.method,
      headers: this.headers,
      body: this.body,
      timeout: this.timeout
    }
  }

  clone () {
    return new Request(this.toOptions())
  }

  use (fn: Middleware | Middleware[]) {
    if (Array.isArray(fn)) {
      this.middleware.push(...fn)
    } else {
      this.middleware.push(fn)
    }

    return this
  }

  on (event: keyof Events, fn: (this: this, ...args: any[]) => void) {
    if (Object.prototype.hasOwnProperty.call(this.events, event)) {
      this.events[event].push(fn)
    } else {
      this.events[event] = [fn]
    }

    return this
  }

  off (event: keyof Events, fn: (this: this, ...args: any[]) => void) {
    if (Object.prototype.hasOwnProperty.call(this.events, event)) {
      const list = this.events[event]
      let index = -1

      for (let i = 0; i < list.length; i++) {
        if (list[i] === fn || list[i].listener === fn) {
          index = i
          break
        }
      }

      if (index > -1) {
        if (list.length === 1) {
          delete this.events[event]
        } else {
          splice(this.events[event], index)
        }
      }
    }

    return this
  }

  once (event: keyof Events, fn: (this: this, ...args: any[]) => void) {
    return this.on(event, wrapOnce(this, event, fn))
  }

  emit (event: keyof Events, ...args: any[]) {
    if (!Object.prototype.hasOwnProperty.call(this.events, event)) {
      return this
    }

    const listeners = this.events[event]

    if (listeners.length === 1) {
      args.length === 0 ? listeners[0].call(this) : listeners[0].apply(this, args)
    } else {
      for (const listener of listeners.slice()) {
        args.length === 0 ? listener.call(this) : listener.apply(this, args)
      }
    }

    return this
  }

  abort () {
    return this.emit('abort')
  }

  handle () {
    this.opened = true

    // Catch URLs that will cause the request to hang indefinitely in
    // CORS disabled environments. E.g. Atom Editor.
    if (/^https?\:\/*(?:[~#\\\?;\:]|$)/.test(this.url)) {
      return Promise.reject(this.error(`Refused to connect to invalid URL "${this.url}"`, 'EINVALID'))
    }

    const { timeout } = this
    let timer: any

    // Resolve the transport request with timeout rejection.
    const result = new Promise<Response>((resolve, reject) => {
      if (timeout > 0) {
        timer = setTimeout(
          () => {
            // Reject _before_ aborting the request.
            reject(this.error(`Timeout of ${timeout}ms exceeded`, 'ETIMEOUT'))

            // Abort the transport layer.
            this.abort()
          },
          timeout
        )
      }

      this.once('abort', () => {
        // Emit a final progress event.
        this.emit('progress')

        // Reject _before_ aborting the request (which may `resolve`).
        reject(this.error('Request aborted', 'EABORT'))

        // Pass the abort onto the transport layer.
        if (this.transport.abort) {
          this.transport.abort(this)
        }
      })

      // Wrap the transport layer to defer resolving the outer promise, allows
      // other conditions to possibly `reject` over the transport layer.
      void Promise.resolve(this.transport.open(this)).then(
        (res) => resolve(res),
        (err) => reject(err)
      )
    })

    // Clear the timeout on resolve, if enabled.
    if (timeout > 0) {
      void result.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer)
      )
    }

    return result
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
      this.emit('progress')
    }
  }

  _setDownloadedBytes (bytes: number, downloaded?: number) {
    if (bytes !== this.downloadedBytes) {
      this.downloaded = downloaded || bytes / this.downloadLength
      this.downloadedBytes = bytes
      this.emit('progress')
    }
  }

}

/**
 * Create a `once` function wrapper.
 */
function wrapOnce (target: Request, event: keyof Events, fn: (...args: any[]) => void) {
  let fired = false

  const g: EventFn<typeof fn> = (...args: any[]) => {
    if (!fired) {
      fired = true
      target.off(event, fn)
      args.length === 0 ? fn.call(target) : fn.apply(target, args)
    }
  }

  g.listener = fn

  return g
}

/**
 * Compose the API request with middleware.
 */
function exec (req: Request) {
  let index = -1

  function dispatch (pos: number): Promise<Response> {
    if (pos <= index) {
      throw new TypeError('`next()` called multiple times')
    }

    // Avoid proceeding when the request was aborted.
    if (req.aborted) {
      return Promise.reject(req.error('Request aborted', 'EABORT'))
    }

    index = pos

    const fn = req.middleware[pos] || (() => req.handle())

    return new Promise<Response>(resolve => {
      return resolve(fn(req, function next () {
        return dispatch(pos + 1)
      }))
    })
  }

  return dispatch(0)
}
