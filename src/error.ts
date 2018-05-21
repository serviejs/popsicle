import { BaseError } from 'make-error-cause'
import { Request } from 'servie'

export class PopsicleError extends BaseError {

  code: string
  request: Request

  constructor (message: string, code: string, request: Request, cause?: Error) {
    super(message, cause)

    this.code = code
    this.request = request
  }

}
