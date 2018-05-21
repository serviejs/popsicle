import { Request } from 'servie'

import {
  HttpResponse,
  request as nodeRequest,
  RequestOptions as NodeRequestOptions,
  transport as nodeTransport,
  TransportOptions as NodeTransportOptions
} from './node'
import {
  XhrResponse,
  RequestOptions as BrowserRequestOptions,
  TransportOptions as BrowserTransportOptions
} from './browser'

export type SendFn = (req: Request) => Promise<HttpResponse | XhrResponse>
export type TransportFn = (options?: NodeTransportOptions & BrowserTransportOptions) => SendFn
export type RequestFn = (url: string, options: NodeRequestOptions & BrowserRequestOptions) => Request

export const request: RequestFn = nodeRequest
export const transport: TransportFn = nodeTransport
