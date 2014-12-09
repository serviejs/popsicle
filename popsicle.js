(function (root) {
  var isNode   = typeof require === 'function' && typeof exports === 'object';
  var FormData = isNode ? require('form-data') : root.FormData;

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
   * Determine XHR method.
   *
   * @return {Function}
   */
  function getXHR () {
    if (root.XMLHttpRequest) {
      return new root.XMLHttpRequest();
    }

    try { return new root.ActiveXObject('Microsoft.XMLHTTP'); } catch (e) {}
    try { return new root.ActiveXObject('Msxml2.XMLHTTP.6.0'); } catch (e) {}
    try { return new root.ActiveXObject('Msxml2.XMLHTTP.3.0'); } catch (e) {}
    try { return new root.ActiveXObject('Msxml2.XMLHTTP'); } catch (e) {}

    throw new Error('XMLHttpRequest is not available');
  }

  /**
   * Return the content type from a header string.
   *
   * @param  {String} str
   * @return {String}
   */
  function type (str) {
    return str.split(/ *; */)[0];
  }

  /**
   * Encode a URI component correctly according to the spec.
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
   * @param  {String} [sep]
   * @param  {String} [eq]
   * @return {String}
   */
  function stringifyQuery (obj, sep, eq) {
    eq  = eq || '=';
    sep = sep || '&';

    if (Object(obj) !== obj) {
      return String(obj == null ? '' : obj);
    }

    var params = [];

    Object.keys(obj).forEach(function (key) {
      var value  = obj[key];
      var keyStr = encode(key) + eq;

      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) {
          params.push(keyStr + encode(value[i]));
        }
      } else {
        params.push(keyStr + encode(value));
      }
    });

    return params.join(sep);
  }

  /**
   * Convert a query string into an object.
   *
   * @param  {String} qs
   * @param  {String} [sep]
   * @param  {String} [eq]
   * @return {Object}
   */
  function parseQuery (qs, sep, eq) {
    eq  = eq || '=';
    sep = sep || '&';
    qs  = qs.split(sep);

    var obj     = {};
    var maxKeys = 1000;
    var len     = qs.length > maxKeys ? maxKeys : qs.length;

    for (var i = 0; i < len; i++) {
      var key   = qs[i].replace(/\+/g, '%20');
      var value = '';
      var index = key.indexOf(eq);

      if (index !== -1) {
        value = key.substr(index + 1);
        key   = key.substr(0, index);
      }

      key   = decodeURIComponent(key);
      value = decodeURIComponent(value);

      if (!obj.hasOwnProperty(key)) {
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
    if (Object(body) !== body) {
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

    // Set the body to `null` for empty responses.
    if (body === '') {
      response.body = null;

      return response;
    }

    var type = response.type();

    try {
      if (JSON_MIME_REGEXP.test(type)) {
        response.body = JSON.parse(body);
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
   * Parse headers from a string.
   *
   * @param  {String} str
   * @return {Object}
   */
  function parseHeaders (str) {
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
  }

  /**
   * Get all XHR response headers as an object.
   *
   * @param  {XMLHttpRequest} xhr
   * @return {Object}
   */
  function getAllResponseHeaders (xhr) {
    var headers = parseHeaders(xhr.getAllResponseHeaders());

    return headers;
  }

  /**
   * Turn raw headers into a header object.
   *
   * @param  {Object} response
   * @return {Object}
   */
  function parseRawHeaders (response) {
    if (!response.rawHeaders) {
      return response.headers;
    }

    var headers    = {};
    var rawHeaders = response.rawHeaders;

    for (var i = 0; i < rawHeaders.length; i = i + 2) {
      headers[rawHeaders[i]] = rawHeaders[i + 1];
    }

    return headers;
  }

  /**
   * Return options sanitized for the request module.
   *
   * @param  {Request} self
   * @return {Object}
   */
  function requestOptions (self) {
    var request = {};

    request.url     = self.fullUrl();
    request.method  = self.method;
    request.headers = self.headers;

    // The `request` module supports form data under a private property.
    if (self.body instanceof FormData) {
      request._form = self.body;
    } else {
      request.body = self.body;
    }

    return request;
  }

  /**
   * Track the current download size.
   *
   * @param {Request} self
   */
  function trackResponseProgress (self) {
    self._request.on('response', function (res) {
      self._responseTotal = Number(res.headers['content-length']);
    });

    self._request.on('data', function (data) {
      self._responseLength += data.length;
    });

    self._request.on('end', function () {
      self._responseTotal = self._responseLength;
    });
  }

  /**
   * Set multiple headers on an instance.
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
    this._headerNames = {};
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
    this._headerNames[lower] = key;

    return this;
  };

  /**
   * Get the original case-sensitive header name.
   *
   * @param  {String} key
   * @return {String}
   */
  Headers.prototype.name = function (key) {
    return this._headerNames[lowerHeader(key)];
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
    delete this._headerNames[lower];

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

    var contentType = this.headers['content-type'];

    return contentType && type(contentType);
  };

  /**
   * Return or set the accept header.
   *
   * @param  {String} [value]
   * @return {String}
   */
  Headers.prototype.accept = function (value) {
    if (value) {
      return this.set('Accept', value);
    }

    return this.headers.accept;
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

    // Alias the response instance.
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

    this.body = options.body;
    this.url = options.url;
    this.query = options.query;
    this.timeout = options.timeout;
    this.withCredentials = !!options.withCredentials;

    // Default to GET and uppercase anything else.
    this.method = (options.method || 'GET').toUpperCase();

    // Initialize the response length.
    this._responseTotal  = null;
    this._responseLength = 0;

    // Set request headers.
    setHeaders(this, options.headers);
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
    var url = this.url;

    if (this.query) {
      var query = stringifyQuery(this.query);

      url += (url.indexOf('?') === -1 ? '?' : '&') + query;
    }

    return url;
  };

  /**
   * Check how far something has been downloaded.
   *
   * @return {Number}
   */
  Request.prototype.downloaded = function () {
    if (this._responseTotal == null) {
      return 0;
    }

    return this._responseLength / this._responseTotal;
  };

  /**
   * Allows request plugins.
   */
  Request.prototype.use = function (fn) {
    fn(this);

    return this;
  };

  /**
   * Setup and create the request instance.
   *
   * @return {Promise}
   */
  Request.prototype._setup = function () {
    var self    = this;
    var timeout = this.timeout;

    this.use(defaultAccept);
    this.use(stringifyRequest);
    this.use(correctType);

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
      // If already aborted, set the promise to be rejected.
      if (this.aborted) {
        this._promise = Promise.reject(abortError(this));
      } else {
        this._setup();

        // Promises buffer and parse the full response.
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
    this._abort();
    clearTimeout(this._timer);

    return this;
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

        self._request = request(opts, function (err, response) {
          if (err) {
            return reject(unavailableError(self));
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

        self._request.on('abort', function () {
          return reject(abortError(self));
        });

        trackResponseProgress(self);
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
        this._stream = this._request = request(requestOptions(this));

        trackResponseProgress(this);
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
     * Trigger the request in a browser.
     *
     * @return {Promise}
     */
    Request.prototype._create = function  ( ) {
      var self = this;
      var url  = this.fullUrl();

      return new Promise(function (resolve, reject) {
        // Loading HTTP resources from HTTPS is restricted and uncatchable.
        if (window.location.protocol === 'https:' && /^http\:/.test(url)) {
          return reject(blockedError(self));
        }

        var xhr = self._xhr = getXHR();

        xhr.onreadystatechange = function () {
          if (xhr.readyState === 2) {
            self._responseTotal = Number(
              xhr.getResponseHeader('Content-Length')
            );
          }

          if (xhr.readyState === 3) {
            self._responseLength = xhr.responseText.length;
          }

          if (xhr.readyState === 4) {
            // Set the total response size to match the response length,
            // in case the content length header was not available before.
            self._responseTotal = self._responseLength;

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

        // XHR can fail to open when site CSP is set.
        try {
          xhr.open(self.method, url);
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
})(this);
