var express    = require('express');
var bodyParser = require('body-parser');

var app = module.exports = express();

app.set('json spaces', 0);

app.use(function (req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Allow-Methods', '*');
  res.set(
    'Access-Control-Allow-Headers',
    'X-Requested-With, Content-Type, Content-Length, Referrer'
  );
  res.set('Access-Control-Expose-Headers', 'Content-Length');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  return next();
});

app.use(function (req, res, next) {
  if (req.url !== '/echo') {
    return next();
  }

  res.set(req.headers);
  req.pipe(res);
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/', function (req, res) {
  res.redirect('/test/');
});

app.get('/error', function (req, res) {
  res.status(500).send('fail');
});

app.get('/cookie', function (req, res) {
  var expires = new Date(Date.now() + 10 * 60 * 60).toGMTString();

  res.set('set-cookie', 'hello=world; expires=' + expires + '; path=/');
  res.sendStatus(200);
});

app.get('/not-found', function (req, res) {
  res.sendStatus(404);
});

app.get('/no-content', function (req, res) {
  res.sendStatus(204);
});

app.get('/delay/const', function (req, res) {
  res.redirect('/delay/3000');
});

app.get('/delay/:ms', function (req, res) {
  var ms = ~~req.params.ms;

  setTimeout(function () {
    res.sendStatus(200);
  }, ms);
});

app.all('/echo/query', function (req, res){
  res.send(req.query);
});

app.all('/echo/header/:field', function (req, res){
  res.send(req.headers[req.params.field]);
});

app.get('/json', function (req, res) {
  res.send({
    username: 'blakeembrey'
  });
});

app.get('/text', function (req, res) {
  res.send('text response');
});

app.get('/foo', function (req, res) {
  res.header('Content-Type', 'application/x-www-form-urlencoded');
  res.send('foo=bar');
});

app.get('/download', function (req, res) {
  res.set('Content-Length', 12);

  res.write('hello ');

  setTimeout(function () {
    res.write('world!');
    res.end();
  }, 200);
});
