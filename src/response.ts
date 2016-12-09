import { Base, BaseOptions, Headers } from './base'

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

export class Response extends Base {
  status: number
  statusText: string
  body: any

  constructor (options: ResponseOptions) {
    super(options)

    this.body = options.body
    this.status = options.status
    this.statusText = options.statusText
  }

  statusType () {
    return ~~(this.status / 100)
  }

  toJSON (): ResponseJSON {
    return {
      url: this.url,
      headers: this.headers,
      body: this.body,
      status: this.status,
      statusText: this.statusText
    }
  }

}
