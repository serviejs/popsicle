/* global describe, it, expect, popsicle */

var isNode = typeof window === 'undefined'

var REMOTE_URL = 'http://localhost:4567'

describe('popsicle', function () {
  var EXAMPLE_BODY = {
    username: 'blakeembrey',
    password: 'hunter2'
  }

  var BOUNDARY_REGEXP = /^multipart\/form-data; boundary=([^;]+)/

  it('should exist', function () {
    expect(popsicle).to.be.a('function')
  })

  it('should have a form function', function () {
    expect(popsicle.form).to.be.a('function')

    expect(popsicle.form().append).to.be.a('function')
  })

  describe('initialization', function () {
    it('should throw an error when initialized without options', function () {
      expect(function () {
        return popsicle()
      }).to.throw(TypeError, /no options specified/i)
    })

    it('should throw an error when no url option is specified', function () {
      expect(function () {
        return popsicle({ query: 'test=true' })
      }).to.throw(TypeError, /no url specified/i)
    })

    it('should return a Request instance', function () {
      expect(popsicle('/')).to.be.an.instanceOf(popsicle.Request)
    })

    it('should reuse the same promise response', function () {
      var req = popsicle(REMOTE_URL + '/echo')

      return req
        .then(function (res) {
          return req
            .catch(function () {})
            .then(function (res2) {
              expect(res).to.equal(res2)
            })
        })
    })
  })

  describe('response chaining', function () {
    it('should be able to chain promise', function () {
      return popsicle(REMOTE_URL + '/echo')
        .then(function (res) {
          expect(res).to.be.an.instanceOf(popsicle.Response)
        })
    })

    it('should be able to use node-style callbacks', function (done) {
      return popsicle(REMOTE_URL + '/echo')
        .exec(function (err, res) {
          expect(res).to.be.an.instanceOf(popsicle.Response)

          return done(err)
        })
    })
  })

  describe('methods', function () {
    it('should allow a method to be passed in', function () {
      return popsicle({
        url: REMOTE_URL + '/echo',
        method: 'POST'
      })
        .then(function (res) {
          expect(res).to.be.an.instanceOf(popsicle.Response)
          expect(res.request.method).to.equal('POST')
        })
    })
  })

  describe('response statuses', function () {
    it('5xx', function () {
      return popsicle(REMOTE_URL + '/error')
        .then(function (res) {
          expect(res.status).to.equal(500)
          expect(res.statusType()).to.equal(5)
        })
    })

    it('4xx', function () {
      return popsicle(REMOTE_URL + '/not-found')
        .then(function (res) {
          expect(res.status).to.equal(404)
          expect(res.statusType()).to.equal(4)
        })
    })

    it('2xx', function () {
      return popsicle(REMOTE_URL + '/no-content')
        .then(function (res) {
          expect(res.status).to.equal(204)
          expect(res.statusType()).to.equal(2)
        })
    })
  })

  describe('request headers', function () {
    it('should always send a user agent', function () {
      return popsicle(REMOTE_URL + '/echo/header/user-agent')
        .then(function (res) {
          var regexp = isNode ?
            /^https:\/\/github\.com\/blakeembrey\/popsicle$/ :
            /^Mozilla\/.+$/

          expect(res.body).to.match(regexp)
        })
    })
  })

  describe('response headers', function () {
    it('should parse', function () {
      return popsicle(REMOTE_URL + '/notfound')
        .then(function (res) {
          expect(res.type()).to.equal('text/html')
          expect(res.get('Content-Type')).to.equal('text/html; charset=utf-8')
        })
    })
  })

  describe('request body', function () {
    it('send post data', function () {
      return popsicle({
        url: REMOTE_URL + '/echo',
        method: 'POST',
        body: 'example data',
        headers: {
          'content-type': 'application/octet-stream'
        }
      })
        .then(function (res) {
          expect(res.body).to.equal('example data')
          expect(res.type()).to.equal('application/octet-stream')
        })
    })

    it('should automatically send objects as json', function () {
      return popsicle({
        url: REMOTE_URL + '/echo',
        method: 'POST',
        body: EXAMPLE_BODY
      })
        .then(function (res) {
          expect(res.body).to.deep.equal(EXAMPLE_BODY)
          expect(res.type()).to.equal('application/json')
        })
    })

    it('should send as form encoded when header is set', function () {
      return popsicle({
        url: REMOTE_URL + '/echo',
        method: 'POST',
        body: EXAMPLE_BODY,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })
        .then(function (res) {
          expect(res.body).to.deep.equal(EXAMPLE_BODY)
          expect(res.type()).to.equal('application/x-www-form-urlencoded')
        })
    })

    describe('host objects', function () {
      describe('form data', function () {
        function validateResponse (res) {
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

          expect(res.body).to.equal(body)
        }

        it('should create form data instance', function () {
          var form = popsicle.form(EXAMPLE_BODY)

          expect(form).to.be.an.instanceOf(FormData)

          return popsicle({
            url: REMOTE_URL + '/echo',
            method: 'POST',
            body: form
          }).then(validateResponse)
        })

        it('should stringify to form data when set as multipart', function () {
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

  describe('query', function () {
    it('should stringify and send query parameters', function () {
      return popsicle({
        url: REMOTE_URL + '/echo/query',
        query: EXAMPLE_BODY
      })
        .then(function (res) {
          expect(res.body).to.deep.equal(EXAMPLE_BODY)
        })
    })

    it('should stringify and append to query object', function () {
      var req = popsicle({
        url: REMOTE_URL + '/echo/query?query=true',
        query: EXAMPLE_BODY
      })

      var query = {
        username: 'blakeembrey',
        password: 'hunter2',
        query: 'true'
      }

      expect(req.url).to.equal(REMOTE_URL + '/echo/query')
      expect(req.query).to.deep.equal(query)

      return req
        .then(function (res) {
          expect(res.body).to.deep.equal(query)
        })
    })

    it('should accept query as a string', function () {
      var req = popsicle({
        url: REMOTE_URL + '/echo/query',
        query: 'query=true'
      })

      expect(req.url).to.equal(REMOTE_URL + '/echo/query')
      expect(req.query).to.deep.equal({ query: 'true' })

      return req
        .then(function (res) {
          expect(res.body).to.deep.equal({ query: 'true' })
        })
    })
  })

  describe('timeout', function () {
    it('should timeout the request when set', function () {
      var errored = false

      return popsicle({
        url: REMOTE_URL + '/delay/1500',
        timeout: 500
      })
        .catch(function (err) {
          errored = true

          expect(err.message).to.equal('Timeout of 500ms exceeded')
          expect(err.timeout).to.equal(500)
          expect(err.popsicle).to.be.an.instanceOf(popsicle.Request)
        })
        .then(function () {
          expect(errored).to.be.true
        })
    })
  })

  describe('abort', function () {
    it('should be able to abort before it starts', function () {
      var req = popsicle(REMOTE_URL + '/echo')
      var errored = false

      req.abort()

      return req
        .catch(function (err) {
          errored = true

          expect(err.message).to.equal('Request aborted')
          expect(err.abort).to.be.true
          expect(err.popsicle).to.be.an.instanceOf(popsicle.Request)
        })
        .then(function () {
          expect(errored).to.be.true
        })
    })

    it('should be able to abort mid-request', function () {
      var req = popsicle(REMOTE_URL + '/download')
      var errored = false

      setTimeout(function () {
        req.abort()
      }, 100)

      return req
        .catch(function (err) {
          errored = true

          expect(err.message).to.equal('Request aborted')
          expect(err.abort).to.be.true
          expect(err.popsicle).to.be.an.instanceOf(popsicle.Request)
        })
        .then(function () {
          expect(errored).to.be.true
        })
    })

    it('should not have any side effects aborting twice', function () {
      var req = popsicle(REMOTE_URL + '/download')
      var errored = false

      req.abort()
      req.abort()

      return req
        .catch(function (err) {
          errored = true

          expect(err.message).to.equal('Request aborted')
          expect(err.abort).to.be.true
          expect(err.popsicle).to.be.an.instanceOf(popsicle.Request)
        })
        .then(function () {
          expect(errored).to.be.true
        })
    })
  })

  describe('progress', function () {
    describe('download', function () {
      it('should check download progress', function () {
        var req = popsicle(REMOTE_URL + '/download')
        var assert = false

        // Before the request has started.
        expect(req.downloaded).to.equal(0)

        // Check halfway into the response.
        setTimeout(function () {
          assert = req.downloaded === 0.5
        }, 100)

        return req
          .then(function () {
            // Can't consistently test progress in browsers.
            if (typeof window === 'undefined') {
              expect(assert).to.be.true
            }

            expect(req.downloaded).to.equal(1)
          })
      })
    })

    describe('event', function () {
      it('should emit progress events', function () {
        var req = popsicle({
          url: REMOTE_URL + '/echo',
          body: EXAMPLE_BODY,
          method: 'POST'
        })

        var asserted = 0
        var expected = 0

        req.progress(function (e) {
          asserted += 1
          expected += 0.5

          expect(e.completed).to.equal(expected)
        })

        return req
          .then(function (res) {
            expect(asserted).to.equal(2)
            expect(res.body).to.deep.equal(EXAMPLE_BODY)
          })
      })

      it('should error when the progress callback errors', function () {
        var req = popsicle(REMOTE_URL + '/echo')
        var errored = false

        req.progress(function () {
          throw new Error('Testing')
        })

        return req
          .catch(function (err) {
            errored = true

            expect(err.message).to.equal('Testing')
            expect(err.popsicle).to.not.exist
          })
          .then(function () {
            expect(errored).to.be.true
          })
      })

      it('should emit a final event on abort', function () {
        var req = popsicle(REMOTE_URL + '/echo')
        var errored = false
        var progressed = 0

        req.progress(function (e) {
          expect(e.completed).to.equal(1)
          expect(e.aborted).to.be.true

          progressed++
        })

        req.abort()

        return req
          .catch(function (err) {
            errored = true

            expect(err.abort).to.be.true
          })
          .then(function () {
            expect(errored).to.be.true
            expect(progressed).to.equal(1)
          })
      })
    })
  })

  describe('response body', function () {
    it('should automatically parse json responses', function () {
      return popsicle(REMOTE_URL + '/json')
        .then(function (res) {
          expect(res.body).to.deep.equal({ username: 'blakeembrey' })
          expect(res.type()).to.equal('application/json')
        })
    })

    it('should automatically parse form encoded responses', function () {
      return popsicle(REMOTE_URL + '/foo')
        .then(function (res) {
          expect(res.body).to.deep.equal({ foo: 'bar' })
          expect(res.type()).to.equal('application/x-www-form-urlencoded')
        })
    })

    it('should disable response parsing', function () {
      return popsicle({
        url: REMOTE_URL + '/json',
        parse: false
      })
        .then(function (res) {
          expect(res.body).to.equal('{"username":"blakeembrey"}')
          expect(res.type()).to.equal('application/json')
        })
    })

    it('should set non-parsable responses as null', function () {
      return popsicle({
        url: REMOTE_URL + '/echo',
        method: 'post'
      })
        .then(function (res) {
          expect(res.body).to.equal(null)
        })
    })

    it('should set responses to null when empty', function () {
      return popsicle({
        url: REMOTE_URL + '/echo',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })
        .then(function (res) {
          expect(res.body).to.equal(null)
          expect(res.type()).to.equal('application/json')
        })
    })

    if (isNode) {
      var fs = require('fs')
      var concat = require('concat-stream')
      var filename = require('path').join(__dirname, '../popsicle.js')
      var filecontents = fs.readFileSync(filename, 'utf-8')

      it('should stream the response', function () {
        return popsicle({
          url: REMOTE_URL + '/json',
          stream: true
        })
          .then(function (res) {
            expect(res.body).to.be.an('object')

            return new Promise(function (resolve) {
              res.body.pipe(concat(function (data) {
                expect(data.toString()).to.equal('{"username":"blakeembrey"}')

                return resolve()
              }))
            })
          })
      })

      it('should pipe streams', function () {
        return popsicle({
          url: REMOTE_URL + '/echo',
          body: fs.createReadStream(filename)
        })
          .then(function (res) {
            expect(res.body).to.equal(filecontents)
          })
      })

      it('should pipe streams into forms', function () {
        return popsicle({
          url: REMOTE_URL + '/echo',
          body: popsicle.form({
            file: fs.createReadStream(filename)
          })
        })
          .then(function (res) {
            var boundary = BOUNDARY_REGEXP.exec(res.headers['content-type'])[1]

            expect(res.body).to.equal([
              '--' + boundary,
              'Content-Disposition: form-data; name="file"; filename="popsicle.js"',
              'Content-Type: application/javascript',
              '',
              filecontents,
              '--' + boundary + '--'
            ].join('\r\n'))
          })
      })
    }
  })

  describe('request errors', function () {
    it('should error when requesting an unknown domain', function () {
      var req = popsicle('http://fdahkfjhuehfakjbvdahjfds.fdsa')
      var errored = false

      return req
        .catch(function (err) {
          errored = true

          expect(err.message).to.match(/Unable to connect/i)
          expect(err.unavailable).to.be.true
          expect(err.popsicle).to.be.an.instanceOf(popsicle.Request)
        })
        .then(function () {
          expect(errored).to.be.true
        })
    })

    it('should give a parse error on invalid response body', function () {
      var errored = false

      return popsicle({
        url: REMOTE_URL + '/echo',
        method: 'POST',
        body: 'username=blakeembrey&password=hunter2',
        headers: {
          'Content-Type': 'application/json'
        }
      })
        .catch(function (err) {
          errored = true

          expect(err.message).to.match(/Unable to parse the response body/i)
          expect(err.parse).to.be.true
          expect(err.popsicle).to.be.an.instanceOf(popsicle.Request)
        })
        .then(function () {
          expect(errored).to.be.true
        })
    })

    it('should give a stringify error on invalid request body', function () {
      var errored = false
      var obj = {}

      // Recursive link will fail to stringify.
      obj.obj = obj

      return popsicle({
        url: REMOTE_URL + '/echo',
        method: 'POST',
        body: obj
      })
        .catch(function (err) {
          errored = true

          expect(err.message).to.match(/Unable to stringify the request body/i)
          expect(err.stringify).to.be.true
          expect(err.popsicle).to.be.an.instanceOf(popsicle.Request)
        })
        .then(function () {
          expect(errored).to.be.true
        })
    })
  })

  describe('plugin', function () {
    it('should be able to modify the request', function () {
      var req = popsicle(REMOTE_URL + '/echo')
      var used = false

      req.use(function (self) {
        used = true
        expect(self).to.equal(req)
      })

      return req
        .then(function () {
          expect(used).to.be.true
        })
    })
  })

  describe('request flow', function () {
    describe('before', function () {
      it('should be able to run a function before opening the request', function () {
        var req = popsicle(REMOTE_URL + '/echo')
        var before = false

        req.before(function (request) {
          before = true
          expect(request).to.be.an.instanceOf(popsicle.Request)
          expect(request.response).to.not.exist
        })

        return req
          .then(function () {
            expect(before).to.be.true
          })
      })

      it('should be able to fail the request before starting', function () {
        var req = popsicle(REMOTE_URL + '/echo')
        var failed = false

        req.before(function () {
          throw new Error('Hello world!')
        })

        return req
          .catch(function (err) {
            failed = true
            expect(err.message).to.equal('Hello world!')
          })
          .then(function () {
            expect(failed).to.be.true
          })
      })

      it('should accept a promise to delay the request', function () {
        var req = popsicle(REMOTE_URL + '/echo')
        var before = false

        req.before(function () {
          return new Promise(function (resolve) {
            setTimeout(function () {
              before = true
              resolve()
            }, 10)
          })
        })

        return req
          .then(function () {
            expect(before).to.be.true
          })
      })
    })

    describe('after', function () {
      it('should run with the response, after before', function () {
        var req = popsicle(REMOTE_URL + '/echo')
        var after = false
        var before = false

        req.before(function () {
          before = true
        })

        req.after(function (response) {
          after = true
          expect(before).to.be.true
          expect(response).to.be.an.instanceOf(popsicle.Response)
          expect(response.request).to.equal(req)
        })

        return req
          .then(function () {
            expect(after).to.be.true
          })
      })

      it('should accept a promise', function () {
        var req = popsicle(REMOTE_URL + '/echo')
        var after = false

        req.after(function (response) {
          return new Promise(function (resolve) {
            expect(response).to.be.an.instanceOf(popsicle.Response)

            setTimeout(function () {
              after = true
              resolve()
            }, 10)
          })
        })

        return req
          .then(function () {
            expect(after).to.be.true
          })
      })
    })

    describe('always', function () {
      it('should run on success, after before and after', function () {
        var req = popsicle(REMOTE_URL + '/echo')
        var before = false
        var after = false
        var always = false

        req.before(function () {
          before = true
        })

        req.after(function () {
          after = true
        })

        req.always(function (request) {
          always = true
          expect(before).to.be.true
          expect(after).to.be.true
          expect(request).to.equal(req)
        })

        return req
          .then(function () {
            expect(always).to.be.true
          })
      })

      it('should run on error', function () {
        var req = popsicle(REMOTE_URL + '/echo')
        var always = false
        var errored = false

        req.before(function () {
          throw new Error('Testing')
        })

        req.always(function (request) {
          always = true
          expect(request).to.equal(req)
        })

        return req
          .catch(function (err) {
            errored = true
            expect(err.message).to.equal('Testing')
          })
          .then(function () {
            expect(always).to.be.true
            expect(errored).to.be.true
          })
      })
    })
  })

  if (isNode) {
    describe('cookie jar', function () {
      it('should work with a cookie jar', function () {
        var jar = popsicle.jar()
        var cookie

        return popsicle({
          url: REMOTE_URL + '/cookie',
          jar: jar
        })
          .then(function (res) {
            expect(res.get('Cookie')).to.not.exist
            expect(res.get('Set-Cookie')).to.exist

            cookie = res.get('Set-Cookie')

            return popsicle({
              url: REMOTE_URL + '/echo',
              jar: jar
            })
          })
          .then(function (res) {
            expect(res.get('Cookie')).to.match(/^hello=world/)
            expect(res.get('Cookie').toLowerCase()).to.equal(cookie.toLowerCase())
            expect(res.get('Set-Cookie')).to.not.exist
          })
      })
    })
  }
})
