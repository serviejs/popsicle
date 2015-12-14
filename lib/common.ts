import extend = require('xtend')
import methods = require('methods')
import Request, { RequestOptions, DefaultsOptions } from './request'
import Response from './response'
import * as plugins from './plugins/index'
import form from './form'
import jar from './jar'
import PopsicleError from './error'

/**
 * Support Popsicle defaults.
 */
function extendDefaults (defaults: DefaultsOptions, options: RequestOptions | string): RequestOptions {
  if (typeof options === 'string') {
    return extend(defaults, { url: options })
  }

  return extend(defaults, <RequestOptions> options)
}

/**
 * Main popsicle function.
 */
export interface Popsicle {
  (options: RequestOptions | string): Request

  plugins: typeof plugins
  Request: typeof Request
  Response: typeof Response
  Error: typeof PopsicleError
  defaults: (defaults: DefaultsOptions) => Popsicle
  form: typeof form
  jar: typeof jar
  browser: boolean

  get (options: RequestOptions | string): Request
  post (options: RequestOptions | string): Request
  put (options: RequestOptions | string): Request
  head (options: RequestOptions | string): Request
  delete (options: RequestOptions | string): Request
  options (options: RequestOptions | string): Request
  trace (options: RequestOptions | string): Request
  copy (options: RequestOptions | string): Request
  lock (options: RequestOptions | string): Request
  mkcol (options: RequestOptions | string): Request
  move (options: RequestOptions | string): Request
  purge (options: RequestOptions | string): Request
  propfind (options: RequestOptions | string): Request
  proppatch (options: RequestOptions | string): Request
  unlock (options: RequestOptions | string): Request
  report (options: RequestOptions | string): Request
  mkactivity (options: RequestOptions | string): Request
  checkout (options: RequestOptions | string): Request
  merge (options: RequestOptions | string): Request
  'm-search' (options: RequestOptions | string): Request
  notify (options: RequestOptions | string): Request
  subscribe (options: RequestOptions | string): Request
  unsubscribe (options: RequestOptions | string): Request
  patch (options: RequestOptions | string): Request
  search (options: RequestOptions | string): Request
  connect (options: RequestOptions | string): Request
}

/**
 * Generate a default popsicle instance.
 */
export function defaults (defaultsOptions: DefaultsOptions): Popsicle {
  const popsicle = function popsicle (options: RequestOptions | string) {
    const opts = extendDefaults(defaultsOptions, options)

    if (typeof opts.url !== 'string') {
      throw new TypeError('No URL specified')
    }

    return new Request(opts)
  } as Popsicle

  popsicle.Request = Request
  popsicle.Response = Response
  popsicle.Error = PopsicleError
  popsicle.plugins = plugins
  popsicle.form = form
  popsicle.jar = jar
  popsicle.browser = !!process.browser

  // Extend defaults from the current defaults.
  popsicle.defaults = function (options: DefaultsOptions) {
    return defaults(extend(defaultsOptions, options))
  }

  methods.forEach(function (method) {
    ;(<any> popsicle)[method] = function (options: RequestOptions | string) {
      return popsicle(extendDefaults({ method }, options))
    }
  })

  return popsicle
}
