# ![Popsicle](https://cdn.rawgit.com/serviejs/popsicle/master/logo.svg)

[![NPM version](https://img.shields.io/npm/v/popsicle.svg?style=flat)](https://npmjs.org/package/popsicle)
[![NPM downloads](https://img.shields.io/npm/dm/popsicle.svg?style=flat)](https://npmjs.org/package/popsicle)
[![Build status](https://img.shields.io/travis/serviejs/popsicle.svg?style=flat)](https://travis-ci.org/serviejs/popsicle)
[![Test coverage](https://img.shields.io/coveralls/serviejs/popsicle.svg?style=flat)](https://coveralls.io/r/serviejs/popsicle?branch=master)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/popsicle.svg)](https://bundlephobia.com/result?p=popsicle)

> Advanced HTTP requests in node.js and browsers, using [Servie](https://github.com/serviejs/servie).

## Installation

```
npm install popsicle --save
```

## Usage

```js
import { fetch } from "popsicle";

const req = fetch("http://example.com");
```

> Popsicle is a universal package, meaning node.js and browsers are supported without any configuration. This means the primary endpoint requires some `dom` types in TypeScript. When in a node.js or browser only environments prefer importing `popsicle/dist/{node,browser}` instead.

### [Browser](./src/browser.ts)

The middleware stack for browsers contains _only_ the transport layer. This makes the package tiny and quick on browsers.

### [Node.js](./src/node.ts)

The middleware stack for node.js includes a lot more normalization to act similar to browsers:

- Default `User-Agent` initialization
- Default decoding of compressed responses
- Follows valid HTTP redirects
- Caches cookies in-memory

### Errors

Transports can return an error. The built-in codes are documented below:

- **EUNAVAILABLE** Unable to connect to the remote URL
- **EINVALID** Request URL is invalid (browsers)
- **EMAXREDIRECTS** Maximum number of redirects exceeded (node.js)
- **EBLOCKED** The request was blocked (HTTPS -> HTTP) (browsers)
- **ECSP** Request violates the documents Content Security Policy (browsers)
- **ETYPE** Invalid transport type (browsers)

### Customization

Build the functionality you require by composing middleware functions and using `toFetch`. See [`src/node.ts`](./src/node.ts) for an example.

## Plugins

- [Popsicle Status](https://github.com/serviejs/popsicle-status) - Reject on invalid HTTP status codes
- [Popsicle Retry](https://github.com/serviejs/popsicle-retry) - Retry HTTP requests on bad server responses

### Creating Plugins

See [Throwback](https://github.com/serviejs/throwback#usage) for more information:

```ts
type Plugin = (
  req: Request,
  next: () => Promise<Response>
) => Promise<Response>;
```

## TypeScript

This project is written using [TypeScript](https://github.com/Microsoft/TypeScript) and publishes the types to NPM alongside the package.

## Related Projects

- [Superagent](https://github.com/visionmedia/superagent) - HTTP requests for node and browsers
- [Fetch](https://github.com/github/fetch) - Browser polyfill for promise-based HTTP requests
- [Axios](https://github.com/mzabriskie/axios) - HTTP request API based on Angular's `$http` service

## License

MIT
