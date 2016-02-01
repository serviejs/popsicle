import Promise = require('any-promise')
import FormData = require('form-data')
import { stringify as stringifyQuery, parse as parseQuery } from 'querystring'
import Request from '../request'
import Response from '../response'
import form from '../form'

const JSON_MIME_REGEXP = /^application\/(?:[\w!#\$%&\*`\-\.\^~]*\+)?json$/i
const QUERY_MIME_REGEXP = /^application\/x-www-form-urlencoded$/i
const FORM_MIME_REGEXP = /^multipart\/form-data$/i

/**
 * Create a check for native objects.
 */
let isHostObject: (x: any) => boolean

if (process.browser) {
  isHostObject = function (object: any) {
    const str = Object.prototype.toString.call(object)

    switch (str) {
      case '[object File]':
      case '[object Blob]':
      case '[object FormData]':
      case '[object ArrayBuffer]':
        return true
      default:
        return false
    }
  }
} else {
  isHostObject = function (object: any) {
    return typeof object.pipe === 'function' || Buffer.isBuffer(object)
  }
}

/**
 * Set up default headers for requests.
 */
function defaultHeaders (request: Request) {
  // If we have no accept header set already, default to accepting
  // everything. This is needed because otherwise Firefox defaults to
  // an accept header of `html/xml`.
  if (!request.get('Accept')) {
    request.set('Accept', '*/*')
  }

  // Remove headers that should never be set by the user.
  request.remove('Host')
}

/**
 * Stringify known contents and mime types.
 */
function stringifyRequest (request: Request) {
  const { body } = request

  // Convert primitives types into strings.
  if (Object(body) !== body) {
    request.body = body == null ? null : String(body)

    return
  }

  if (isHostObject(body)) {
    return
  }

  let type = request.type()

  // Set the default mime type to be JSON if none exists.
  if (!type) {
    type = 'application/json'

    request.type(type)
  }

  // Automatically stringify expected MIME types.
  try {
    if (JSON_MIME_REGEXP.test(type)) {
      request.body = JSON.stringify(body)
    } else if (FORM_MIME_REGEXP.test(type)) {
      request.body = form(body)
    } else if (QUERY_MIME_REGEXP.test(type)) {
      request.body = stringifyQuery(body)
    }
  } catch (err) {
    return Promise.reject(request.error('Unable to stringify request body: ' + err.message, 'ESTRINGIFY', err))
  }

  // Remove the `Content-Type` header from form data requests. Browsers
  // will only fill it automatically with the boundary when it isn't set.
  if (request.body instanceof FormData) {
    request.remove('Content-Type')
  }
}

/**
 * Parse the response automatically.
 */
function parseResponse (response: Response) {
  const body = response.body

  if (typeof body !== 'string') {
    return
  }

  if (body === '') {
    response.body = null

    return
  }

  const type = response.type()

  try {
    if (JSON_MIME_REGEXP.test(type)) {
      response.body = body === '' ? null : JSON.parse(body)
    } else if (QUERY_MIME_REGEXP.test(type)) {
      response.body = parseQuery(body)
    }
  } catch (err) {
    return Promise.reject(response.error('Unable to parse response body: ' + err.message, 'EPARSE', err))
  }
}

/**
 * Remove default headers.
 */
export function headers () {
  return function (request: Request) {
    request.before(defaultHeaders)
  }
}

/**
 * Stringify the request body.
 */
export function stringify () {
  return function (request: Request) {
    request.before(stringifyRequest)
  }
}

/**
 * Automatic stringification and parsing middleware.
 */
export function parse () {
  return function (request: Request) {
    request.after(parseResponse)
  }
}
