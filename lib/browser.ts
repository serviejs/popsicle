import Promise = require('any-promise')
import { RawHeaders } from './base'
import Request from './request'
import Response from './response'
import { defaults as use } from './plugins/index'

/**
 * Export default instance with browser transportation layer.
 */
export { open, abort, use }

function open (request: Request) {
  return new Promise(function (resolve, reject) {
    const { url, method } = request
    const responseType = request.options.responseType

    // Loading HTTP resources from HTTPS is restricted and uncatchable.
    if (window.location.protocol === 'https:' && /^http\:/.test(url)) {
      return reject(request.error(`The request to "${url}" was blocked`, 'EBLOCKED'))
    }

    const xhr = request._raw = new XMLHttpRequest()

    xhr.onload = function () {
      return resolve({
        status: xhr.status === 1223 ? 204 : xhr.status,
        statusText: xhr.statusText,
        rawHeaders: parseToRawHeaders(xhr.getAllResponseHeaders()),
        body: responseType ? xhr.response : xhr.responseText,
        url: xhr.responseURL
      })
    }

    xhr.onabort = function () {
      return reject(request.error('Request aborted', 'EABORT'))
    }

    xhr.onerror = function () {
      return reject(request.error(`Unable to connect to "${request.url}"`, 'EUNAVAILABLE'))
    }

    // Use `progress` events to avoid calculating byte length.
    xhr.onprogress = function (e: ProgressEvent) {
      if (e.lengthComputable) {
        request.downloadLength = e.total
      }

      request.downloadedBytes = e.loaded
    }

    // No upload will occur with these requests.
    if (method === 'GET' || method === 'HEAD' || !xhr.upload) {
      request.uploadLength = 0
      request.uploadedBytes = 0
    } else {
      xhr.upload.onprogress = function (e: ProgressEvent) {
        if (e.lengthComputable) {
          request.uploadLength = e.total
        }

        request.uploadedBytes = e.loaded
      }
    }

    // XHR can fail to open when site CSP is set.
    try {
      xhr.open(method, url)
    } catch (e) {
      return reject(request.error(`Refused to connect to "${url}"`, 'ECSP', e))
    }

    // Send cookies with CORS.
    if (request.options.withCredentials) {
      xhr.withCredentials = true
    }

    if (responseType) {
      try {
        xhr.responseType = responseType
      } finally {
        if (xhr.responseType !== responseType) {
          throw request.error(`Unsupported response type: ${responseType}`, 'ERESPONSETYPE')
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
  const lines = headers.replace(/\r?\n$/, '').split(/\r?\n/)

  for (const header of lines) {
    const indexOf = header.indexOf(':')
    const name = header.substr(0, indexOf).trim()
    const value = header.substr(indexOf + 1).trim()

    rawHeaders.push(name, value)
  }

  return rawHeaders
}
