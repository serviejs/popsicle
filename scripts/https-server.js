var https = require('https')
var fs = require('fs')
var join = require('path').join

var options = {
  key: fs.readFileSync(join(__dirname, 'support/server-key.pem')),
  cert: fs.readFileSync(join(__dirname, 'support/server-crt.pem')),
  ca: fs.readFileSync(join(__dirname, 'support/ca-crt.pem'))
}

var server = https.createServer(options, function (req, res) {
  res.writeHead(200)
  res.end('Success')
})

if (!module.parent) {
  server.listen(process.env.HTTPS_PORT || 3000)
}