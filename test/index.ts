import test = require('blue-tape')
import methods = require('methods')
import FormData = require('form-data')
import Promise = require('native-or-bluebird')
import popsicle = require('../lib/index')

const SUPPORTED_METHODS = typeof window === 'object' ? [
  'get',
  'post',
  'put',
  'patch',
  'delete'
] : methods.filter((method) => method !== 'connect')

const METHODS_WITHOUT_BODY = ['connect', 'head', 'options']

const REMOTE_URL = 'http://localhost:' + process.env.PORT

const EXAMPLE_BODY: any = {
  username: 'blakeembrey',
  password: 'hunter2'
}

const BOUNDARY_REGEXP = /^multipart\/form-data; boundary=([^;]+)/

const supportsStatusText = parseFloat(process.version.replace(/^v/, '')) >= 0.12

test('should expose default functions', function (t) {
  t.equal(typeof popsicle, 'function')
  t.equal(typeof popsicle.Request, 'function')
  t.equal(typeof popsicle.Response, 'function')
  t.equal(typeof popsicle.form, 'function')
  t.equal(typeof popsicle.jar, 'function')

  methods.forEach(function (method) {
    t.equal(typeof (<any> popsicle)[method], 'function')
  })

  t.end()
})

test('throw an error when no options are provided', function (t) {
  t.throws(() => (<any> popsicle)(), /no url specified/i)
  t.end()
})

test('create a popsicle#Request instance', function (t) {
  const req = popsicle('/')

  t.ok(req instanceof popsicle.Request)

  // Ignore connection error.
  return req.then(null, function () {})
})

test('use the same response in promise chains', function (t) {
  const req = popsicle(REMOTE_URL + '/echo')

  t.plan(15)

  return req
    .then(function (res) {
      t.ok(res instanceof popsicle.Response)

      // Not all browsers support `responseURL`.
      t.ok(typeof res.url === 'string' || res.url == null)

      t.equal(typeof res.headers, 'object')
      t.equal(typeof res.headerNames, 'object')
      t.equal(typeof res.status, 'number')

      t.equal(typeof res.get, 'function')
      t.equal(typeof res.name, 'function')
      t.equal(typeof res.type, 'function')
      t.equal(typeof res.statusType, 'function')
      t.equal(typeof res.error, 'function')
      t.equal(typeof res.toJSON, 'function')

      t.equal(res.request, req)

      t.deepEqual(Object.keys(req.toJSON()), ['url', 'headers', 'body', 'options', 'timeout', 'method'])
      t.deepEqual(Object.keys(res.toJSON()), ['url', 'headers', 'body', 'status', 'statusText'])

      return req
        .then(function (res2) {
          t.equal(res, res2)
        })
    })
})

test('methods', function (t) {
  t.test('use node-style callbacks', function (t) {
    t.plan(1)

    return popsicle(REMOTE_URL + '/echo')
      .exec(function (err, res) {
        t.ok(res instanceof popsicle.Response)
        t.end()
      })
  })

  t.test('allow methods to be passed in', function (t) {
    return Promise.all(SUPPORTED_METHODS.map(function (method) {
      return popsicle({
        url: REMOTE_URL + '/echo/method',
        method: method
      })
        .then(function (res) {
          t.equal(res.status, 200)
          t.equal(res.body, METHODS_WITHOUT_BODY.indexOf(method) === -1 ? method.toUpperCase() : null)
        })
    }))
  })
})

test('allow usage of method shorthands', function (t) {
  return Promise.all(SUPPORTED_METHODS.map(function (method) {
      return (<any> popsicle)[method](REMOTE_URL + '/echo/method')
        .then(function (res: any) {
          t.equal(res.status, 200)
          t.equal(res.body, METHODS_WITHOUT_BODY.indexOf(method) === -1 ? method.toUpperCase() : null)
        })
  }))
})

test('response status', function (t) {
  t.test('5xx', function (t) {
    return popsicle(REMOTE_URL + '/error')
      .then(function (res) {
        t.equal(res.status, 500)
        t.equal(res.statusType(), 5)

        if (supportsStatusText) {
          t.equal(res.statusText, 'Internal Server Error')
        }
      })
  })

  t.test('4xx', function (t) {
    return popsicle(REMOTE_URL + '/not-found')
      .then(function (res) {
        t.equal(res.status, 404)
        t.equal(res.statusType(), 4)

        if (supportsStatusText) {
          t.equal(res.statusText, 'Not Found')
        }
      })
  })

  t.test('2xx', function (t) {
    return popsicle(REMOTE_URL + '/no-content')
      .then(function (res) {
        t.equal(res.status, 204)
        t.equal(res.statusType(), 2)

        if (supportsStatusText) {
          t.equal(res.statusText, 'No Content')
        }
      })
  })
})

test('request headers', function (t) {
  t.test('always send user agent', function (t) {
    return popsicle(REMOTE_URL + '/echo/header/user-agent')
      .then(function (res) {
        var regexp = process.browser ?
          /^Mozilla\/.+$/ :
          /^https:\/\/github\.com\/blakeembrey\/popsicle$/

        t.ok(regexp.test(res.body))
      })
  })

  if (!popsicle.browser) {
    t.test('send a custom user agent header', function (t) {
      return popsicle({
        url: REMOTE_URL + '/echo/header/user-agent',
        headers: {
          'User-Agent': 'foobar'
        }
      })
        .then(function (res) {
          t.equal(res.body, 'foobar')
        })
    })
  }
})

test('response headers', function (t) {
  t.test('parse', function (t) {
    return popsicle(REMOTE_URL + '/notfound')
      .then(function (res) {
        t.equal(res.type(), 'text/html')
        t.equal(res.get('Content-Type'), 'text/html; charset=utf-8')
      })
  })
})

test('request body', function (t) {
  t.test('send post data', function (t) {
    return popsicle({
      url: REMOTE_URL + '/echo',
      method: 'POST',
      body: 'example data',
      headers: {
        'content-type': 'application/octet-stream'
      }
    })
      .then(function (res) {
        t.equal(res.body, 'example data')
        t.equal(res.status, 200)
        t.equal(res.type(), 'application/octet-stream')

        if (supportsStatusText) {
          t.equal(res.statusText, 'OK')
        }
      })
  })

  t.test('should automatically send objects as json', function (t) {
    return popsicle({
      url: REMOTE_URL + '/echo',
      method: 'POST',
      body: EXAMPLE_BODY
    })
      .then(function (res) {
        t.deepEqual(res.body, EXAMPLE_BODY)
        t.equal(res.type(), 'application/json')
      })
  })

  t.test('should send as form encoded when header is set', function (t) {
    return popsicle({
      url: REMOTE_URL + '/echo',
      method: 'POST',
      body: EXAMPLE_BODY,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
      .then(function (res) {
        t.deepEqual(res.body, EXAMPLE_BODY)
        t.equal(res.type(), 'application/x-www-form-urlencoded')
      })
  })

  t.test('host objects', function (t) {
    t.test('form data', function (t) {
      function validateResponse (res: any) {
        var boundary = BOUNDARY_REGEXP.exec(res.headers['content-type'])[1]

        var body = [
          '--' + boundary,
          'Content-Disposition: form-data; name="username"',
          '',
          EXAMPLE_BODY.username,
          '--' + boundary,
          'Content-Disposition: form-data; name="password"',
          '',
          EXAMPLE_BODY.password,
          '--' + boundary + '--'
        ].join('\r\n')

        if (typeof window !== 'undefined') {
          body += '\r\n'
        }

        t.equal(res.body, body)
      }

      t.test('should create form data instance', function (t) {
        var form = popsicle.form(EXAMPLE_BODY)

        t.ok(form instanceof FormData)

        return popsicle({
          url: REMOTE_URL + '/echo',
          method: 'POST',
          body: form
        }).then(validateResponse)
      })

      t.test('should stringify to form data when set as multipart', function (t) {
        return popsicle({
          url: REMOTE_URL + '/echo',
          method: 'POST',
          body: EXAMPLE_BODY,
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }).then(validateResponse)
      })
    })
  })
})

test('query', function (t) {
  t.test('should stringify and send query parameters', function (t) {
    return popsicle({
      url: REMOTE_URL + '/echo/query',
      query: EXAMPLE_BODY
    })
      .then(function (res) {
        t.deepEqual(res.body, EXAMPLE_BODY)
      })
  })

  t.test('should stringify and append to query object', function (t) {
    var req = popsicle({
      url: REMOTE_URL + '/echo/query?query=true',
      query: EXAMPLE_BODY
    })

    var query = {
      username: 'blakeembrey',
      password: 'hunter2',
      query: 'true'
    }

    t.equal(req.url, REMOTE_URL + '/echo/query')
    t.deepEqual(req.query, query)

    return req
      .then(function (res) {
        t.deepEqual(res.body, query)
      })
  })

  t.test('should accept query as a string', function (t) {
    var req = popsicle({
      url: REMOTE_URL + '/echo/query',
      query: 'query=true'
    })

    t.equal(req.url, REMOTE_URL + '/echo/query')
    t.deepEqual(req.query, { query: 'true' })

    return req
      .then(function (res) {
        t.deepEqual(res.body, { query: 'true' })
      })
  })
})

test('timeout', function (t) {
  t.test('should timeout the request when set', function (t) {
    t.plan(3)

    return popsicle({
      url: REMOTE_URL + '/delay/1500',
      timeout: 500
    })
      .catch(function (err) {
        t.equal(err.message, 'Timeout of 500ms exceeded')
        t.equal(err.code, 'ETIMEOUT')
        t.ok(err.popsicle instanceof popsicle.Request)
      })
  })
})

test('abort', function (t) {
  t.test('abort before it starts', function (t) {
    const req = popsicle(REMOTE_URL + '/echo')

    req.abort()

    t.plan(3)

    return req
      .catch(function (err) {
        t.equal(err.message, 'Request aborted')
        t.equal(err.code, 'EABORT')
        t.ok(err.popsicle instanceof popsicle.Request)
      })
  })

  t.test('abort mid-request', function (t) {
    const req = popsicle(REMOTE_URL + '/download')

    t.plan(3)

    setTimeout(function () {
      req.abort()
    }, 100)

    return req
      .catch(function (err) {
        t.equal(err.message, 'Request aborted')
        t.equal(err.code, 'EABORT')
        t.ok(err.popsicle instanceof popsicle.Request)
      })
  })

  t.test('no side effects of aborting twice', function (t) {
    const req = popsicle(REMOTE_URL + '/download')

    t.plan(3)

    req.abort()
    req.abort()

    return req
      .catch(function (err) {
        t.equal(err.message, 'Request aborted')
        t.equal(err.code, 'EABORT')
        t.ok(err.popsicle instanceof popsicle.Request)
      })
  })
})

test('progress', function (t) {
  t.test('download', function (t) {
    t.test('download progress', function (t) {
      const req = popsicle(REMOTE_URL + '/download')

      t.plan(3)

      // Before the request has started.
      t.equal(req.downloaded, 0)

      // Check halfway into the response.
      setTimeout(function () {
        t.equal(req.downloaded, 0.5)
      }, 100)

      return req
        .then(function () {
          t.equal(req.downloaded, 1)
        })
    })
  })

  t.test('event', function (t) {
    t.test('emit progress events', function (t) {
      const req = popsicle({
        url: REMOTE_URL + '/echo',
        body: EXAMPLE_BODY,
        method: 'POST'
      })

      t.plan(3)

      let asserted = 0
      let expected = 0

      req.progress(function (e) {
        expected += 0.5

        t.equal(e.completed, expected)
      })

      return req
        .then(function (res) {
          t.deepEqual(res.body, EXAMPLE_BODY)
        })
    })

    t.test('error when the progress callback errors', function (t) {
      const req = popsicle(REMOTE_URL + '/echo')

      t.plan(2)

      req.progress(function () {
        throw new Error('Testing')
      })

      return req
        .catch(function (err) {
          t.equal(err.message, 'Testing')
          t.notOk(err.popsicle, 'popsicle should not be set')
        })
    })
  })
})

test('response body', function (t) {
  t.test('automatically parse json responses', function (t) {
    return popsicle(REMOTE_URL + '/json')
      .then(function (res) {
        t.equal(res.type(), 'application/json')
        t.deepEqual(res.body, { username: 'blakeembrey' })
      })
  })

  t.test('automatically parse form encoded responses', function (t) {
    return popsicle(REMOTE_URL + '/foo')
      .then(function (res) {
        t.equal(res.type(), 'application/x-www-form-urlencoded')
        t.deepEqual(res.body, { foo: 'bar' })
      })
  })

  t.test('disable automatic parsing', function (t) {
    return popsicle({
      url: REMOTE_URL + '/json',
      use: popsicle.browser ? [] : [popsicle.plugins.concatStream('string')]
    })
      .then(function (res) {
        t.equal(res.type(), 'application/json')
        t.equal(res.body, '{"username":"blakeembrey"}')
      })
  })

  t.test('set non-parsable responses as null', function (t) {
    return popsicle({
      url: REMOTE_URL + '/echo',
      method: 'post'
    })
      .then(function (res) {
        t.equal(res.body, null)
      })
  })

  t.test('set body to null when json is empty', function (t) {
    return popsicle({
      url: REMOTE_URL + '/echo',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    })
      .then(function (res) {
        t.equal(res.body, null)
        t.equal(res.type(), 'application/json')
      })
  })

  if (!process.browser) {
    const fs = require('fs')
    const concat = require('concat-stream')
    const filename = require('path').join(__dirname, '../../test/support/server.js')
    const filecontents = fs.readFileSync(filename, 'utf-8')

    t.test('stream the response body', function (t) {
      return popsicle({
        url: REMOTE_URL + '/json',
        use: []
      })
        .then(function (res) {
          t.equal(typeof res.body, 'object')

          return new Promise(function (resolve) {
            res.body.pipe(concat(function (data: Buffer) {
              t.equal(data.toString(), '{"username":"blakeembrey"}')

              return resolve()
            }))
          })
        })
    })

    t.test('pipe streams', function (t) {
      return popsicle({
        url: REMOTE_URL + '/echo',
        body: fs.createReadStream(filename)
      })
        .then(function (res) {
          t.equal(res.body, filecontents)
        })
    })

    t.test('pipe streams into forms', function (t) {
      return popsicle({
        url: REMOTE_URL + '/echo',
        body: popsicle.form({
          file: fs.createReadStream(filename)
        })
      })
        .then(function (res) {
          var boundary = BOUNDARY_REGEXP.exec(<string> res.headers['content-type'])[1]

          t.equal(res.body, [
            '--' + boundary,
            'Content-Disposition: form-data; name="file"; filename="server.js"',
            'Content-Type: application/javascript',
            '',
            filecontents,
            '--' + boundary + '--'
          ].join('\r\n'))
        })
    })

    t.test('unzip contents', function (t) {
      return popsicle({
        url: REMOTE_URL + '/echo/zip',
        body: fs.createReadStream(filename)
      })
        .then(function (res) {
          t.equal(res.get('Content-Encoding'), 'deflate')
          t.equal(res.body, filecontents)
        })
    })

    t.test('unzip with gzip encoding', function (t) {
      return popsicle({
        url: REMOTE_URL + '/echo/zip',
        body: fs.createReadStream(filename),
        headers: {
          'Accept-Encoding': 'gzip'
        }
      })
        .then(function (res) {
          t.equal(res.get('Content-Encoding'), 'gzip')
          t.equal(res.body, filecontents)
        })
    })
  } else {
    t.test('browser response type', function (t) {
      return popsicle({
        url: REMOTE_URL + '/text',
        options: {
          responseType: 'arraybuffer'
        }
      })
        .then(function (res) {
          t.ok(res.body instanceof ArrayBuffer)
        })
    })

    t.test('throw on unsupported response type', function (t) {
      t.plan(2)

      return popsicle({
        url: REMOTE_URL + '/text',
        options: {
          responseType: 'foobar'
        }
      })
        .catch(function (err) {
          t.equal(err.message, 'Unsupported response type: foobar')
          t.equal(err.code, 'ERESPONSETYPE')
        })
    })
  }
})

test('request errors', function (t) {
  t.test('error when requesting an unknown domain', function (t) {
    t.plan(3)

    return popsicle('http://fdahkfjhuehfakjbvdahjfds.fdsa')
      .catch(function (err) {
        t.ok(/Unable to connect/i.exec(err.message))
        t.equal(err.code, 'EUNAVAILABLE')
        t.ok(err.popsicle instanceof popsicle.Request)
      })
  })

  t.test('give a parse error on invalid response body', function (t) {
    t.plan(3)

    return popsicle({
      url: REMOTE_URL + '/echo',
      method: 'POST',
      body: 'username=blakeembrey&password=hunter2',
      headers: {
        'Content-Type': 'application/json'
      }
    })
      .catch(function (err) {
        t.ok(/Unable to parse response body/i.test(err.message))
        t.equal(err.code, 'EPARSE')
        t.ok(err.popsicle instanceof popsicle.Request)
      })
  })

  t.test('give a stringify error on invalid request body', function (t) {
    const obj: any = {}

    t.plan(3)

    // Recursive link will fail to stringify.
    obj.obj = obj

    return popsicle({
      url: REMOTE_URL + '/echo',
      method: 'POST',
      body: obj
    })
      .catch(function (err) {
        t.ok(/Unable to stringify request body/i.test(err.message))
        t.equal(err.code, 'ESTRINGIFY')
        t.ok(err.popsicle instanceof popsicle.Request)
      })
  })
})

test('plugins', function (t) {
  t.test('modify the request', function (t) {
    const req = popsicle(REMOTE_URL + '/echo')

    t.plan(1)

    req.use(function (self) {
      t.equal(self, req)
    })

    return req
  })
})

test('request flow', function (t) {
  t.test('before', function (t) {
    t.test('run a function before opening the request', function (t) {
      const req = popsicle(REMOTE_URL + '/echo')

      t.plan(2)

      req.before(function (self) {
        t.equal(self, req)
        t.notOk(req.response)
      })

      return req
    })

    t.test('fail the request before starting', function (t) {
      const req = popsicle(REMOTE_URL + '/echo')

      t.plan(1)

      req.before(function () {
        throw new Error('Hello world!')
      })

      return req
        .catch(function (err) {
          t.equal(err.message, 'Hello world!')
        })
    })

    t.test('accept a promise to delay the request', function (t) {
      const req = popsicle(REMOTE_URL + '/echo')

      t.plan(1)

      req.before(function (self) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            t.equal(self, req)
            resolve()
          }, 10)
        })
      })

      return req
    })
  })

  test('after', function (t) {
    t.test('run after the response', function (t) {
      const req = popsicle(REMOTE_URL + '/echo')

      t.plan(4)

      req.before(function () {
        t.notOk(req.response)
      })

      req.after(function (response) {
        t.ok(response instanceof popsicle.Response)
        t.equal(req.response, response)
        t.equal(response.request, req)
      })

      return req
    })

    t.test('accept a promise', function (t) {
      const req = popsicle(REMOTE_URL + '/echo')

      t.plan(1)

      req.after(function (response) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            t.equal(response, req.response)
            resolve()
          }, 10)
        })
      })

      return req
    })
  })

  test('always', function (t) {
    t.test('run all together in order', function (t) {
      const req = popsicle(REMOTE_URL + '/echo')
      let before = false
      let after = false
      let always = false

      t.plan(6)

      req.before(function () {
        before = true

        t.notOk(after)
        t.notOk(always)
      })

      req.after(function () {
        after = true

        t.ok(before)
        t.notOk(always)
      })

      req.always(function (request) {
        always = true

        t.ok(before)
        t.ok(after)
      })

      return req
    })

    t.test('run on error', function (t) {
      var req = popsicle(REMOTE_URL + '/echo')

      t.plan(2)

      req.before(function () {
        throw new Error('Testing')
      })

      req.always(function (self) {
        t.equal(self, req)
      })

      return req
        .catch(function (err) {
          t.equal(err.message, 'Testing')
        })
    })
  })
})

if (!process.browser) {
  test('cookie jar', function (t) {
    t.test('should work with a cookie jar', function (t) {
      let cookie: string

      const instance = popsicle.defaults({
        options: {
          jar: popsicle.jar()
        }
      })

      return instance(REMOTE_URL + '/cookie')
        .then(function (res) {
          t.notOk(res.get('Cookie'))
          t.ok(res.get('Set-Cookie'))

          cookie = res.get('Set-Cookie')

          return instance(REMOTE_URL + '/echo')
        })
        .then(function (res) {
          t.equal(res.get('Cookie').toLowerCase(), cookie.toLowerCase())
          t.notOk(res.get('Set-Cookie'))
        })
    })

    t.test('should update over redirects', function (t) {
      const instance = popsicle.defaults({
        options: {
          jar: popsicle.jar()
        }
      })

      return instance(REMOTE_URL + '/cookie/redirect')
        .then(function (res) {
          t.ok(/^new=cookie/.test(res.body))
        })
    })
  })
}

test('override request mechanism', function (t) {
  return popsicle({
    url: '/foo',
    transport: {
      open: function (request) {
        return Promise.resolve({
          url: '/foo',
          body: 'testing',
          headers: <any> {},
          status: 200,
          statusText: 'OK'
        })
      }
    }
  })
    .then(function (res) {
      t.equal(res.body, 'testing')
    })
})

if (!popsicle.browser) {
  test('redirect', function (t) {
    t.test('should follow 302 redirect with get', function (t) {
      return popsicle(REMOTE_URL + '/redirect')
        .then(function (res) {
          t.equal(res.body, 'welcome get')
          t.equal(res.status, 200)
          t.ok(/\/destination$/.test(res.url))
        })
    })

    t.test('should follow 301 redirect with post', function (t) {
      return popsicle.post(REMOTE_URL + '/redirect/code/301')
        .then(function (res) {
          t.equal(res.body, 'welcome get')
          t.equal(res.status, 200)
          t.ok(/\/destination$/.test(res.url))
        })
    })

    t.test('should follow 303 redirect with post', function (t) {
      return popsicle.post({
        url: REMOTE_URL + '/redirect/code/303',
        body: { foo: 'bar' }
      })
        .then(function (res) {
          t.equal(res.body, 'welcome get')
          t.equal(res.status, 200)
          t.ok(/\/destination$/.test(res.url))
        })
    })

    t.test('disable following redirects', function (t) {
      return popsicle({
        url: REMOTE_URL + '/redirect',
        options: {
          followRedirects: false
        }
      })
        .then(function (res) {
          t.equal(res.status, 302)
          t.ok(/\/redirect$/.test(res.url))
        })
    })

    t.test('default maximum redirects of 5', function (t) {
      t.plan(2)

      return popsicle(REMOTE_URL + '/redirect/6')
        .catch(function (err) {
          t.equal(err.message, 'Exceeded maximum of 5 redirects')
          t.equal(err.code, 'EMAXREDIRECTS')
        })
    })

    t.test('change maximum redirects', function (t) {
      return popsicle({
        url: REMOTE_URL + '/redirect/6',
        options: {
          maxRedirects: 10
        }
      })
        .then(function (res) {
          t.equal(res.body, 'welcome get')
          t.equal(res.status, 200)
          t.ok(/\/destination$/.test(res.url))
        })
    })

    t.test('support head redirects with 307', function (t) {
      return popsicle.head(REMOTE_URL + '/redirect/code/307')
        .then(function (res) {
          t.equal(res.body, null)
          t.equal(res.status, 200)
          t.ok(/\/destination$/.test(res.url))
        })
    })

    t.test('block 307/308 redirects by default', function (t) {
      return popsicle.post(REMOTE_URL + '/redirect/code/307')
        .then(function (res) {
          t.equal(res.status, 307)
          t.ok(/\/redirect\/code\/307$/.test(res.url))
        })
    })

    t.test('support user confirmed redirects with 308', function (t) {
      return popsicle.post({
        url: REMOTE_URL + '/redirect/code/308',
        options: {
          followRedirects () {
            return true
          }
        }
      })
        .then(function (res) {
          t.equal(res.body, 'welcome post')
          t.equal(res.status, 200)
          t.ok(/\/destination$/.test(res.url))
        })
    })
  })
}
