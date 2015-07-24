/* global define */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory)
  } else if (typeof exports === 'object') {
    module.exports = factory()
  } else {
    root.popsicle = factory()
  }
})(this, function () {
  var isNode = typeof window === 'undefined'
  var root = isNode ? global : window
  var Buffer = isNode ? require('buffer').Buffer : null
  var FormData = isNode ? require('form-data') : window.FormData

  var _hasOwnProperty = Object.prototype.hasOwnProperty

  var FORM_EQ = '='
  var FORM_SEP = '&'

  var JSON_MIME_REGEXP = /^application\/(?:[\w!#\$%&\*`\-\.\^~]*\+)?json$/i
  var QUERY_MIME_REGEXP = /^application\/x-www-form-urlencoded$/i
  var FORM_MIME_REGEXP = /^multipart\/form-data$/i

  var jar
  var isHostObject
  var createRequest
  var parseRawHeaders

  if (typeof Promise === 'undefined') {
    var PROMISE_ERROR_MESSAGE = (!isNode ? 'global' : 'window') +
      '.Promise is undefined and must be polyfilled. Check out ' +
      'https://github.com/jakearchibald/es6-promise for more information.'

    throw new TypeError(PROMISE_ERROR_MESSAGE)
  }

  /**
   * Copy objects onto another.
   *
   * @param  {Object} dest
   * @return {Object}
   */
  function assign (dest /*, ...src */) {
    for (var i = 1; i < arguments.length; i++) {
      for (var key in arguments[i]) {
        if (_hasOwnProperty.call(arguments[i], key)) {
          dest[key] = arguments[i][key]
        }
      }
    }

    return dest
  }

  /**
   * Create a function to set progress properties on a request instance.
   *
   * @param  {String}   property
   * @param  {String}   callback
   * @return {Function}
   */
  function setProgress (property, callback) {
    return function (req, num) {
      if (req[property] === num) {
        return
      }

      req[property] = num

      callback(req)
      req.completed = (req.uploaded + req.downloaded) / 2

      emitProgress(req, req._progress)
    }
  }

  /**
   * Generate a random number between two digits.
   *
   * @param  {Number} low
   * @param  {Number} high
   * @return {Number}
   */
  function between (low, high) {
    var diff = high - low

    return Math.random() * diff + low
  }

  /**
   * Calculate the percentage of a request.
   *
   * @param  {Number} size
   * @param  {Number} total
   * @return {Number}
   */
  function calc (n, size, total) {
    if (isNaN(total)) {
      return n + ((1 - n) * between(0.1, 0.45))
    }

    return Math.min(1, size / total)
  }

  /**
   * Turn a value into a number (avoid `null` becoming `0`).
   *
   * @param  {String} str
   * @return {Number}
   */
  function num (str) {
    return str == null ? NaN : Number(str)
  }

  /**
   * Check if an object is actually an object (not a primitive type).
   *
   * @param  {Object}  obj
   * @return {Boolean}
   */
  function isObject (obj) {
    return Object(obj) === obj
  }

  /**
   * Check if an object is actually a stream.
   *
   * @param  {Object}  obj
   * @return {Boolean}
   */
  function isStream (obj) {
    return typeof obj.pipe === 'function'
  }

  /**
   * Create a timeout error instance.
   *
   * @param  {Request} req
   * @return {Error}
   */
  function abortError (req) {
    if (req._error) {
      return req._error
    }

    if (!req.timedout) {
      var abortedError = req.error('Request aborted')
      abortedError.abort = true
      return abortedError
    }

    var timeout = req.timeout
    var timedoutError = req.error('Timeout of ' + timeout + 'ms exceeded')
    timedoutError.timeout = timeout
    return timedoutError
  }

  /**
   * Create a parse error instance.
   *
   * @param  {Request} req
   * @param  {Error}   e
   * @return {Error}
   */
  function parseError (req, e) {
    var err = req.error('Unable to parse the response body')
    err.parse = true
    err.original = e
    return err
  }

  /**
   * Create a stringify error instance.
   *
   * @param  {Request} req
   * @param  {Error}   e
   * @return {Error}
   */
  function stringifyError (req, e) {
    var err = req.error('Unable to stringify the request body')
    err.stringify = true
    err.original = e
    return err
  }

  /**
   * Create a CSP error instance (Content Security Policy).
   *
   * @param  {Request} req
   * @param  {Error}   e
   * @return {Error}
   */
  function cspError (req, e) {
    var err = req.error('Refused to connect to "' + req.fullUrl() + '"')
    err.csp = true
    err.original = e
    return err
  }

  /**
   * Create an unavailable request error (offline, not resolvable, CORS).
   *
   * @param  {Request} req
   * @return {Error}
   */
  function unavailableError (req, e) {
    var err = req.error('Unable to connect to "' + req.fullUrl() + '"')
    err.unavailable = true
    err.original = e
    return err
  }

  /**
   * Create a blocked error (HTTPS -> HTTP).
   *
   * @param  {Request} req
   * @return {Error}
   */
  function blockedError (req) {
    var err = req.error('The request to "' + req.fullUrl() + '" was blocked')
    err.blocked = true
    return err
  }

  /**
   * Create a maximum redirection error.
   *
   * @param  {Request} req
   * @return {Error}
   */
  function redirectError (req) {
    var err = req.error('Maximum number of redirects exceeded')
    err.maxRedirects = req.maxRedirects
    return err
  }

  /**
   * Return the content type from a header string.
   *
   * @param  {String} str
   * @return {String}
   */
  function type (str) {
    return str == null ? '' : str.split(/ *; */)[0]
  }

  /**
   * Encode a URI component according to the spec.
   *
   * @param  {String} str
   * @return {String}
   */
  function encode (str) {
    if (str == null) {
      return ''
    }

    return encodeURIComponent(str)
      .replace(/[!'()]/g, root.escape)
      .replace(/\*/g, '%2A')
  }

  /**
   * Append a value to an object using the key.
   *
   * @param  {Object} object
   * @param  {String} key
   * @param  {String} value
   * @return {Object}
   */
  function append (object, key, value) {
    if (!object[key]) {
      object[key] = value
    } else if (Array.isArray(object[key])) {
      object[key].push(value)
    } else {
      object[key] = [object[key], value]
    }
  }

  /**
   * Turn an object into a query string.
   *
   * @param  {Object} obj
   * @return {String}
   */
  function stringifyQuery (obj) {
    var params = []

    Object.keys(obj).forEach(function (key) {
      var value = obj[key]
      var keyStr = encode(key) + FORM_EQ

      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) {
          params.push(keyStr + encode(value[i]))
        }
      } else {
        params.push(keyStr + encode(value))
      }
    })

    return params.join(FORM_SEP)
  }

  /**
   * Convert a query string into an object.
   *
   * @param  {String} qs
   * @return {Object}
   */
  function parseQuery (qs) {
    // Unable to parse empty values.
    if (qs == null || qs === '') {
      return null
    }

    qs = String(qs).split(FORM_SEP)

    var obj = {}
    var maxKeys = 1000
    var len = qs.length > maxKeys ? maxKeys : qs.length

    for (var i = 0; i < len; i++) {
      var key = qs[i].replace(/\+/g, '%20')
      var value = ''
      var index = key.indexOf(FORM_EQ)

      if (index !== -1) {
        value = key.substr(index + 1)
        key = key.substr(0, index)
      }

      key = decodeURIComponent(key)
      value = decodeURIComponent(value)

      if (!_hasOwnProperty.call(obj, key)) {
        obj[key] = value
      } else if (Array.isArray(obj[key])) {
        obj[key].push(value)
      } else {
        obj[key] = [obj[key], value]
      }
    }

    return obj
  }

  /**
   * Convert an object into a form data instance.
   *
   * @param  {Object}   parameters
   * @return {FormData}
   */
  function form (obj) {
    var form = new FormData()

    if (Object(obj) === obj) {
      Object.keys(obj).forEach(function (name) {
        form.append(name, obj[name])
      })
    }

    return form
  }

  /**
   * Convert the request body into a valid string.
   *
   * @param {Request} req
   */
  function stringifyRequest (req) {
    var body = req.body

    // Convert primitives types into strings.
    if (!isObject(body)) {
      req.body = body == null ? null : String(body)

      return
    }

    // Return supported objects.
    if (isHostObject(body)) {
      return
    }

    var type = req.type()

    // Set the default mime type to be JSON if none exists.
    if (!type) {
      type = 'application/json'

      req.type(type)
    }

    try {
      if (JSON_MIME_REGEXP.test(type)) {
        req.body = JSON.stringify(body)
      } else if (FORM_MIME_REGEXP.test(type)) {
        req.body = form(body)
      } else if (QUERY_MIME_REGEXP.test(type)) {
        req.body = stringifyQuery(body)
      }
    } catch (e) {
      return Promise.reject(stringifyError(req, e))
    }
  }

  /**
   * Automatically parse the response body.
   *
   * @param  {Response} res
   * @return {Promise}
   */
  function parseResponse (res) {
    var body = res.body
    var type = res.type()

    if (body === '') {
      res.body = null

      return res
    }

    try {
      if (JSON_MIME_REGEXP.test(type)) {
        res.body = body === '' ? null : JSON.parse(body)
      } else if (QUERY_MIME_REGEXP.test(type)) {
        res.body = parseQuery(body)
      }
    } catch (e) {
      return Promise.reject(parseError(res, e))
    }
  }

  /**
   * Set the default request accept header.
   *
   * @param {Request} req
   */
  function defaultHeaders (req) {
    // If we have no accept header set already, default to accepting
    // everything. This is needed because otherwise Firefox defaults to
    // an accept header of `html/xml`.
    if (!req.get('Accept')) {
      req.set('Accept', '*/*')
    }

    // Always remove the "Host" HTTP header.
    req.remove('Host')

    if (isNode) {
      // Specify a default user agent in node.
      if (!req.get('User-Agent')) {
        req.set('User-Agent', 'https://github.com/blakeembrey/popsicle')
      }

      // Accept zipped responses.
      if (!req.get('Accept-Encoding')) {
        req.set('Accept-Encoding', 'gzip,deflate')
      }

      // Manually set the `Content-Length` and `Content-Type` headers from the
      // form data object because we need to handle boundaries and streams.
      if (req.body instanceof FormData) {
        req.set('Content-Type', 'multipart/form-data; boundary=' + req.body.getBoundary())

        // Asynchronously compute the content length.
        return new Promise(function (resolve, reject) {
          req.body.getLength(function (err, length) {
            if (err) {
              req.set('Transfer-Encoding', 'chunked')
            } else {
              req.set('Content-Length', length)
            }

            return resolve()
          })
        })
      }

      var length = 0
      var body = req.body

      // Attempt to manually compute the content length.
      if (body && !req.get('Content-Length')) {
        if (Array.isArray(body)) {
          for (var i = 0; i < body.length; i++) {
            length += body[i].length
          }
        } else if (typeof body === 'string') {
          length = Buffer.byteLength(body)
        } else {
          length = body.length
        }

        if (length) {
          req.set('Content-Length', length)
        } else if (isStream(body)) {
          req.set('Transfer-Encoding', 'chunked')
        } else {
          return Promise.reject(req.error('Argument error, `options.body`'))
        }
      }

      return
    }

    // Remove the `Content-Type` header from form data requests. Browsers
    // will only fill it automatically when it doesn't exist.
    if (req.body instanceof FormData) {
      req.remove('Content-Type')
    }
  }

  /**
   * Remove all listener functions.
   *
   * @param {Request} req
   */
  function removeListeners (req) {
    req._before = undefined
    req._after = undefined
    req._always = undefined
    req._progress = undefined
    req._error = undefined
    req._raw = undefined
    req.body = undefined
  }

  /**
   * Check if the request has been aborted before starting.
   *
   * @param  {Request} req
   * @return {Promise}
   */
  function checkAborted (req) {
    if (req.aborted) {
      return Promise.reject(abortError(req))
    }
  }

  /**
   * Set headers on an instance.
   *
   * @param {Request} req
   * @param {Object}  headers
   */
  function setHeaders (req, headers) {
    if (headers) {
      Object.keys(headers).forEach(function (key) {
        req.set(key, headers[key])
      })
    }
  }

  /**
   * Get all headers case-sensitive.
   *
   * @param  {Request} req
   * @return {Object}
   */
  function getHeaders (req) {
    var headers = {}

    Object.keys(req.headers).forEach(function (key) {
      headers[req.name(key)] = req.get(key)
    })

    return headers
  }

  /**
   * Lower-case the header name. Allow usage of `Referrer` and `Referer`.
   *
   * @param  {String} key
   * @return {String}
   */
  function lowerHeader (key) {
    var lower = key.toLowerCase()

    if (lower === 'referrer') {
      return 'referer'
    }

    return lower
  }

  /**
   * Set the request to error outside the normal request execution flow.
   *
   * @param {Request} req
   * @param {Error}   err
   */
  function errored (req, err) {
    req._error = err
    req.abort()
  }

  /**
   * Emit a request progress event (upload or download).
   *
   * @param {Array<Function>} fns
   */
  function emitProgress (req, fns) {
    if (!fns || req._error) {
      return
    }

    try {
      for (var i = 0; i < fns.length; i++) {
        fns[i](req)
      }
    } catch (e) {
      errored(req, e)
    }
  }

  /**
   * Set upload progress properties.
   *
   * @type  {Function}
   * @param {Number}   num
   */
  var setUploadSize = setProgress('uploadSize', function (req) {
    var n = req.uploaded
    var size = req.uploadSize
    var total = req.uploadTotal

    req.uploaded = calc(n, size, total)
  })

  /**
   * Set download progress properties.
   *
   * @type  {Function}
   * @param {Number}   num
   */
  var setDownloadSize = setProgress('downloadSize', function (req) {
    var n = req.downloaded
    var size = req.downloadSize
    var total = req.downloadTotal

    req.downloaded = calc(n, size, total)
  })
  /**
   * Finished uploading.
   *
   * @param {Request} req
   */
  function setUploadFinished (req) {
    if (req.uploaded === 1) {
      return
    }

    req.uploaded = 1
    req.completed = 0.5

    emitProgress(req, req._progress)
  }

  /**
   * Finished downloading.
   *
   * @param {Request} req
   */
  function setDownloadFinished (req) {
    if (req.downloaded === 1) {
      return
    }

    req.downloaded = 1
    req.completed = 1

    emitProgress(req, req._progress)
  }

  /**
   * Create a function for pushing functions onto a stack.
   *
   * @param  {String}   prop
   * @return {Function}
   */
  function pushListener (prop) {
    return function (fn) {
      if (this.opened) {
        throw new Error('Listeners can not be added after request has started')
      }

      if (typeof fn !== 'function') {
        throw new TypeError('Expected a function but got ' + fn)
      }

      this[prop] = this[prop] || []
      this[prop].push(fn)
      return this
    }
  }

  /**
   * Create a promise chain.
   *
   * @param  {Array}   fns
   * @param  {*}       arg
   * @return {Promise}
   */
  function chain (fns, arg) {
    return (fns || []).reduce(function (promise, fn) {
      return promise.then(function () {
        return fn(arg)
      })
    }, Promise.resolve())
  }

  /**
   * Setup the request instance.
   *
   * @param {Request} req
   */
  function setup (req) {
    var timeout = req.timeout

    if (timeout) {
      req._timer = setTimeout(function () {
        req.timedout = true
        req.abort()
      }, timeout)
    }

    // Set the request to "opened", disables any new listeners.
    req.opened = true

    return chain(req._before, req)
      .then(function () {
        return createRequest(req)
      })
      .then(function (res) {
        return chain(req._after, res)
      })
      .catch(function (err) {
        function reject () {
          return Promise.reject(err)
        }

        return chain(req._always, req).then(reject)
      })
      .then(function () {
        return chain(req._always, req)
      })
      .then(function () {
        return req.response
      })
  }

  /**
   * Create the HTTP request promise.
   *
   * @param  {Request} req
   * @return {Promise}
   */
  function create (req) {
    // Setup a new promise request if none exists.
    if (!req._promise) {
      req._promise = setup(req)
    }

    return req._promise
  }

  /**
   * Keep track of headers in a single instance.
   */
  function Headers () {
    this.headers = {}
    this.headerNames = {}
  }

  /**
   * Set a header value.
   *
   * @param  {String}  key
   * @param  {String}  value
   * @return {Headers}
   */
  Headers.prototype.set = function (key, value) {
    if (typeof key !== 'string') {
      setHeaders(this, key)

      return this
    }

    var lower = lowerHeader(key)

    if (value == null) {
      delete this.headers[lower]
      delete this.headerNames[lower]
    } else {
      this.headers[lower] = value
      this.headerNames[lower] = key
    }

    return this
  }

  /**
   * Append a header value.
   *
   * @param  {String}  key
   * @param  {String}  value
   * @return {Headers}
   */
  Headers.prototype.append = function (key, value) {
    var prev = this.get(key)
    var val = value

    if (prev) {
      val = Array.isArray(prev) ? prev.concat(value) : [prev].concat(value)
    }

    return this.set(key, val)
  }

  /**
   * Get the original case-sensitive header name.
   *
   * @param  {String} key
   * @return {String}
   */
  Headers.prototype.name = function (key) {
    return this.headerNames[lowerHeader(key)]
  }

  /**
   * Return case-insensitive header.
   *
   * @param  {String} header
   * @return {String}
   */
  Headers.prototype.get = function (header) {
    if (arguments.length === 0) {
      return getHeaders(this)
    }

    return this.headers[lowerHeader(header)]
  }

  /**
   * Remove a header.
   *
   * @param  {String} header
   * @return {Header}
   */
  Headers.prototype.remove = function (header) {
    var lower = lowerHeader(header)

    delete this.headers[lower]
    delete this.headerNames[lower]

    return this
  }

  /**
   * Return or set the content type.
   *
   * @param  {String} [value]
   * @return {String}
   */
  Headers.prototype.type = function (value) {
    if (arguments.length === 0) {
      return type(this.headers['content-type'])
    }

    return this.set('Content-Type', value)
  }

  /**
   * Create a response instance.
   *
   * @param {Request} req
   */
  function Response (req) {
    Headers.call(this)

    this.request = req
    req.response = this
  }

  /**
   * Inherits from `Headers`.
   */
  Response.prototype = Object.create(Headers.prototype)
  Response.prototype.constructor = Response

  /**
   * Return the status type number. E.g. 2 === 201.
   *
   * @return {Number}
   */
  Response.prototype.statusType = function () {
    return ~~(this.status / 100)
  }

  /**
   * Create a popsicle error instance.
   *
   * @param  {String} str
   * @return {Error}
   */
  Response.prototype.error = function (str) {
    return this.request.error(str)
  }

  /**
   * Return a JSON stringify-able object.
   *
   * @return {Object}
   */
  Response.prototype.toJSON = function () {
    return {
      headers: this.get(),
      body: this.body,
      status: this.status
    }
  }

  /**
   * Initialise a request instance.
   *
   * @param {(Object|String)} options
   */
  function Request (options) {
    Headers.call(this)

    var query = options.query

    // Request options.
    this.body = options.body
    this.url = options.url
    this.method = (options.method || 'GET').toUpperCase()
    this.query = assign({}, isObject(query) ? query : parseQuery(query))
    this.timeout = options.timeout

    // Node specific options.
    this.jar = options.jar
    this.maxRedirects = num(options.maxRedirects)
    this.rejectUnauthorized = options.rejectUnauthorized !== false
    this.followRedirects = options.followRedirects !== false
    this.agent = options.agent
    this.stream = options.stream === true
    this.raw = options.raw === true
    this.encoding = options.encoding || 'string'
    this.parse = !this.raw && this.encoding === 'string' && options.parse !== false

    // Default redirect count.
    if (isNaN(this.maxRedirects) || this.maxRedirects < 0) {
      this.maxRedirects = 10
    }

    // Browser specific options.
    this.withCredentials = options.withCredentials === true

    // Progress state.
    this.uploaded = this.downloaded = this.completed = 0
    this.uploadSize = this.downloadSize = 0
    this.uploadTotal = this.downloadTotal = NaN

    // Set request headers.
    this.set(options.headers)

    // Request state.
    this.opened = false
    this.aborted = false

    // Parse query strings already set.
    var queryIndex = options.url.indexOf('?')

    if (queryIndex > -1) {
      this.url = options.url.substr(0, queryIndex)

      // Copy url query parameters onto query object.
      assign(this.query, parseQuery(options.url.substr(queryIndex + 1)))
    }

    this.before(checkAborted)
    this.before(stringifyRequest)
    this.before(defaultHeaders)

    if (this.jar) {
      if (isNode) {
        this.before(getCookieJar)
        this.after(setCookieJar)
      } else {
        throw new TypeError('Option `jar` is not available in browsers')
      }
    }

    if (this.raw) {
      if (!isNode) {
        throw new TypeError('Option `raw` is not available in browsers')
      }
    } else if (isNode) {
      this.after(unzipResponse)
    }

    if (!this.stream) {
      if (isNode) {
        this.after(streamResponse)
      }

      if (this.parse) {
        this.after(parseResponse)
      }
    } else if (!isNode) {
      throw new TypeError('Option `stream` is not available in browsers')
    }

    this.always(removeListeners)
  }

  /**
   * Inherits from `Headers`.
   */
  Request.prototype = Object.create(Headers.prototype)
  Request.prototype.constructor = Request

  /**
   * Return a JSON stringify-able object.
   *
   * @return {Object}
   */
  Request.prototype.toJSON = function () {
    return {
      url: this.fullUrl(),
      method: this.method,
      headers: this.get()
    }
  }

  /**
   * Retrieve the current request URL.
   *
   * @return {String}
   */
  Request.prototype.fullUrl = function () {
    var url = this.url
    var query = stringifyQuery(this.query)

    if (query) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + query
    }

    return url
  }

  /**
   * Track various request states.
   *
   * @param  {Function} fn
   * @return {Request}
   */
  Request.prototype.before = pushListener('_before')
  Request.prototype.after = pushListener('_after')
  Request.prototype.always = pushListener('_always')
  Request.prototype.progress = pushListener('_progress')

  /**
   * Allows request plugins.
   *
   * @return {Request}
   */
  Request.prototype.use = function (fn) {
    fn(this)

    return this
  }

  /**
   * Abort request.
   *
   * @return {Request}
   */
  Request.prototype.abort = function () {
    if (this.aborted) {
      return this
    }

    this.aborted = true
    this.downloaded = this.uploaded = this.completed = 1

    if (this._raw) {
      this._raw.abort()
    }

    emitProgress(this, this._progress)
    clearTimeout(this._timer)

    return this
  }

  /**
   * Create a popsicle error instance.
   *
   * @param  {String} str
   * @return {Error}
   */
  Request.prototype.error = function (str) {
    var err = new Error(str)
    err.popsicle = this
    return err
  }

  /**
   * Support node-style callbacks.
   *
   * @param {Function} cb
   */
  Request.prototype.exec = function exec (cb) {
    this.then(function (value) {
      cb(null, value)
    }).catch(cb)
  }

  /**
   * Standard promise chain method.
   *
   * @param  {Function} onFulfilled
   * @param  {Function} onRejected
   * @return {Promise}
   */
  Request.prototype.then = function (onFulfilled, onRejected) {
    return create(this).then(onFulfilled, onRejected)
  }

  /**
   * Standard promise error handling.
   *
   * @param  {Function} onRejected
   * @return {Promise}
   */
  Request.prototype['catch'] = function (onRejected) {
    return this.then(null, onRejected)
  }

  /**
   * Handle requests differently on node and browsers.
   */
  if (isNode) {
    var http = require('http')
    var https = require('https')
    var urlLib = require('url')
    var zlib = require('zlib')
    var agent = require('infinity-agent')
    var statuses = require('statuses')
    var through2 = require('through2')
    var tough = require('tough-cookie')

    /**
     * Stream node response.
     *
     * @param  {Response} res
     * @return {Promise}
     */
    var streamResponse = function (res) {
      var concat = require('concat-stream')

      return new Promise(function (resolve, reject) {
        var concatStream = concat({
          encoding: res.request.encoding
        }, function (data) {
          // Update the response `body`.
          res.body = data

          return resolve()
        })

        res.body.once('error', reject)
        res.body.pipe(concatStream)
      })
    }

    /**
     * Automatically unzip response bodies.
     *
     * @param {Response} res
     */
    var unzipResponse = function (res) {
      if (['gzip', 'deflate'].indexOf(res.get('Content-Encoding')) !== -1) {
        var unzip = zlib.createUnzip()
        res.body.pipe(unzip)
        res.body = unzip
      }
    }

    /**
     * Read cookies from the cookie jar.
     *
     * @param  {Request} req
     * @return {Promise}
     */
    var getCookieJar = function (req) {
      return new Promise(function (resolve, reject) {
        req.jar.getCookies(req.url, function (err, cookies) {
          if (err) {
            return reject(err)
          }

          if (cookies.length) {
            req.append('Cookie', cookies.join('; '))
          }

          return resolve()
        })
      })
    }

    /**
     * Put cookies in the cookie jar.
     *
     * @param  {Response} res
     * @return {Promise}
     */
    var setCookieJar = function (res) {
      return new Promise(function (resolve, reject) {
        var cookies = res.get('Set-Cookie')

        if (!cookies) {
          return resolve()
        }

        if (!Array.isArray(cookies)) {
          cookies = [cookies]
        }

        var setCookies = cookies.map(function (cookie) {
          return new Promise(function (resolve, reject) {
            var req = res.request

            req.jar.setCookie(cookie, req.url, function (err) {
              return err ? reject(err) : resolve()
            })
          })
        })

        return resolve(Promise.all(setCookies))
      })
    }

    /**
     * Turn raw headers into a header object.
     *
     * @param  {Object} response
     * @return {Object}
     */
    parseRawHeaders = function (response) {
      var headers = {}

      if (!response.rawHeaders) {
        Object.keys(response.headers).forEach(function (key) {
          var value = response.headers[key]

          // Need to normalize `Set-Cookie` header under node 0.10 which
          // always comes back as an array.
          if (Array.isArray(value) && value.length === 1) {
            value = value[0]
          }

          headers[key] = value
        })
      } else {
        for (var i = 0; i < response.rawHeaders.length; i = i + 2) {
          var name = response.rawHeaders[i]
          var value = response.rawHeaders[i + 1]

          append(headers, name, value)
        }
      }

      return headers
    }

    /**
     * Trigger the request in node.
     *
     * @param  {Request} req
     * @return {Promise}
     */
    createRequest = function (req) {
      return new Promise(function (resolve, reject) {
        var redirectCount = 0

        /**
         * Track upload progress through a stream.
         */
        var requestProxy = through2(function (chunk, enc, callback) {
          setUploadSize(req, req.uploadSize + chunk.length)
          callback(null, chunk)
        }, function (callback) {
          setUploadFinished(req)
          callback(req.aborted ? abortError(req) : null)
        })

        /**
         * Track download progress through a stream.
         */
        var responseProxy = through2(function (chunk, enc, callback) {
          setDownloadSize(req, req.downloadSize + chunk.length)
          callback(null, chunk)
        }, function (callback) {
          setDownloadFinished(req)
          callback(req.aborted ? abortError(req) : null)
        })

        /**
         * Create the HTTP request.
         *
         * @param {String} url
         */
        function get (url, opts, body) {
          var arg = assign(urlLib.parse(url), opts)
          var fn = arg.protocol === 'https:' ? https : http

          arg.agent = req.agent || agent(arg)
          arg.rejectUnauthorized = req.rejectUnauthorized

          var request = fn.request(arg)

          request.once('response', function (response) {
            var statusCode = response.statusCode

            // Handle HTTP redirections.
            if (req.followRedirects && statuses.redirect[statusCode] && response.headers.location) {
              // Discard response.
              response.resume()

              if (++redirectCount > req.maxRedirects) {
                reject(redirectError(req))
                return
              }

              get(urlLib.resolve(url, response.headers.location))
              return
            }

            req.downloadTotal = num(response.headers['content-length'])

            // Track download progress.
            response.pipe(responseProxy)

            var res = new Response(req)

            res.body = responseProxy
            res.status = response.statusCode
            res.set(parseRawHeaders(response))

            return resolve(res)
          })

          request.once('error', function (err) {
            return reject(req.aborted ? abortError(req) : unavailableError(req, err))
          })

          // Node 0.10 needs to catch errors on the request proxy.
          requestProxy.once('error', reject)

          req._raw = request
          req.uploadTotal = num(request.getHeader('Content-Length'))
          requestProxy.pipe(request)

          // Pipe the body to the stream.
          if (body) {
            if (isStream(body)) {
              body.pipe(requestProxy)
            } else {
              requestProxy.end(body)
            }
          } else {
            requestProxy.end()
          }
        }

        get(req.fullUrl(), {
          headers: req.get(),
          method: req.method
        }, req.body)
      })
    }

    /**
     * Check for host objects in node.
     *
     * @param  {*}       obj
     * @return {Boolean}
     */
    isHostObject = function (obj) {
      return obj instanceof Buffer || typeof obj.pipe === 'function'
    }

    /**
     * Create a cookie jar in node.
     *
     * @return {Object}
     */
    jar = function () {
      return new tough.CookieJar()
    }
  } else {
    /**
     * Determine XHR method.
     *
     * @return {Function}
     */
    var getXHR = function () {
      if (root.XMLHttpRequest) {
        return new root.XMLHttpRequest()
      }

      try { return new root.ActiveXObject('Microsoft.XMLHTTP') } catch (e) {}
      try { return new root.ActiveXObject('Msxml2.XMLHTTP.6.0') } catch (e) {}
      try { return new root.ActiveXObject('Msxml2.XMLHTTP.3.0') } catch (e) {}
      try { return new root.ActiveXObject('Msxml2.XMLHTTP') } catch (e) {}

      throw new Error('XMLHttpRequest is not available')
    }

    /**
     * Parse headers from a string.
     *
     * @param  {XMLHttpRequest} xhr
     * @return {Object}
     */
    parseRawHeaders = function (xhr) {
      var headers = {}
      var lines = xhr.getAllResponseHeaders().split(/\r?\n/)

      lines.pop()

      lines.forEach(function (header) {
        var index = header.indexOf(':')

        var name = header.substr(0, index)
        var value = header.substr(index + 1).trim()

        append(headers, name, value)
      })

      return headers
    }

    /**
     * Trigger the request in a browser.
     *
     * @param  {Request} req
     * @return {Promise}
     */
    createRequest = function (req) {
      return new Promise(function (resolve, reject) {
        var url = req.fullUrl()
        var method = req.method
        var res = new Response(req)

        // Loading HTTP resources from HTTPS is restricted and uncatchable.
        if (window.location.protocol === 'https:' && /^http\:/.test(url)) {
          return reject(blockedError(req))
        }

        // Catch URLs that will cause the request to hang indefinitely in
        // CORS enabled environments like Atom Editor.
        if (/^https?\:\/*(?:[~#\\\?;\:]|$)/.test(url)) {
          return reject(unavailableError(req))
        }

        var xhr = req._raw = getXHR()

        xhr.onreadystatechange = function () {
          if (xhr.readyState === 2) {
            // Parse raw headers to avoid errors when reading values.
            res.set(parseRawHeaders(xhr))
            res.status = xhr.status === 1223 ? 204 : xhr.status

            // Try setting the total download size.
            req.downloadTotal = num(res.get('Content-Length'))

            // Trigger upload finished after we get the response length.
            // Otherwise, it's possible this method will error and make the
            // `xhr` object invalid.
            setUploadFinished(req)
          }

          if (xhr.readyState === 4) {
            setDownloadFinished(req)

            // Handle the aborted state internally, PhantomJS doesn't reset
            // `xhr.status` to zero on abort.
            if (req.aborted) {
              return reject(abortError(req))
            }

            if (xhr.status === 0) {
              return reject(unavailableError(req))
            }

            res.body = xhr.responseText

            return resolve(res)
          }
        }

        // Use `progress` events to avoid calculating byte length.
        xhr.onprogress = function (e) {
          if (e.lengthComputable) {
            req.downloadTotal = e.total
          }

          setDownloadSize(req, e.loaded)
        }

        // No upload will occur with these requests.
        if (method === 'GET' || method === 'HEAD' || !xhr.upload) {
          req.uploadTotal = 0
          setUploadSize(req, 0)
        } else {
          xhr.upload.onprogress = function (e) {
            if (e.lengthComputable) {
              req.uploadTotal = e.total
            }

            setUploadSize(req, e.loaded)
          }
        }

        // XHR can fail to open when site CSP is set.
        try {
          xhr.open(method, url)
        } catch (e) {
          return reject(cspError(req, e))
        }

        // Send cookies with CORS.
        if (req.withCredentials) {
          xhr.withCredentials = true
        }

        // Set all headers with original casing.
        Object.keys(req.headers).forEach(function (header) {
          xhr.setRequestHeader(req.name(header), req.get(header))
        })

        xhr.send(req.body)
      })
    }

    /**
     * Check for host objects in the browser.
     *
     * @param  {*}       object
     * @return {Boolean}
     */
    isHostObject = function (object) {
      var str = Object.prototype.toString.call(object)

      switch (str) {
        case '[object File]':
        case '[object Blob]':
        case '[object FormData]':
        case '[object ArrayBuffer]':
          return true
        default:
          return false
      }
    }

    /**
     * Throw an error in browsers where `jar` is not supported.
     *
     * @throws {Error}
     */
    jar = function () {
      throw new Error('Cookie jars are not supported on the browser')
    }
  }

  /**
   * Create a new request instance.
   *
   * @param  {Object}   options
   * @return {Request}
   */
  function popsicle (options) {
    if (typeof options === 'string') {
      return new Request({ url: options })
    }

    if (!options) {
      throw new TypeError('No options specified')
    }

    if (typeof options.url !== 'string') {
      throw new TypeError('No URL specified')
    }

    return new Request(options)
  }

  /**
   * Expose utilities.
   */
  popsicle.jar = jar
  popsicle.form = form

  /**
   * Expose the `Request` and `Response` constructors.
   */
  popsicle.Request = Request
  popsicle.Response = Response

  return popsicle
})
