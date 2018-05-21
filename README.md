# ![Popsicle](https://cdn.rawgit.com/serviejs/popsicle/master/logo.svg)

[![NPM version](https://img.shields.io/npm/v/popsicle.svg?style=flat)](https://npmjs.org/package/popsicle)
[![NPM downloads](https://img.shields.io/npm/dm/popsicle.svg?style=flat)](https://npmjs.org/package/popsicle)
[![Build status](https://img.shields.io/travis/serviejs/popsicle.svg?style=flat)](https://travis-ci.org/serviejs/popsicle)
[![Test coverage](https://img.shields.io/coveralls/serviejs/popsicle.svg?style=flat)](https://coveralls.io/r/serviejs/popsicle?branch=master)

> Advanced HTTP requests in node.js and browsers, using [Servie](https://github.com/serviejs/servie).

## Installation

```
npm install popsicle --save
```

## Usage

```js
import { transport, request } from 'popsicle'

const req = request('http://example.com') // Creates a `Request` instance.
const res = await transport()(req) // Transports `Request` and returns `Response` instance.
```

Thin wrapper to transport [Servie](https://github.com/serviejs/servie) HTTP request interfaces.

**P.S.** The default export from `popsicle` is `universal.js`. In TypeScript, this can cause trouble with types. Use specific imports such as `popsicle/dist/{browser,node,universal}` instead, depending on preference.

### Node.js Normalization

Normalizes some behavior that happens automatically in browsers (each normalization can be disabled).

* Default `User-Agent` insertion
* Default unzip behaviour of `gzip` and `deflate` encoding
* Follows HTTP redirects

### Built-in Transports

#### HTTP (node.js)

* **unzip: boolean** Automatically unzip response bodies (default: `true`)
* **follow: boolean** Automatically follow HTTP redirects (default: `true`)
* **jar: CookieJar** An instance of a cookie jar (`jar()` from `node.js` import)
* **maxRedirects: number** Override the number of redirects allowed (default: `5`)
* **confirmRedirect: Function** Validate `307` and `308` redirects (default: `() => false`)
* **rejectUnauthorized: boolean** Reject invalid SSL certificates (default: `true`)
* **agent: http.Agent** Custom `http.request` agent
* **ca: string | Buffer** A string, `Buffer` or array of strings or `Buffers` of trusted certificates in PEM format
* **key: string | Buffer** Private key to use for SSL
* **cert: string | Buffer** Public x509 certificate to use
* **secureProtocol: string** Optional SSL method to use

#### XHR (browsers)

* **type: XMLHttpRequestResponseType** Handle the XHR response (default: `text`)
* **withCredentials: boolean** Send cookies with CORS requests (default: `false`)
* **overrideMimeType: string** Override the XHR response MIME type

#### Errors

Transports can return an error. Errors have a `request` property set to the request object and a `code` string. The built-in codes are documented below:

* **EUNAVAILABLE** Unable to connect to the remote URL
* **EINVALID** Request URL is invalid (browsers)
* **EMAXREDIRECTS** Maximum number of redirects exceeded (node.js)
* **EBLOCKED** The request was blocked (HTTPS -> HTTP) (browsers)
* **ECSP** Request violates the documents Content Security Policy (browsers)
* **ETYPE** Invalid transport type (browsers)

### Plugins

_Coming back soon._

### Helpful Utilities

* [`throat`](https://github.com/ForbesLindesay/throat) - Throttle promise-based functions with concurrency support
* [`is-browser`](https://github.com/ForbesLindesay/is-browser) - Check if your in a browser environment (E.g. Browserify, Webpack)
* [`parse-link-header`](https://github.com/thlorenz/parse-link-header) - Handy for parsing HTTP link headers

### Creating Plugins

See [Throwback](https://github.com/serviejs/throwback#usage) for more information:

```ts
type Plugin = (req: Request, next: (req?: Request) => Promise<Response>) => Promise<Response>
```

### Transportation Layers

See [Servie](https://github.com/serviejs/servie#implementers) for more information:

```ts
type Transport = (req: Request) => Promise<Response>
```

## TypeScript

This project is written using [TypeScript](https://github.com/Microsoft/TypeScript) and publishes the types to NPM alongside the package.

## Related Projects

* [Superagent](https://github.com/visionmedia/superagent) - HTTP requests for node and browsers
* [Fetch](https://github.com/github/fetch) - Browser polyfill for promise-based HTTP requests
* [Axios](https://github.com/mzabriskie/axios) - HTTP request API based on Angular's `$http` service

## License

MIT
