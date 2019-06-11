import { Request } from "servie/dist/browser";
import { transport, XhrResponse } from "popsicle-transport-xhr";
import { toFetch } from "./common";

/**
 * Expose browser components.
 */
export { transport, Request, XhrResponse, toFetch };

/**
 * Browser standard middleware stack.
 */
export const middleware = transport();

/**
 * Standard browser fetch interface.
 */
export const fetch = toFetch(middleware, Request);
