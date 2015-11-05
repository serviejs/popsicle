import Base, { BaseOptions, Headers } from './base'
import Request, { PopsicleError } from './request'

export interface ResponseOptions extends BaseOptions {
  body: any
  status: number
  statusText: string
}

export interface ResponseJSON {
  headers: Headers
  body: any
  url: string
  status: number
  statusText: string
}

export default class Response extends Base {
  status: number
  statusText: string
  body: any
  request: Request

  constructor (options: ResponseOptions) {
    super(options)

    this.body = options.body
    this.status = options.status
    this.statusText = options.statusText
  }

  statusType () {
    return ~~(this.status / 100)
  }

  error (message: string, type: string, error?: Error) {
    return this.request.error(message, type, error)
  }

  toJSON (): ResponseJSON {
    return {
      url: this.fullUrl(),
      headers: this.get(),
      body: this.body,
      status: this.status,
      statusText: this.statusText
    }
  }

}
