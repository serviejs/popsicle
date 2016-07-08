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
  return str == null ? null : str.split(/ *; */, 1)[0]
}

/**
 * Concat two header values together.
 */
function concat (a: string | string[], b: string): string | string[] {
  if (a == null) {
    return b
  }

  return Array.isArray(a) ? a.concat(b) : [a, b]
}

/**
 * Create a base class for requests and responses.
 */
export default class Base {
  Url: Url = {}
  rawHeaders: RawHeaders = []

  constructor ({ url, headers, rawHeaders, query }: BaseOptions) {
    if (url != null) {
      this.url = url
    }

    if (query != null) {
      this.query = extend(this.query, typeof query === 'string' ? parseQuery(query) : query)
    }

    // Enables proxying of `rawHeaders`.
    if (rawHeaders) {
      if (rawHeaders.length % 2 === 1) {
        throw new TypeError(`Expected raw headers length to be even, was ${rawHeaders.length}`)
      }

      this.rawHeaders = rawHeaders.slice(0)
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
    const headers: Headers = {}

    for (let i = 0; i < this.rawHeaders.length; i += 2) {
      const key = lowerHeader(this.rawHeaders[i])
      const value = concat(headers[key], this.rawHeaders[i + 1])
      headers[key] = value
    }

    return headers
  }

  set headers (headers: Headers) {
    this.rawHeaders = []

    if (headers) {
      for (const key of Object.keys(headers)) {
        this.append(key, headers[key])
      }
    }
  }

  toHeaders () {
    const headers: Headers = {}

    for (let i = 0; i < this.rawHeaders.length; i += 2) {
      const key = this.rawHeaders[i]
      const value = concat(headers[key], this.rawHeaders[i + 1])
      headers[key] = value
    }

    return headers
  }

  set (name: string, value?: string | string[]): this {
    this.remove(name)
    this.append(name, value)

    return this
  }

  append (name: string, value?: string | string[]) {
    if (Array.isArray(value)) {
      for (const val of value) {
        if (val != null) {
          this.rawHeaders.push(name, val)
        }
      }
    } else {
      if (value != null) {
        this.rawHeaders.push(name, value)
      }
    }

    return this
  }

  name (name: string): string {
    const lowered = lowerHeader(name)
    let headerName: string

    for (let i = 0; i < this.rawHeaders.length; i += 2) {
      if (lowerHeader(this.rawHeaders[i]) === lowered) {
        headerName = this.rawHeaders[i]
      }
    }

    return headerName
  }

  get (name: string): string {
    const lowered = lowerHeader(name)

    for (let i = 0; i < this.rawHeaders.length; i += 2) {
      if (lowerHeader(this.rawHeaders[i]) === lowered) {
        return this.rawHeaders[i + 1]
      }
    }
  }

  getAll (name: string): string[] {
    const lowered = lowerHeader(name)
    const result: string[] = []

    for (let i = 0; i < this.rawHeaders.length; i += 2) {
      if (lowerHeader(this.rawHeaders[i]) === lowered) {
        result.push(this.rawHeaders[i + 1])
      }
    }

    return result
  }

  remove (name: string) {
    const lowered = lowerHeader(name)
    let len = this.rawHeaders.length

    while ((len -= 2) >= 0) {
      if (lowerHeader(this.rawHeaders[len]) === lowered) {
        this.rawHeaders.splice(len, 2)
      }
    }

    return this
  }

  type (): string
  type (value: string): this
  type (value?: string): string | this {
    if (arguments.length === 0) {
      return type(this.get('Content-Type'))
    }

    return this.set('Content-Type', value)
  }
}
