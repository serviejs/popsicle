import { Request } from "servie/dist/node";
import { compose } from "throwback";
import { transport, HttpResponse } from "popsicle-transport-http";
import { cookies } from "popsicle-cookie-jar";
import { contentEncoding } from "popsicle-content-encoding";
import { redirects } from "popsicle-redirects";
import { userAgent } from "popsicle-user-agent";
import { toFetch } from "./common";

/**
 * Expose node.js components.
 */
export {
  contentEncoding,
  cookies,
  HttpResponse,
  redirects,
  Request,
  toFetch,
  transport,
  userAgent
};

/**
 * Node.js standard middleware stack.
 */
export const middleware = compose<Request, HttpResponse>([
  userAgent(),
  contentEncoding(),
  // Redirects must happen around cookie support.
  redirects(compose([cookies(), transport()]))
]);

/**
 * Standard node.js fetch interface.
 */
export const fetch = toFetch(middleware, Request);
