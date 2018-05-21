var express = require('express')
var bodyParser = require('body-parser')
var zlib = require('zlib')
var fs = require('fs')

var app = module.exports = express()

app.use(function (req, res, next) {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Credentials', 'true')
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE')
  res.set(
    'Access-Control-Allow-Headers',
    'X-Requested-With, Content-Type, Content-Length, Referrer, X-Example'
  )
  res.set('Access-Control-Expose-Headers', 'Content-Length')

  if (req.method === 'OPTIONS') {
    return res.end()
  }

  return next()
})

app.all('/echo', function (req, res, next) {
  res.set(req.headers)
  req.pipe(res)
})

app.all('/echo/zip', function (req, res, next) {
  var acceptEncoding = req.headers['accept-encoding']
  var encodings = acceptEncoding ? acceptEncoding.split(/ *, */) : []

  if (encodings.indexOf('deflate') > -1) {
    res.writeHead(200, { 'content-encoding': 'deflate' })
    req.pipe(zlib.createDeflate()).pipe(res)
  } else if (encodings.indexOf('gzip') > -1) {
    res.writeHead(200, { 'content-encoding': 'gzip' })
    req.pipe(zlib.createGzip()).pipe(res)
  } else {
    res.writeHead(200, {})
    req.pipe(res)
  }
})

app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

app.get('/', function (req, res) {
  res.redirect('/test/')
})

app.get('/error', function (req, res) {
  res.status(500).send('fail')
})

app.get('/cookie', function (req, res) {
  var expires = new Date(Date.now() + 10 * 60 * 60).toGMTString()

  res.set('set-cookie', 'hello=world; expires=' + expires + '; path=/')
  res.sendStatus(200)
})

app.all('/cookie/redirect', function (req, res) {
  var expires = new Date(Date.now() + 10 * 60 * 60).toGMTString()

  res.set('set-cookie', 'new=cookie; expires=' + expires + '; path=/')
  res.redirect('/echo/header/cookie')
})

app.get('/status/:status', function (req, res) {
  res.sendStatus(~~req.params.status)
})

app.get('/delay/const', function (req, res) {
  res.redirect('/delay/3000')
})

app.get('/delay/:ms(\\d+)', function (req, res) {
  var ms = ~~req.params.ms

  setTimeout(function () {
    res.sendStatus(200)
  }, ms)
})

app.all('/echo/query', function (req, res) {
  res.send(req.query)
})

app.all('/echo/method', function (req, res) {
  res.send(req.method)
})

app.all('/echo/header/:field', function (req, res) {
  res.send(req.headers[req.params.field])
})

app.all('/redirect/status/:code(\\d+)', function (req, res) {
  return res.redirect(~~req.params.code, '/destination')
})

app.all('/redirect/:n(\\d+)', function (req, res) {
  const n = ~~req.params.n

  if (n < 2) {
    res.redirect('/destination')
    return
  }

  res.redirect('/redirect/' + (n - 1))
})

app.all('/redirect', function (req, res) {
  res.redirect('/destination')
})

app.all('/destination', function (req, res) {
  res.send('welcome ' + req.method.toLowerCase())
})

app.all('/urandom', function (req, res) {
  fs.createReadStream('/dev/urandom').pipe(res)
})

app.get('/type/json', function (req, res) {
  res.send({
    username: 'blakeembrey'
  })
})

app.get('/type/text', function (req, res) {
  res.send('text response')
})

app.get('/type/urlencoded', function (req, res) {
  res.header('Content-Type', 'application/x-www-form-urlencoded')
  res.send('foo=bar')
})

app.get('/download', function (req, res) {
  res.set('Content-Length', 12)

  res.write('hello ')

  setTimeout(function () {
    res.write('world!')
    res.end()
  }, 200)
})

app.get('/raw-headers', function (req, res) {
  res.send(req.rawHeaders)
})

if (!module.parent) {
  app.listen(process.env.PORT || 3000)
}
