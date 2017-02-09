import FormData = require('form-data')
import { headers as commonHeaders } from './common'
import { Request } from '../request'
import { Response } from '../response'

export * from './common'

/**
 * Fill default headers with requests (automatic "Content-Length" and "User-Agent").
 */
export function headers () {
  const common = commonHeaders()

  return function (request: Request, next: () => Promise<Response>) {
    // Set up common headers.
    return common(request, function () {
      // Specify a default user agent in node.
      if (!request.get('User-Agent')) {
        request.set('User-Agent', 'Popsicle (https://github.com/blakeembrey/popsicle)')
      }

      // Manually set the `Content-Length` and `Content-Type` headers from the
      // form data object because we need to handle boundaries and streams.
      if (request.body instanceof FormData) {
        request.set('Content-Type', 'multipart/form-data; boundary=' + request.body.getBoundary())

        // Asynchronously compute the content length.
        return new Promise((resolve) => {
          request.body.getLength(function (err: Error, length: number) {
            if (err) {
              request.set('Transfer-Encoding', 'chunked')
            } else {
              request.set('Content-Length', String(length))
            }

            return resolve(next())
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

      return next()
    })
  }
}
