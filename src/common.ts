import FormData = require('form-data')
import { Request, RequestOptions, DefaultsOptions } from './request'
import * as plugins from './plugins/index'
import form from './form'
import jar from './jar'
import PopsicleError from './error'
import { createTransport } from './index'

/**
 * Generate a default popsicle instance.
 */
export function defaults (defaultsOptions: DefaultsOptions) {
  const transport = createTransport({ type: 'text' })
  const defaults = Object.assign({}, { transport }, defaultsOptions)

  return function popsicle (options: RequestOptions | string): Request {
    const opts: RequestOptions = Object.assign({}, defaults, typeof options === 'string' ? { url: options } : options)

    if (typeof opts.url !== 'string') {
      throw new TypeError('The URL must be a string')
    }

    return new Request(opts)
  }
}

export const request = defaults({})

export const get = defaults({ method: 'get' })
export const post = defaults({ method: 'post' })
export const put = defaults({ method: 'put' })
export const patch = defaults({ method: 'patch' })
export const del = defaults({ method: 'delete' })
export const head = defaults({ method: 'head' })

export { PopsicleError, FormData, plugins, form, jar, createTransport }

export * from './base'
export * from './request'
export * from './response'

export default request
