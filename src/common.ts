import { Composed } from "throwback";
import { CommonRequest, CommonResponse } from "servie/dist/common";

/**
 * Create a `fetch` like interface from middleware stack.
 */
export function toFetch<
  T extends CommonRequest,
  U extends CommonResponse,
  A extends any[]
>(middleware: Composed<T, U>, Request: new (...args: A) => T) {
  function done(): never {
    throw new TypeError("Invalid middleware stack, missing transport function");
  }

  return function fetch(...args: A) {
    const req = args[0] instanceof Request ? args[0] : new Request(...args);

    return middleware(req, done);
  };
}
