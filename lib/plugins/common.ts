import Promise = require('any-promise')
import FormData = require('form-data')
import { stringify as stringifyQuery, parse as parseQuery } from 'querystring'
import isHostObject from './is-host/index'
import Request from '../request'
import Response from '../response'
import form from '../form'

const JSON_MIME_REGEXP = /^application\/(?:[\w!#\$%&\*`\-\.\^~]*\+)?json$/i
const QUERY_MIME_REGEXP = /^application\/x-www-form-urlencoded$/i
const FORM_MIME_REGEXP = /^multipart\/form-data$/i

/**
 * Simply wrap a value and return it.
 */
export function wrap <T> (value: T): () => T {
  return () => value
}

/**
 * Remove default headers.
 */
export const headers = wrap(function (request: Request<any>, next: () => Promise<Response>) {
  // If we have no accept header set already, default to accepting
  // everything. This is needed because otherwise Firefox defaults to
  // an accept header of `html/xml`.
  if (!request.get('Accept')) {
    request.set('Accept', '*/*')
  }

  // Remove headers that should never be set by the user.
  request.remove('Host')

  return next()
})

/**
 * Stringify the request body.
 */
export const stringify = wrap(function (request: Request<any>, next: () => Promise<Response>) {
  const { body } = request

  // Convert primitives types into strings.
  if (Object(body) !== body) {
    request.body = body == null ? null : String(body)

    return next()
  }

  if (isHostObject(body)) {
    return next()
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

  return next()
})

/**
 * Automatic stringification and parsing middleware.
 */
export const parse = wrap(function (request: Request<any>, next: () => Promise<Response>) {
  return next()
    .then(function (response) {
      const { body } = response

      if (typeof body !== 'string') {
        return response
      }

      if (body === '') {
        response.body = null

        return response
      }

      const type = response.type()

      try {
        if (JSON_MIME_REGEXP.test(type)) {
          response.body = body === '' ? null : JSON.parse(body)
        } else if (QUERY_MIME_REGEXP.test(type)) {
          response.body = parseQuery(body)
        }
      } catch (err) {
        return Promise.reject(request.error('Unable to parse response body: ' + err.message, 'EPARSE', err))
      }

      return response
    })
})
