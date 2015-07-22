import Base, { BaseOptions, Headers } from './base'
import Request, { PopsicleError } from './request'

export interface ResponseOptions extends BaseOptions {
  body: any
  status: number
}

export interface ResponseJSON {
  headers: Headers
  body: any
  url: string
  status: number
}

export default class Response extends Base {
  status: number
  body: any
  request: Request

  constructor (options: ResponseOptions) {
    super(options)

    this.body = options.body
    this.status = options.status
  }

  statusType () {
    return ~~(this.status / 100)
  }

  error (message: string, type: string, error?: Error) {
    return this.request.error(message, type, error)
  }

  toJSON (): ResponseJSON {
    return {
      headers: this.get(),
      body: this.body,
      url: this.fullUrl(),
      status: this.status
    }
  }

}
