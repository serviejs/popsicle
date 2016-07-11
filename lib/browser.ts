import Promise = require('any-promise')
import { RawHeaders } from './base'
import Request from './request'
import Response from './response'
import { stringify, headers } from './plugins/index'
import { parse, textTypes, TextTypes } from './utils'

export type Types = 'document' | 'blob' | 'arraybuffer' | TextTypes | string

/**
 * Browser transport options.
 */
export interface Options {
  type?: Types
  withCredentials?: boolean
  overrideMimeType?: string
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
 * Default `use`.
 */
const use = [stringify(), headers()]

/**
 * Default open handler.
 */
function handle (request: Request, options: Options): Promise<Response> {
  return new Promise(function (resolve, reject) {
    const type = options.type || 'text'
    const { url, method } = request
    const isText = textTypes.indexOf(type) > -1

    // Loading HTTP resources from HTTPS is restricted and uncatchable.
    if (window.location.protocol === 'https:' && /^http\:/.test(url)) {
      return reject(request.error(`The request to "${url}" was blocked`, 'EBLOCKED'))
    }

    const xhr = request._raw = new XMLHttpRequest()

    function done () {
      return new Promise<Response>(resolve => {
        return resolve(new Response({
          status: xhr.status === 1223 ? 204 : xhr.status,
          statusText: xhr.statusText,
          rawHeaders: parseToRawHeaders(xhr.getAllResponseHeaders()),
          body: isText ? parse(request, xhr.responseText, type) : xhr.response,
          url: xhr.responseURL
        }))
      })
    }

    xhr.onload = () => resolve(done())
    xhr.onabort = () => resolve(done())

    xhr.onerror = function () {
      return reject(request.error(`Unable to connect to "${request.url}"`, 'EUNAVAILABLE'))
    }

    // Use `progress` events to avoid calculating byte length.
    xhr.onprogress = function (e: ProgressEvent) {
      if (e.lengthComputable) {
        request.downloadLength = e.total
      }

      request._setDownloadedBytes(e.loaded)
    }

    xhr.upload.onloadend = () => request.downloaded = 1

    // No upload will occur with these requests.
    if (method === 'GET' || method === 'HEAD' || !xhr.upload) {
      request.uploadLength = 0
      request._setUploadedBytes(0, 1)
    } else {
      xhr.upload.onprogress = function (e: ProgressEvent) {
        if (e.lengthComputable) {
          request.uploadLength = e.total
        }

        request._setUploadedBytes(e.loaded)
      }

      xhr.upload.onloadend = () => request.uploaded = 1
    }

    // XHR can fail to open when site CSP is set.
    try {
      xhr.open(method, url)
    } catch (e) {
      return reject(request.error(`Refused to connect to "${url}"`, 'ECSP', e))
    }

    // Send cookies with CORS.
    if (options.withCredentials) {
      xhr.withCredentials = true
    }

    // Enable overriding the response MIME handling.
    if (options.overrideMimeType) {
      xhr.overrideMimeType(options.overrideMimeType)
    }

    // Use the passed in type for the response.
    if (!isText) {
      try {
        xhr.responseType = type
      } finally {
        if (xhr.responseType !== type) {
          return reject(request.error(`Unsupported type: ${type}`, 'ETYPE'))
        }
      }
    }

    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      xhr.setRequestHeader(request.rawHeaders[i], request.rawHeaders[i + 1])
    }

    xhr.send(request.body)
  })
}

/**
 * Close the current HTTP request.
 */
function abort (request: Request) {
  request._raw.abort()
}

/**
 * Parse a headers string into an array of raw headers.
 */
function parseToRawHeaders (headers: string): RawHeaders {
  const rawHeaders: RawHeaders = []
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
