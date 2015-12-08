import arrify = require('arrify')
import { stringify, parse } from 'querystring'
import extend = require('xtend')

export interface Query {
  [key: string]: string | string[]
}

export interface Headers {
  [name: string]: string | string[]
}

export interface HeaderNames {
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
 * Create a base class for requests and responses.
 */
export default class Base {
  url: string = null
  headers: Headers = {}
  headerNames: HeaderNames = {}
  query: Query = {}
  rawHeaders: RawHeaders

  constructor ({ url, headers, rawHeaders, query }: BaseOptions) {
    if (typeof url === 'string') {
      const queryIndexOf = url.indexOf('?')
      const queryObject = typeof query === 'string' ? parse(query) : query

      if (queryIndexOf > -1) {
        this.url = url.substr(0, queryIndexOf)
        this.query = extend(queryObject, parse(url.substr(queryIndexOf + 1)))
      } else {
        this.url = url
        this.query = extend(queryObject)
      }
    }

    if (rawHeaders) {
      this.rawHeaders = rawHeaders

      // Set up headers using the `rawHeaders`. Mainly used with responses.
      for (let i = 0; i < rawHeaders.length; i += 2) {
        const name = rawHeaders[i]
        const value = rawHeaders[i + 1]

        this.append(name, value)
      }
    } else {
      this.set(headers)
    }
  }

  set (headers: Headers): Base
  set (name: string, value: string | string[]): Base
  set (name: string | Headers, value?: string | string[]): Base {
    if (typeof name !== 'string') {
      if (name) {
        Object.keys(name).forEach((key) => {
          this.set(key, name[key])
        })
      }
    } else {
      const lower = lowerHeader(name)

      if (value == null) {
        delete this.headers[lower]
        delete this.headerNames[lower]
      } else {
        this.headers[lower] = typeof value === 'string' ? value : value.join(', ')
        this.headerNames[lower] = name
      }
    }

    return this
  }

  append (name: string, value: string | string[]) {
    const previous = this.get(name)

    if (previous != null) {
      value = `${previous}, ${typeof value === 'string' ? value : value.join(', ')}`
    }

    return this.set(name, value)
  }

  name (name: string): string {
    return this.headerNames[lowerHeader(name)]
  }

  get (): Headers
  get (name: string): string
  get (name?: string): any {
    if (arguments.length === 0) {
      const headers: Headers = {}

      Object.keys(this.headers).forEach((key) => {
        headers[this.name(key)] = this.get(key)
      })

      return headers
    } else {
      return this.headers[lowerHeader(name)]
    }
  }

  remove (name: string) {
    const lower = lowerHeader(name)

    delete this.headers[lower]
    delete this.headerNames[lower]

    return this
  }

  type (): string
  type (value: string): Base
  type (value?: string): any {
    if (arguments.length === 0) {
      return type(<string> this.headers['content-type'])
    }

    return this.set('Content-Type', value)
  }

  fullUrl () {
    const url = this.url
    const query = stringify(this.query)

    if (query) {
      return url + (url.indexOf('?') === -1 ? '?' : '&') + query
    }

    return url
  }
}
