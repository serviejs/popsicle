# ![Popsicle](https://cdn.rawgit.com/blakeembrey/popsicle/master/logo.svg)

[![NPM version][npm-image]][npm-url]
[![Build status][travis-image]][travis-url]

**Popsicle** is designed to be easiest way for making HTTP requests, offering a consistant and intuitive API that works on both node and the browser.

```javascript
request('/users.json')
  .then(function (res) {
    console.log(res.body); //=> { ... }
  });
```

## Installation

```bash
npm install popsicle --save
bower install popsicle --save
```

You will need a [promise polyfill](https://github.com/jakearchibald/es6-promise) for older browsers and node <= `0.11.12`.

```bash
npm install es6-promise --save
bower install es6-promise --save
```

Apply the polyfill.

```javascript
// Node and browserify
require('es6-promise').polyfill();

// Browsers
window.ES6Promise.polyfill();
```

## Usage

```javascript
var request = require('popsicle');
// var request = window.popsicle;

request({
  method: 'POST',
  url: 'http://example.com/api/users',
  body: {
    username: 'blakeembrey',
    password: 'hunter2'
  },
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  }
})
  .then(function (res) {
    console.log(res.status); // => 200
    console.log(res.body); //=> { ... }
    console.log(res.get('Content-Type')); //=> 'application/json'
  });
```

### Handling Requests

* **url** The resource URI
* **method** The HTTP request method (default: `"GET"`)
* **headers** An object of HTTP headers, header name to value (default: `{}`)
* **query** An object or string to be appended to the URL
* **body** An object, string or form data to pass with the request
* **timeout** The number of milliseconds before cancelling the request (default: `Infinity`)

#### Automatically Serializing Body

Popsicle can automatically serialize the request body to a string. If an object is supplied, it'll automatically stringify as JSON unless the `Content-Type` header was set otherwise. If the `Content-Type` is `multipart/form-data` or `application/x-www-form-urlencoded`, it can also be automatically serialized.

```javascript
request({
  url: 'http://example.com/api/users',
  body: {
    username: 'blakeembrey',
    profileImage: fs.createReadStream('image.png')
  },
  headers: {
    'Content-Type': 'multipart/form-data'
  }
});
```

#### Multipart Request Bodies

You can manually create a form data instance by calling `popsicle.form`. When you pass a form data instance, it'll automatically set the correct `Content-Type` too - complete with the boundary.

```javascript
var form = request.form({
  name: 'Blake Embrey',
  image: '...'
});

request({
  method: 'POST',
  url: '/users',
  body: form
});
```

#### Aborting Requests

All requests can be aborted during execution by calling `Request#abort`. Requests won't normally start until chained anyway, but this will also abort the request before it starts.

```javascript
var req = request('http://example.com');

setTimeout(function () {
  req.abort();
}, 100);

req.catch(function (err) {
  console.log(err); //=> { message: 'Request aborted', aborted: true }
});
```

#### Download Progress

The request object can also be used to check progress at any time. However, the URL must have responded with a `Content-Length` header for this to work properly.

```javascript
var req = request('http://example.com');

req.downloaded(); //=> 0

req.then(function (res) {
  console.log(req.downloaded()); //=> 1
});
```

### Handling Responses

Popsicle responses can be handled in multiple ways. Promises, node-style callbacks and streams (node only) are all supported.

#### Promises

Promises are the most expressive interface. Just chain using `Request#then` or `Request#catch` and continue.

```javascript
request('/users')
  .then(function (res) {
    // Things worked!
  })
  .catch(function (err) {
    // Something broke.
  });
```

#### Callbacks

For tooling that expect node-style callbacks, you can use `Request#exec`. This accepts a single function to call when the response is complete.

```javascript
request('/users')
  .exec(function (err, res) {
    if (err) {
      // Something broke.
    }

    // Success!
  });
```

#### Streams (Node only)

On node, you can also chain using streams. However, the API is currently incomplete.

```javascript
request('/users')
  .pipe(fs.createWriteStream('users.json'));
```

### Response Objects

Every Popsicle response will give a `Response` object on success. The object provides an intuitive interface for requesting common properties.

* **status** An integer representing the HTTP response status code
* **body** An object (if parsable) or string that was the response HTTP body
* **headers** An object of lower-cased keys to header values
* **statusType()** Return an integer with the HTTP status type (E.g. `200 -> 2`)
* **info()** Return a boolean indicating a HTTP status code between 100 and 199
* **ok()** Return a boolean indicating a HTTP status code between 200 and 299
* **clientError()** Return a boolean indicating a HTTP status code between 400 and 499
* **serverError()** Return a boolean indicating a HTTP status code between 500 and 599
* **get(key)** Retrieve a HTTP header using a case-insensitive key
* **type()** Return the response type (E.g. `application/json`)

### Error Handling

All response handling methods can return an error. The errors can be categorized by checking properties on the error instance.

* **parse error** Response body failed to parse - invalid body or incorrect type (`err.parse`)
* **abort error** The request was aborted by user intervention (`err.abort`)
* **timeout error** The request timed out (`err.timeout`)
* **unavailable error** Unable to connect to the remote URL (`err.unavailable`)
* **blocked error** The request was blocked (HTTPS -> HTTP) (browsers, `err.blocked`)
* **csp error** Request violates the documents Content Security Policy (browsers, `err.csp`)

### Plugins

A simple plugin interface is exposed through `Request#use` and promises.

#### Existing Plugins

* [Status](https://github.com/blakeembrey/popsicle-status) - Reject responses on HTTP failure status codes
* [No Cache](https://github.com/blakeembrey/popsicle-no-cache) - Prevent caching of HTTP requests
* [Basic Auth](https://github.com/blakeembrey/popsicle-basic-auth) - Add basic authentication to requests
* [Prefix](https://github.com/blakeembrey/popsicle-prefix) - Automatically prefix all HTTP requests

#### Using Plugins

Plugins should expose a single function that accepts a `Request` instance. For example:

```javascript
function prefix (uri) {
  return function (req) {
    req.url = uri + req.url;
  };
}

request('/user')
  .use(prefix('http://example.com'))
  .then(function (res) {
    console.log(res.request.url); //=> "http://example.com/user"
  });
```

## Development and Testing

Install dependencies and run the test runners (node and browsers using Karma).

```bash
npm install && npm test
```

## Related Projects

* [Superagent](https://github.com/visionmedia/superagent) - HTTP requests on node and browser
* [Fetch](https://github.com/github/fetch) - Browser polyfill for promise-based HTTP requests
* [Axios](https://github.com/mzabriskie/axios) - Similar API based on Angular's $http service

## License

MIT

[npm-image]: https://img.shields.io/npm/v/popsicle.svg?style=flat
[npm-url]: https://npmjs.org/package/popsicle
[travis-image]: https://img.shields.io/travis/blakeembrey/popsicle.svg?style=flat
[travis-url]: https://travis-ci.org/blakeembrey/popsicle
