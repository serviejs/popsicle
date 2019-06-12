import { Request } from "servie/dist/browser";
import { transport, XhrResponse } from "popsicle-transport-xhr";
import { toFetch } from "./common";

export * from "servie/dist/signal";
export * from "servie/dist/headers";

/**
 * Expose browser components.
 */
export { Request, toFetch, transport, XhrResponse };

/**
 * Browser standard middleware stack.
 */
export const middleware = transport();

/**
 * Standard browser fetch interface.
 */
export const fetch = toFetch(middleware, Request);
