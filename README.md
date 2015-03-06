# ![Popsicle](https://cdn.rawgit.com/blakeembrey/popsicle/master/logo.svg)

[![NPM version][npm-image]][npm-url]
[![NPM downloads][downloads-image]][downloads-url]
[![Build status][travis-image]][travis-url]

**Popsicle** is designed to be easiest way for making HTTP requests, offering a consistent and intuitive API that works on both node and the browser.

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

**Node only**

* **jar** An instance of a cookie jar (default: `null`)
* **rejectUnauthorized** Reject invalid SSL certificates (default: `true`)

**Browser only**

* **withCredentials** Send cookies with CORS requests (default: `false`)

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

You can manually create a form data instance by calling `popsicle.form`. When you pass a form data instance, it'll automatically set the correct `Content-Type` - complete with boundary.

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

#### Progress

The request object can also be used to check progress at any time.

* **req.uploadSize** Current upload size in bytes
* **req.uploadTotal** Total upload size in bytes
* **req.uploaded** Total uploaded as a percentage
* **req.downloadSize** Current download size in bytes
* **req.downloadTotal** Total download size in bytes
* **req.downloaded** Total downloaded as a percentage
* **req.completed** Total uploaded and downloaded as a percentage

All percentage properties (`req.uploaded`, `req.downloaded`, `req.completed`) will be a number between `0` and `1`. When the total size is unknown (no `Content-Length` header), the percentage will automatically increment on each chunk of data returned (this will not be accurate). Aborting a request will automatically emit a completed progress event.

```javascript
var req = request('http://example.com');

req.uploaded; //=> 0
req.downloaded; //=> 0

req.progress(function (e) {
  console.log(e); //=> { uploaded: 1, downloaded: 0, completed: 0.5, aborted: false }
});

req.then(function (res) {
  console.log(req.downloaded); //=> 1
});
```

#### Cookie Jar (Node only)

You can create a reusable cookie jar instance for requests by calling `popsicle.jar`.

```javascript
var jar = request.jar();

request({
  method: 'POST',
  url: '/users',
  jar: jar
});
```

### Handling Responses

Promises and node-style callbacks are supported.

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
* **name(key)** Retrieve the original HTTP header name using a case-insensitive key
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

A simple plugin interface is exposed through `Request#use`.

#### Existing Plugins

* [Server](https://github.com/blakeembrey/popsicle-server) - Automatically mount servers with each request for testing
* [Status](https://github.com/blakeembrey/popsicle-status) - Reject responses on HTTP failure status codes
* [No Cache](https://github.com/blakeembrey/popsicle-no-cache) - Prevent caching of HTTP requests
* [Basic Auth](https://github.com/blakeembrey/popsicle-basic-auth) - Add basic authentication to requests
* [Prefix](https://github.com/blakeembrey/popsicle-prefix) - Automatically prefix all HTTP requests
* [Constants](https://github.com/blakeembrey/popsicle-constants) - Replace constants in the URL string

#### Using Plugins

Plugins should expose a single function that accepts a `Request` instance. For example:

```javascript
function prefix (url) {
  return function (req) {
    req.url = url + req.url;
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

```
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
[downloads-image]: https://img.shields.io/npm/dm/popsicle.svg?style=flat
[downloads-url]: https://npmjs.org/package/popsicle
[travis-image]: https://img.shields.io/travis/blakeembrey/popsicle.svg?style=flat
[travis-url]: https://travis-ci.org/blakeembrey/popsicle
