import { Request, Response, createHeaders, ResponseOptions } from 'servie'
import { createBody, Body } from 'servie/dist/body/browser'
import { PopsicleError } from '../error'
import { normalizeRequest } from '../common'

/**
 * Extend response with URL.
 */
export interface XhrResponseOptions extends ResponseOptions {
  url: string
  body: Body
}

/**
 * XHR responses can indicate a response URL.
 */
export class XhrResponse extends Response implements XhrResponseOptions {

  url: string
  body: Body

  constructor (options: XhrResponseOptions) {
    super(options)
    this.url = options.url
    this.body = options.body
  }

}

/**
 * Valid XHR configuration.
 */
export interface SendOptions {
  type?: XMLHttpRequestResponseType
  withCredentials?: boolean
  overrideMimeType?: string
}

/**
 * Send request over `XMLHttpRequest`.
 */
export function send (options: SendOptions) {
  return function (req: Request): Promise<XhrResponse> {
    return new Promise<XhrResponse>(function (resolve, reject) {
      const type = options.type || 'text'
      const method = req.method.toUpperCase()

      // Loading HTTP resources from HTTPS is restricted and uncatchable.
      if (window.location.protocol === 'https:' && req.Url.protocol === 'http:') {
        return reject(
          new PopsicleError(`The connection to "${req.url}" is blocked`, 'EBLOCKED', req)
        )
      }

      // Catch URLs that will cause the request to hang indefinitely in CORS
      // disabled environments, such as Atom Editor.
      if (/^https?\:\/*(?:[~#\\\?;\:]|$)/.test(req.url)) {
        return reject(
          new PopsicleError(`Refusing to connect to "${req.url}"`, 'EINVALID', req)
        )
      }

      const xhr = new XMLHttpRequest()
      let bytesDownloaded = 0

      function ondone () {
        const res = new XhrResponse({
          statusCode: xhr.status === 1223 ? 204 : xhr.status,
          statusMessage: xhr.statusText,
          headers: createHeaders(parseXhrHeaders(xhr.getAllResponseHeaders())),
          body: createBody(type === 'text' ? xhr.responseText : xhr.response, { headers: [] }),
          url: xhr.responseURL
        })

        // https://github.com/serviejs/servie#implementers
        req.closed = true
        res.started = true
        res.finished = true
        res.bytesTransferred = bytesDownloaded

        return resolve(res)
      }

      function onerror () {
        const err = new PopsicleError(`Unable to connect to "${req.url}"`, 'EUNAVAILABLE', req)
        req.closed = true
        return reject(err)
      }

      xhr.onload = ondone
      xhr.onabort = ondone
      xhr.onerror = onerror

      // Track download progress locally and set later.
      xhr.onprogress = (e: ProgressEvent) => bytesDownloaded = e.loaded

      // No upload will occur with these requests.
      if (method !== 'GET' && method !== 'HEAD' && xhr.upload) {
        xhr.upload.onprogress = (e: ProgressEvent) => req.bytesTransferred = e.loaded
        xhr.upload.onloadend = () => req.finished = true
      } else {
        req.finished = true
      }

      // XHR can fail to open when site CSP is set.
      try {
        xhr.open(method, req.url)
      } catch (err) {
        return reject(new PopsicleError(`Refused to connect to "${req.url}"`, 'ECSP', req, err))
      }

      // Send cookies with CORS.
      if (options.withCredentials) xhr.withCredentials = true

      // Enable overriding the response MIME handling.
      if (options.overrideMimeType) xhr.overrideMimeType(options.overrideMimeType)

      // Use the passed in type for the response.
      if (type !== 'text') {
        try {
          xhr.responseType = type
        } finally {
          if (xhr.responseType !== type) {
            return reject(new PopsicleError(`Unsupported type: ${type}`, 'ETYPE', req))
          }
        }
      }

      for (let i = 0; i < req.headers.rawHeaders.length; i += 2) {
        xhr.setRequestHeader(req.headers.rawHeaders[i], req.headers.rawHeaders[i + 1])
      }

      // https://github.com/serviejs/servie#implementers
      req.started = true
      req.events.on('abort', () => xhr.abort())

      // Send raw body as-is since it's best supported.
      xhr.send(req.body.useRawBody())
    })
  }
}

/**
 * Combined transport options.
 */
export interface TransportOptions extends SendOptions {}

/**
 * Create a request transport using `XMLHttpRequest`.
 */
export function transport (options: TransportOptions = {}) {
  const done = send(options)
  const normalize = normalizeRequest()

  return (req: Request) => normalize(req, () => done(req))
}

/**
 * Parse a headers string into an array of raw headers.
 */
function parseXhrHeaders (headers: string): string[] {
  const rawHeaders: string[] = []
  const lines = headers.split(/\r?\n/)

  for (const line of lines) {
    if (line) {
      const indexOf = line.indexOf(':')
      const name = line.substr(0, indexOf).trim()
      const value = line.substr(indexOf + 1).trim()

      rawHeaders.push(name, value)
    }
  }

  return rawHeaders
}
