import Promise = require('any-promise')
import { parse as parseQuery } from 'querystring'
import Request from './request'

export type TextTypes = 'text' | 'json' | 'urlencoded'
export const textTypes = ['text', 'json', 'urlencoded']

export function parse (request: Request, value: string, type: string) {
  // Return plain-text as is.
  if (type === 'text') {
    return value
  }

  // Parsing empty strings should return `null` (non-strict).
  if (value === '') {
    return null
  }

  // Attempt to parse the response as JSON.
  if (type === 'json') {
    try {
      return JSON.parse(value)
    } catch (err) {
      throw request.error(`Unable to parse response body: ${err.message}`, 'EPARSE', err)
    }
  }

  // Attempt to parse the response as URL encoding.
  if (type === 'urlencoded') {
    return parseQuery(value)
  }

  throw new TypeError(`Unable to parse type: ${type}`)
}
