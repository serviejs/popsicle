import { Request, Response } from 'servie'
import { Middleware } from 'throwback'
import { PopsicleError } from './error'

/**
 * Request normalization.
 */
export interface NormalizeRequestOptions {
  upgradeInsecureRequests?: boolean
}

/**
 * Default header handling.
 */
export function normalizeRequest <T extends Request, U extends Response> (
  options: NormalizeRequestOptions = {}
): Middleware<T, U> {
  return function (req, next) {
    // Remove headers that should not be created by the user.
    req.headers.delete('Host')

    // If we have no accept header set already, default to accepting
    // everything. This is needed because otherwise Firefox defaults to
    // an accept header of `html/xml`.
    if (!req.headers.get('Accept')) {
      req.headers.set('Accept', '*/*')
    }

    // Request a preference to upgrade to HTTPS.
    if (options.upgradeInsecureRequests !== false && req.Url.protocol === 'http:') {
      req.headers.set('Upgrade-Insecure-Requests', '1')
    }

    return next()
  }
}
