export * from './common'
import { headers, parse, stringify } from './common'
import { Middleware } from '../request'

export const defaults: Middleware[] = [stringify(), headers(), parse()]
