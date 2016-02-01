import concat = require('concat-stream')
import FormData = require('form-data')
import { createUnzip } from 'zlib'
import Promise = require('any-promise')
export * from './common'
import { headers as commonHeaders, parse, stringify } from './common'
import Request, { Middleware } from '../request'
import Response from '../response'

function unzipResponse (response: Response) {
  if (['gzip', 'deflate'].indexOf(response.get('Content-Encoding')) > -1) {
    const unzip = createUnzip()
    response.body.pipe(unzip)
    response.body = unzip
  }
}

function unzipHeaders (request: Request) {
  if (!request.get('Accept-Encoding')) {
    request.set('Accept-Encoding', 'gzip,deflate')
  }
}

/**
 * Support gzipped responses.
 */
export function unzip () {
  return function (request: Request) {
    request.before(unzipHeaders)
    request.after(unzipResponse)
  }
}

/**
 * The body is normally a stream in node, this turns it into a string for browser
 * compatibility (and honestly just making it easier to use).
 */
export function concatStream (encoding: string) {
  return function (request: Request) {
    request.after(function (response: Response) {
      return new Promise(function (resolve, reject) {
        const stream = concat({
          encoding: encoding
        }, function (data: any) {
          // Update the response `body` to the concat output.
          response.body = data
          return resolve()
        })

        response.body.once('error', reject)
        response.body.pipe(stream)
      })
    })
  }
}

function defaultHeaders (request: Request) {
  // Specify a default user agent in node.
  if (!request.get('User-Agent')) {
    request.set('User-Agent', 'https://github.com/blakeembrey/popsicle')
  }

  // Manually set the `Content-Length` and `Content-Type` headers from the
  // form data object because we need to handle boundaries and streams.
  if (request.body instanceof FormData) {
    request.set('Content-Type', 'multipart/form-data; boundary=' + request.body.getBoundary())

    // Asynchronously compute the content length.
    return new Promise(function (resolve, reject) {
      request.body.getLength(function (err: Error, length: number) {
        if (err) {
          request.set('Transfer-Encoding', 'chunked')
        } else {
          request.set('Content-Length', String(length))
        }

        return resolve()
      })
    })
  }

  let length = 0
  const body = request.body

  // Attempt to manually compute the content length.
  if (body && !request.get('Content-Length')) {
    if (Array.isArray(body)) {
      for (let i = 0; i < body.length; i++) {
        length += body[i].length
      }
    } else if (typeof body === 'string') {
      length = Buffer.byteLength(body)
    } else {
      length = body.length
    }

    if (length) {
      request.set('Content-Length', String(length))
    } else if (typeof body.pipe === 'function') {
      request.set('Transfer-Encoding', 'chunked')
    } else {
      return Promise.reject(request.error('Argument error, `options.body`', 'EBODY'))
    }
  }
}

/**
 * Fill default headers with requests (automatic "Content-Length" and "User-Agent").
 */
export function headers () {
  const defaults = commonHeaders()

  return function (request: Request) {
    defaults(request)
    request.before(defaultHeaders)
  }
}

export const defaults: Middleware[] = [stringify(), headers(), unzip(), concatStream('string'), parse()]
