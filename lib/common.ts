import extend = require('xtend')
import Request, { RequestOptions, DefaultsOptions } from './request'
import Response from './response'
import * as plugins from './plugins/index'
import form from './form'
import jar from './jar'
import PopsicleError from './error'
import * as transport from './index'

/**
 * Generate a default popsicle instance.
 */
export function defaults (defaultsOptions: DefaultsOptions) {
  const defaults = extend({ transport }, defaultsOptions)

  return function popsicle (options: RequestOptions | string): Request {
    let opts: RequestOptions

    if (typeof options === 'string') {
      opts = extend(defaults, { url: options })
    } else {
      opts = extend(defaults, options)
    }

    if (typeof opts.url !== 'string') {
      throw new TypeError('The URL must be a string')
    }

    return new Request(opts)
  }
}

export const browser = !!process.browser
export const request = defaults({})

export const get = defaults({ method: 'get' })
export const post = defaults({ method: 'post' })
export const put = defaults({ method: 'put' })
export const patch = defaults({ method: 'patch' })
export const del = defaults({ method: 'delete' })
export const head = defaults({ method: 'head' })

export { Request, Response, plugins, form, jar, transport }

export default request
