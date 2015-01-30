(function () {
  var isNode   = typeof window === 'undefined';
  var root     = isNode ? global : window;
  var Buffer   = isNode ? require('buffer').Buffer : null;
  var FormData = isNode ? require('form-data') : window.FormData;

  var _hasOwnProperty = Object.prototype.hasOwnProperty;

  var FORM_EQ  = '=';
  var FORM_SEP = '&';

  var JSON_MIME_REGEXP  = /^application\/(?:[\w!#\$%&\*`\-\.\^~]*\+)?json$/i;
  var QUERY_MIME_REGEXP = /^application\/x-www-form-urlencoded$/i;
  var FORM_MIME_REGEXP  = /^multipart\/form-data$/i;

  if (typeof Promise === 'undefined') {
    var PROMISE_ERROR_MESSAGE = (isNode ? 'global' : 'window') + '.Promise ' +
      'is undefined and should be polyfilled. Check out ' +
      'https://github.com/jakearchibald/es6-promise for more information.';

    throw new TypeError(PROMISE_ERROR_MESSAGE);
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
          dest[key] = arguments[i][key];
        }
      }
    }

    return dest;
  }

  /**
   * Create a function to set progress properties on a request instance.
   *
   * @param  {Object}   obj
   * @param  {String}   property
   * @param  {String}   callback
   * @return {Function}
   */
  function setProgress (obj, property, callback) {
    var method = '_set' + property.charAt(0).toUpperCase() + property.slice(1);

    /**
     * Create the progress update method.
     *
     * @param {Number} num
     */
    obj[method] = function (num) {
      if (this[property] === num) {
        return;
      }

      this[property] = num;

      this[callback]();
      this._completed();
      this._emitProgress();
    };
  }

  /**
   * Generate a random number between two digits.
   *
   * @param  {Number} low
   * @param  {Number} high
   * @return {Number}
   */
  function between (low, high) {
    var diff = high - low;

    return Math.random() * diff + low;
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
      return n + ((1 - n) * between(0.1, 0.45));
    }

    return Math.min(1, size / total);
  }

  /**
   * Turn a value into a number (avoid `null` becoming `0`).
   *
   * @param  {String} str
   * @return {Number}
   */
  function num (str) {
    return str == null ? NaN : Number(str);
  }

  /**
   * Check if an object is actually an object (not a primitive type).
   *
   * @param  {Object}  obj
   * @return {Boolean}
   */
  function isObject (obj) {
    return Object(obj) === obj;
  }

  /**
   * Create a stream error instance.
   *
   * @param  {Popsicle} self
   * @return {Error}
   */
  function streamError (self) {
    var err = self.error('Request is streaming');
    err.stream = true;
    return err;
  }

  /**
   * Create a timeout error instance.
   *
   * @param  {Popsicle} self
   * @return {Error}
   */
  function abortError (self) {
    var timeout = self.timeout;
    var err;

    if (self.timedout) {
      err = self.error('Timeout of ' + timeout + 'ms exceeded');
      err.timeout = timeout;
    } else {
      err = self.error('Request aborted');
      err.abort = true;
    }

    return err;
  }

  /**
   * Create a parse error instance.
   *
   * @param  {Popsicle} self
   * @param  {Error}    e
   * @return {Error}
   */
  function parseError (self, e) {
    var err = self.error('Unable to parse the response body');
    err.parse = true;
    err.original = e;
    return err;
  }

  /**
   * Create a CSP error instance (Cross-.
   *
   * @param  {Popsicle} self
   * @param  {Error}    e
   * @return {Error}
   */
  function cspError (self, e) {
    var err = self.error('Refused to connect to "' + self.fullUrl() + '"');
    err.csp = true;
    err.original = e;
    return err;
  }

  /**
   * Create an unavailable request error (offline, not resolvable, CORS).
   *
   * @param  {Popsicle} self
   * @return {Error}
   */
  function unavailableError (self) {
    var err = self.error('Unable to connect to "' + self.fullUrl() + '"');
    err.unavailable = true;
    return err;
  }

  /**
   * Create a blocked error (HTTPS -> HTTP).
   *
   * @param  {Popsicle} self
   * @return {Error}
   */
  function blockedError (self) {
    var err = self.error('The request to "' + self.fullUrl() + '" was blocked');
    err.blocked = true;
    return err;
  }

  /**
   * Return the content type from a header string.
   *
   * @param  {String} str
   * @return {String}
   */
  function type (str) {
    return str == null ? '' : str.split(/ *; */)[0];
  }

  /**
   * Encode a URI component according to the spec.
   *
   * @param  {String} str
   * @return {String}
   */
  function encode (str) {
    if (str == null) {
      return '';
    }

    try {
      return encodeURIComponent(str)
        .replace(/[!'()]/g, root.escape)
        .replace(/\*/g, '%2A');
    } catch (e) {
      return '';
    }
  }

  /**
   * Turn an object into a query string.
   *
   * @param  {Object} obj
   * @return {String}
   */
  function stringifyQuery (obj) {
    var params = [];

    Object.keys(obj).forEach(function (key) {
      var value  = obj[key];
      var keyStr = encode(key) + FORM_EQ;

      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) {
          params.push(keyStr + encode(value[i]));
        }
      } else {
        params.push(keyStr + encode(value));
      }
    });

    return params.join(FORM_SEP);
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
      return null;
    }

    qs = String(qs).split(FORM_SEP);

    var obj     = {};
    var maxKeys = 1000;
    var len     = qs.length > maxKeys ? maxKeys : qs.length;

    for (var i = 0; i < len; i++) {
      var key   = qs[i].replace(/\+/g, '%20');
      var value = '';
      var index = key.indexOf(FORM_EQ);

      if (index !== -1) {
        value = key.substr(index + 1);
        key   = key.substr(0, index);
      }

      key   = decodeURIComponent(key);
      value = decodeURIComponent(value);

      if (!_hasOwnProperty.call(obj, key)) {
        obj[key] = value;
      } else if (Array.isArray(obj[key])) {
        obj[key].push(value);
      } else {
        obj[key] = [obj[key], value];
      }
    }

    return obj;
  }

  /**
   * Check whether the object is already natively supported.
   *
   * @param  {*}       object
   * @return {Boolean}
   */
  var isHostObject;

  if (isNode) {
    isHostObject = function (object) {
      return object instanceof Buffer || object instanceof FormData;
    };
  } else {
    isHostObject = function (object) {
      var str = Object.prototype.toString.call(object);

      switch (str) {
        case '[object File]':
        case '[object Blob]':
        case '[object FormData]':
        case '[object ArrayBuffer]':
          return true;
        default:
          return false;
      }
    };
  }

  /**
   * Convert an object into a form data instance.
   *
   * @param  {Object}   parameters
   * @return {FormData}
   */
  function toFormData (obj) {
    var form = new FormData();

    if (Object(obj) === obj) {
      Object.keys(obj).forEach(function (name) {
        form.append(name, obj[name]);
      });
    }

    return form;
  }

  /**
   * Convert the request body into a valid string.
   *
   * @param {Request} request
   */
  function stringifyRequest (request) {
    var body = request.body;

    // Convert primitives types into strings.
    if (!isObject(body)) {
      request.body = body == null ? null : String(body);

      return;
    }

    // Return supported objects.
    if (isHostObject(body)) {
      return;
    }

    var type = request.type();

    // Set the default mime type to be JSON if none exists.
    if (!type) {
      type = 'application/json';

      request.type(type);
    }

    if (JSON_MIME_REGEXP.test(type)) {
      request.body = JSON.stringify(body);
    } else if (FORM_MIME_REGEXP.test(type)) {
      request.body = toFormData(body);
    } else if (QUERY_MIME_REGEXP.test(type)) {
      request.body = stringifyQuery(body);
    }
  }

  /**
   * Automatically parse the response body.
   *
   * @param  {Response} response
   * @return {Response}
   */
  function parseResponse (response) {
    var body = response.body;
    var type = response.type();

    if (body === '') {
      response.body = null;

      return response;
    }

    try {
      if (JSON_MIME_REGEXP.test(type)) {
        response.body = body === '' ? null : JSON.parse(body);
      } else if (QUERY_MIME_REGEXP.test(type)) {
        response.body = parseQuery(body);
      }
    } catch (e) {
      throw parseError(response, e);
    }

    return response;
  }

  /**
   * Set the default request accept header.
   *
   * @param {Request} request
   */
  function defaultAccept (request) {
    // If we have no accept header set already, default to accepting
    // everything. This is needed because otherwise Firefox defaults to
    // an accept header of `html/xml`.
    if (!request.get('Accept')) {
      request.set('Accept', '*/*');
    }
  }

  /**
   * Correct the content type request header.
   *
   * @param {Request} request
   */
  function correctType (request) {
    // Remove the `Content-Type` header from form data requests. The node
    // `request` module supports `form-data` to automatically add headers,
    // and the browser will ses it on `xhr.send` (when it's not already set).
    if (request.body instanceof FormData) {
      request.remove('Content-Type');
    }
  }

  /**
   * Set headers on an instance.
   *
   * @param {Request} self
   * @param {Object}  headers
   */
  function setHeaders (self, headers) {
    if (headers) {
      Object.keys(headers).forEach(function (key) {
        self.set(key, headers[key]);
      });
    }
  }

  /**
   * Lower-case the header name. Allow usage of `Referrer` and `Referer`.
   *
   * @param  {String} key
   * @return {String}
   */
  function lowerHeader (key) {
    var lower = key.toLowerCase();

    if (lower === 'referer') {
      return 'referrer';
    }

    return lower;
  }

  /**
   * Keep track of headers in a single instance.
   */
  function Headers () {
    this.headers = {};
    this.headerNames = {};
  }

  /**
   * Set a header value.
   *
   * @param  {String} key
   * @param  {String} value
   * @return {Header}
   */
  Headers.prototype.set = function (key, value) {
    if (typeof key !== 'string') {
      setHeaders(this, key);

      return this;
    }

    var lower = lowerHeader(key);

    this.headers[lower] = value;
    this.headerNames[lower] = key;

    return this;
  };

  /**
   * Get the original case-sensitive header name.
   *
   * @param  {String} key
   * @return {String}
   */
  Headers.prototype.name = function (key) {
    return this.headerNames[lowerHeader(key)];
  };

  /**
   * Return case-insensitive header.
   *
   * @param  {String} header
   * @return {String}
   */
  Headers.prototype.get = function (header) {
    return this.headers[lowerHeader(header)];
  };

  /**
   * Remove a header.
   *
   * @param  {String} header
   * @return {Header}
   */
  Headers.prototype.remove = function (header) {
    var lower = lowerHeader(header);

    delete this.headers[lower];
    delete this.headerNames[lower];

    return this;
  };

  /**
   * Return or set the content type.
   *
   * @param  {String} [value]
   * @return {String}
   */
  Headers.prototype.type = function (value) {
    if (value) {
      return this.set('Content-Type', value);
    }

    return type(this.headers['content-type']);
  };

  /**
   * Create a response instance.
   *
   * @param {Object} options
   */
  function Response (options) {
    Headers.call(this);

    this.raw     = options.raw;
    this.body    = options.body;
    this.status  = options.status === 1223 ? 204 : options.status;
    this.request = options.request;

    // Alias to the request instance.
    this.request.response = this;

    setHeaders(this, options.headers);
  }

  /**
   * Inherits from `Headers`.
   */
  Response.prototype = Object.create(Headers.prototype);
  Response.prototype.constructor = Response;

  /**
   * Return the status type number. E.g. 2 === 201.
   *
   * @return {Number}
   */
  Response.prototype.statusType = function () {
    return ~~(this.status / 100);
  };

  /**
   * Check whether the response was an info response. Status >= 100 < 200.
   *
   * @return {Boolean}
   */
  Response.prototype.info = function () {
    return this.statusType() === 1;
  };

  /**
   * Check whether the response was ok. Status >= 200 < 300.
   *
   * @return {Boolean}
   */
  Response.prototype.ok = function () {
    return this.statusType() === 2;
  };

  /**
   * Check whether the response was a client error. Status >= 400 < 500.
   *
   * @return {Boolean}
   */
  Response.prototype.clientError = function () {
    return this.statusType() === 4;
  };

  /**
   * Check whether the response was a server error. Status >= 500 < 600.
   *
   * @return {Boolean}
   */
  Response.prototype.serverError = function () {
    return this.statusType() === 5;
  };

  /**
   * Create a popsicle error instance.
   *
   * @param  {String} str
   * @return {Error}
   */
  Response.prototype.error = function (str) {
    return this.request.error(str);
  };

  /**
   * Initialise a request instance.
   *
   * @param {(Object|String)} options
   */
  function Request (options) {
    Headers.call(this);

    var query = options.query;

    // Request options.
    this.body = options.body;
    this.url = options.url;
    this.method = (options.method || 'GET').toUpperCase();
    this.query = assign({}, isObject(query) ? query : parseQuery(query));
    this.timeout = options.timeout;

    // Node specific options.
    this.jar = options.jar;
    this.withCredentials = options.withCredentials === true;
    this.rejectUnauthorized = options.rejectUnauthorized !== false;

    // Progress state.
    this.uploaded    = this.downloaded    = this.completed = 0;
    this.uploadSize  = this.downloadSize  = 0;
    this.uploadTotal = this.downloadTotal = NaN;

    // Set request headers.
    setHeaders(this, options.headers);

    // Request state.
    this.aborted = false;

    // Parse query strings already set.
    var queryIndex = options.url.indexOf('?');

    if (queryIndex > -1) {
      this.url = options.url.substr(0, queryIndex);

      // Copy url query parameters onto query object.
      assign(this.query, parseQuery(options.url.substr(queryIndex + 1)));
    }
  }

  /**
   * Inherits from `Headers`.
   */
  Request.prototype = Object.create(Headers.prototype);
  Request.prototype.constructor = Request;

  /**
   * Retrieve the current request URL.
   *
   * @return {String}
   */
  Request.prototype.fullUrl = function () {
    var url   = this.url;
    var query = stringifyQuery(this.query);

    if (query) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + query;
    }

    return url;
  };

  /**
   * Track request completion progress.
   *
   * @param  {Function} fn
   * @return {Request}
   */
  Request.prototype.progress = function (fn) {
    if (this.completed) {
      return this;
    }

    this._progressFns = this._progressFns || [];

    this._progressFns.push(fn);

    return this;
  };

  /**
   * Set upload progress properties.
   *
   * @private
   * @type  {Function}
   * @param {Number}   num
   */
  setProgress(Request.prototype, 'uploadSize',   '_uploaded');
  setProgress(Request.prototype, 'downloadSize', '_downloaded');

  /**
   * Calculate the uploaded percentage.
   */
  Request.prototype._uploaded = function () {
    var n     = this.uploaded;
    var size  = this.uploadSize;
    var total = this.uploadTotal;

    this.uploaded = calc(n, size, total);
  };

  /**
   * Calculate the downloaded percentage.
   */
  Request.prototype._downloaded = function () {
    var n     = this.downloaded;
    var size  = this.downloadSize;
    var total = this.downloadTotal;

    this.downloaded = calc(n, size, total);
  };

  /**
   * Update the completed percentage.
   */
  Request.prototype._completed = function () {
    this.completed = (this.uploaded + this.downloaded) / 2;
  };

  /**
   * Emit a request progress event (upload or download).
   */
  Request.prototype._emitProgress = function () {
    var fns = this._progressFns;

    if (!fns || this._error) {
      return;
    }

    try {
      for (var i = 0; i < fns.length; i++) {
        fns[i](this);
      }
    } catch (e) {
      this._errored(e);
    }
  };

  /**
   * Finished uploading.
   */
  Request.prototype._uploadFinished = function () {
    if (this.uploaded === 1) {
      return;
    }

    this.uploaded = 1;
    this.completed = 0.5;

    this._emitProgress();
  };

  /**
   * Finished downloading.
   */
  Request.prototype._downloadFinished = function () {
    if (this.downloaded === 1) {
      return;
    }

    this.downloaded = 1;
    this.completed = 1;

    this._emitProgress();
  };

  /**
   * Allows request plugins.
   *
   * @return {Request}
   */
  Request.prototype.use = function (fn) {
    fn(this);

    return this;
  };

  /**
   * Setup the request instance (promises and streams).
   */
  Request.prototype._setup = function () {
    var self    = this;
    var timeout = this.timeout;

    // Automatic request handlers.
    this.use(defaultAccept);
    this.use(stringifyRequest);
    this.use(correctType);

    // Remove progress functions on complete.
    this.progress(function (e) {
      if (e.completed === 1) {
        delete self._progressFns;
      }
    });

    // Catch request timeouts.
    if (timeout) {
      this._timer = setTimeout(function () {
        self.timedout = true;
        self.abort();
      }, timeout);
    }
  };

  /**
   * Trigger the HTTP request.
   *
   * @return {Promise}
   */
  Request.prototype.create = function () {
    // Setup a new promise request if none exists.
    if (!this._promise) {
      // If already aborted, create a rejected promise.
      if (this.aborted) {
        this._promise = Promise.reject(abortError(this));
      } else {
        this._setup();

        this._promise = this._create().then(parseResponse);
      }
    }

    return this._promise;
  };

  /**
   * Abort request.
   *
   * @return {Request}
   */
  Request.prototype.abort = function () {
    if (this.aborted) {
      return this;
    }

    this.aborted = true;

    // Set everything to completed.
    this.downloaded = this.uploaded = this.completed = 1;

    // Abort and emit the final progress event.
    this._abort();
    this._emitProgress();
    clearTimeout(this._timer);

    return this;
  };

  /**
   * Trigger a request-related error that should break requests.
   *
   * @param {Error} err
   */
  Request.prototype._errored = function (err) {
    this._error = err;
    this.abort();
  };

  /**
   * Create a popsicle error instance.
   *
   * @param  {String} str
   * @return {Error}
   */
  Request.prototype.error = function (str) {
    var err = new Error(str);
    err.popsicle = this;
    return err;
  };

  /**
   * Support node-style callbacks.
   *
   * @param {Function} cb
   */
  Request.prototype.exec = function exec (cb) {
    this.then(function (value) {
      cb(null, value);
    }, cb);
  };

  /**
   * Standard promise chain method.
   *
   * @param  {Function} onFulfilled
   * @param  {Function} onRejected
   * @return {Promise}
   */
  Request.prototype.then = function (onFulfilled, onRejected) {
    return this.create().then(onFulfilled, onRejected);
  };

  /**
   * Standard promise error handling.
   *
   * @param  {Function} cb
   * @return {Promise}
   */
  Request.prototype['catch'] = function (onRejected) {
    return this.create()['catch'](onRejected);
  };

  /**
   * Handle requests differently on node and browsers.
   */
  if (isNode) {
    var request = require('request');
    var version = require('./package.json').version;

    /**
     * Return options sanitized for the request module.
     *
     * @param  {Request} self
     * @return {Object}
     */
    var requestOptions = function (self) {
      var request = {};

      request.url = self.fullUrl();
      request.method = self.method;
      request.jar = self.jar;

      // Set a default user-agent.
      request.headers = assign(self.headers, {
        'User-Agent': 'node-popsicle/' + version
      });

      // The `request` module supports form data under a private property.
      if (self.body instanceof FormData) {
        request._form = self.body;
      } else {
        request.body = self.body;
      }

      if (self.rejectUnauthorized) {
        request.rejectUnauthorized = true;
      }

      return request;
    };

    /**
     * Return the byte length of an input.
     *
     * @param  {(String|Buffer)} data
     * @return {Number}
     */
    var byteLength = function (data) {
      if (Buffer.isBuffer(data)) {
        return data.length;
      }

      if (typeof data === 'string') {
        return Buffer.byteLength(data);
      }

      return 0;
    };

    /**
     * Track the current download size.
     *
     * @param {Request} self
     * @param {request} request
     */
    var trackRequestProgress = function (self, request) {
      self._request = request;

      function onRequest (request) {
        var write = request.write;

        self.uploadTotal = num(request.getHeader('Content-Length'));

        // Override `Request.prototype.write` to track amount of sent data.
        request.write = function (data) {
          self._setUploadSize(self.uploadSize + byteLength(data));

          return write.apply(this, arguments);
        };
      }

      function onResponse (response) {
        response.on('data', onResponseData);
        self.downloadTotal = num(response.headers['content-length']);
        self._uploadFinished();
      }

      function onResponseData (data) {
        // Data should always be a `Buffer` instance.
        self._setDownloadSize(self.downloadSize + data.length);
      }

      request.on('redirect', function () {
        console.log(request.redirects);
      });

      request.on('request', onRequest);
      request.on('response', onResponse);
    };

    /**
     * Turn raw headers into a header object.
     *
     * @param  {Object} response
     * @return {Object}
     */
    var parseRawHeaders = function (response) {
      if (!response.rawHeaders) {
        return response.headers;
      }

      var headers    = {};
      var rawHeaders = response.rawHeaders;

      for (var i = 0; i < rawHeaders.length; i = i + 2) {
        headers[rawHeaders[i]] = rawHeaders[i + 1];
      }

      return headers;
    };

    /**
     * Trigger the request in node.
     *
     * @return {Promise}
     */
    Request.prototype._create = function () {
      var self = this;

      // Throw on promise creation if streaming.
      if (this._stream) {
        throw streamError(this);
      }

      return new Promise(function (resolve, reject) {
        var opts = requestOptions(self);

        var req = request(opts, function (err, response) {
          // Clean up listeners.
          delete self._request;
          self._downloadFinished();

          if (err) {
            // Node.js core error (ECONNRESET, EPIPE).
            if (typeof err.code === 'string') {
              return reject(unavailableError(self));
            }

            return reject(err);
          }

          var res = new Response({
            raw:     response,
            request: self,
            body:    response.body,
            status:  response.statusCode,
            headers: parseRawHeaders(response)
          });

          return resolve(res);
        });

        req.on('abort', function () {
          if (self._error) {
            return reject(self._error);
          }

          return reject(abortError(self));
        });

        trackRequestProgress(self, req);
      });
    };

    /**
     * Abort a running node request.
     *
     * @return {Request}
     */
    Request.prototype._abort = function () {
      if (this._request) {
        this._request.abort();
      }
    };

    /**
     * Expose the current request stream.
     *
     * @return {Object}
     */
    Request.prototype.stream = function () {
      if (!this._stream) {
        this._setup();

        // Initialize a streaming request instance.
        // TODO: Emit a stream error if already aborted.
        // TODO: Catch stream errors and coerce to popsicle errors.
        var req = this._stream = request(requestOptions(this));

        trackRequestProgress(this, req);
      }

      return this._stream;
    };

    /**
     * Pipe the current response into another stream.
     *
     * @param  {Object} stream
     * @return {Object}
     */
    Request.prototype.pipe = function (stream) {
      return this.stream().pipe(stream);
    };
  } else {
    /**
     * Determine XHR method.
     *
     * @return {Function}
     */
    var getXHR = function () {
      if (root.XMLHttpRequest) {
        return new root.XMLHttpRequest();
      }

      try { return new root.ActiveXObject('Microsoft.XMLHTTP'); } catch (e) {}
      try { return new root.ActiveXObject('Msxml2.XMLHTTP.6.0'); } catch (e) {}
      try { return new root.ActiveXObject('Msxml2.XMLHTTP.3.0'); } catch (e) {}
      try { return new root.ActiveXObject('Msxml2.XMLHTTP'); } catch (e) {}

      throw new Error('XMLHttpRequest is not available');
    };

    /**
     * Parse headers from a string.
     *
     * @param  {String} str
     * @return {Object}
     */
    var parseHeaders = function (str) {
      var headers = {};
      var lines   = str.split(/\r?\n/);

      lines.pop();

      lines.forEach(function (header) {
        var index = header.indexOf(':');

        var name  = header.substr(0, index);
        var value = header.substr(index + 1).trim();

        headers[name] = value;
      });

      return headers;
    };

    /**
     * Get all XHR response headers as an object.
     *
     * @param  {XMLHttpRequest} xhr
     * @return {Object}
     */
    var getAllResponseHeaders = function (xhr) {
      var headers = parseHeaders(xhr.getAllResponseHeaders());

      return headers;
    };

    /**
     * Trigger the request in a browser.
     *
     * @return {Promise}
     */
    Request.prototype._create = function  ( ) {
      var self   = this;
      var url    = self.fullUrl();
      var method = self.method;

      return new Promise(function (resolve, reject) {
        // Loading HTTP resources from HTTPS is restricted and uncatchable.
        if (window.location.protocol === 'https:' && /^http\:/.test(url)) {
          return reject(blockedError(self));
        }

        var xhr = self._xhr = getXHR();

        xhr.onreadystatechange = function () {
          if (xhr.readyState === 2) {
            self.downloadTotal = num(xhr.getResponseHeader('Content-Length'));

            // Trigger upload finished after we get the response length.
            // Otherwise, it's possible this method will error and make the
            // `xhr` object invalid.
            self._uploadFinished();
          }

          if (xhr.readyState === 4) {
            // Clean up listeners.
            delete self._xhr;
            self._downloadFinished();

            if (self._error) {
              return reject(self._error);
            }

            // Handle the aborted state internally, PhantomJS doesn't reset
            // `xhr.status` to zero on abort.
            if (self.aborted) {
              return reject(abortError(self));
            }

            if (xhr.status === 0) {
              return reject(unavailableError(self));
            }

            var res = new Response({
              raw:     xhr,
              request: self,
              body:    xhr.responseText,
              headers: getAllResponseHeaders(xhr),
              status:  xhr.status
            });

            return resolve(res);
          }
        };

        // Use `progress` events to avoid calculating byte length.
        xhr.onprogress = function (e) {
          if (e.lengthComputable) {
            self.downloadTotal = e.total;
          }

          self._setDownloadSize(e.loaded);
        };

        // No upload will occur with these requests.
        if (method === 'GET' || method === 'HEAD' || !xhr.upload) {
          xhr.upload = {};

          self.uploadTotal = 0;
          self._setUploadSize(0);
        } else {
          xhr.upload.onprogress = function (e) {
            if (e.lengthComputable) {
              self.uploadTotal = e.total;
            }

            self._setUploadSize(e.loaded);
          };
        }

        // XHR can fail to open when site CSP is set.
        try {
          xhr.open(method, url);
        } catch (e) {
          return reject(cspError(self, e));
        }

        // Send cookies with CORS.
        if (self.withCredentials) {
          xhr.withCredentials = true;
        }

        // Set all headers with original casing.
        Object.keys(self.headers).forEach(function (header) {
          xhr.setRequestHeader(self.name(header), self.get(header));
        });

        xhr.send(self.body);
      });
    };

    /**
     * Abort a running XMLHttpRequest.
     */
    Request.prototype._abort = function () {
      if (this._xhr) {
        this._xhr.abort();
      }
    };
  }

  /**
   * Create a new request instance.
   *
   * @param  {Object}   options
   * @return {Request}
   */
  function popsicle (options) {
    if (typeof options === 'string') {
      return new Request({ url: options });
    }

    if (!options) {
      throw new TypeError('No options specified');
    }

    if (typeof options.url !== 'string') {
      throw new TypeError('No URL specified');
    }

    return new Request(options);
  }

  /**
   * Initialize a form data instance.
   */
  popsicle.form = function (params) {
    return toFormData(params);
  };

  /**
   * Support cookie jars (on Node).
   *
   * @return {Object}
   */
  if (isNode) {
    popsicle.jar = function () {
      return request.jar();
    };
  } else {
    popsicle.jar = function () {
      throw new Error('Cookie jars are not supported on browsers');
    };
  }

  /**
   * Alias `Request` and `Response` constructors.
   */
  popsicle.Request  = Request;
  popsicle.Response = Response;

  /**
   * Export the module for different environments.
   */
  if (typeof define === 'function' && define.amd) {
    define([], function () {
      return popsicle;
    });
  } else if (typeof exports === 'object') {
    module.exports = popsicle;
  } else {
    root.popsicle = popsicle;
  }
})();
