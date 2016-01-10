import arrify = require('arrify')
import { parse, format, Url } from 'url'
import { parse as parseQuery } from 'querystring'
import extend = require('xtend')

export interface Query {
  [key: string]: string | string[]
}

export interface Headers {
  [name: string]: string | string[]
}

export interface HeaderMap {
  [name: string]: string
}

export type RawHeaders = string[]

export interface BaseOptions {
  url?: string
  query?: string | Query
  headers?: Headers
  rawHeaders?: RawHeaders
}

/**
 * Consistently lower case a header name.
 */
function lowerHeader (key: string) {
  const lower = key.toLowerCase()

  if (lower === 'referrer') {
    return 'referer'
  }

  return lower
}

/**
 * Extract the content type from a header string.
 */
function type (str?: string) {
  return str == null ? null : str.split(/ *; */)[0]
}

/**
 * Stringify supported header formats.
 */
function stringifyHeader (value: string | string[]) {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

/**
 * Create a base class for requests and responses.
 */
export default class Base {
  Url: Url = {}
  headerNames: HeaderMap = {}
  headerValues: HeaderMap = {}

  constructor ({ url, headers, rawHeaders, query }: BaseOptions) {
    if (url != null) {
      this.url = url
    }

    if (query != null) {
      this.query = extend(this.query, typeof query === 'string' ? parseQuery(query) : query)
    }

    // Enables proxying of `rawHeaders`.
    if (rawHeaders) {
      for (let i = 0; i < rawHeaders.length; i += 2) {
        const name = rawHeaders[i]
        const value = rawHeaders[i + 1]

        this.append(name, value)
      }
    } else {
      this.headers = headers
    }
  }

  get url () {
    return format(this.Url)
  }

  set url (url: string) {
    this.Url = parse(url, true, true)
  }

  set query (query: string | Query) {
    this.Url.query = typeof query === 'string' ? parseQuery(query) : query
    this.Url.search = null
  }

  get query () {
    return this.Url.query
  }

  get headers () {
    const headers: HeaderMap = {}

    for (const key of Object.keys(this.headerNames)) {
      headers[key] = this.headerValues[key]
    }

    return headers
  }

  set headers (headers: Headers) {
    this.headerNames = {}
    this.headerValues = {}

    if (headers) {
      for (const key of Object.keys(headers)) {
        this.set(key, headers[key])
      }
    }
  }

  set (name: string, value: string | string[]): Base {
    const lower = lowerHeader(name)

    if (value == null) {
      delete this.headerNames[lower]
      delete this.headerValues[lower]
    } else {
      this.headerNames[lower] = name
      this.headerValues[lower] = stringifyHeader(value)
    }

    return this
  }

  append (name: string, value: string | string[]) {
    const previous = this.get(name)

    if (previous != null) {
      value = `${previous}, ${stringifyHeader(value)}`
    }

    return this.set(name, value)
  }

  name (name: string): string {
    return this.headerNames[lowerHeader(name)]
  }

  get (name: string): string {
    return this.headerValues[lowerHeader(name)]
  }

  remove (name: string) {
    const lower = lowerHeader(name)

    delete this.headerNames[lower]
    delete this.headerValues[lower]

    return this
  }

  type (): string
  type (value: string): Base
  type (value?: string): any {
    if (arguments.length === 0) {
      return type(this.get('Content-Type') as string)
    }

    return this.set('Content-Type', value)
  }
}
