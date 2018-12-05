import { join } from 'path'
import { readFileSync } from 'fs'
import { request, transport, cookieJar } from './node'
import { TEST_HTTP_URL, TEST_HTTPS_URL } from './common.spec'

describe('popsicle node', () => {
  it('should return 2xx statuses', async () => {
    const res = await transport()(request(`${TEST_HTTP_URL}/status/204`))

    expect(res.ok).toEqual(true)
    expect(res.statusCode).toEqual(204)
    expect(res.statusMessage).toEqual('No Content')
  })

  it('should return 4xx statuses', async () => {
    const res = await transport()(request(`${TEST_HTTP_URL}/status/404`))

    expect(res.ok).toEqual(false)
    expect(res.statusCode).toEqual(404)
    expect(res.statusMessage).toEqual('Not Found')
  })

  it('should return 5xx statuses', async () => {
    const res = await transport()(request(`${TEST_HTTP_URL}/status/500`))

    expect(res.ok).toEqual(false)
    expect(res.statusCode).toEqual(500)
    expect(res.statusMessage).toEqual('Internal Server Error')
  })

  it('should always send user agent', async () => {
    const res = await transport()(request(`${TEST_HTTP_URL}/echo/header/user-agent`))

    expect(await res.body.text()).toEqual('Popsicle (https://github.com/serviejs/popsicle)')
  })

  it('send a custom user agent header', async () => {
    const req = request(`${TEST_HTTP_URL}/echo/header/user-agent`, {
      headers: { 'User-Agent': 'foobar' }
    })

    const res = await transport()(req)

    expect(await res.body.text()).toEqual('foobar')
  })

  it('should send case sensitive headers', async () => {
    const req = request(`${TEST_HTTP_URL}/raw-headers`, {
      headers: { 'RaW-HeAder': 'test' }
    })

    const res = await transport()(req)

    expect(await res.body.json()).toContain('RaW-HeAder')
  })

  it('should send post data', async () => {
    const req = request(`${TEST_HTTP_URL}/echo`, {
      method: 'POST',
      body: 'example data',
      headers: {
        'content-type': 'application/octet-stream'
      }
    })

    const res = await transport()(req)

    expect(res.statusCode).toEqual(200)
    expect(res.statusMessage).toEqual('OK')
    expect(res.headers.get('Content-Type')).toEqual('application/octet-stream')
    expect(await res.body.text()).toEqual('example data')
  })

  it('should abort before it starts', async () => {
    const req = request(`${TEST_HTTP_URL}/echo`)

    req.abort()

    expect.assertions(1)

    try {
      await transport()(req)
    } catch (err) {
      expect(err.message).toEqual('Request has been aborted')
    }
  })

  it('should abort mid-request', async () => {
    const req = request(`${TEST_HTTP_URL}/download`)
    const res = await transport()(req)

    setTimeout(() => req.abort(), 100)

    expect(await res.body.text()).toEqual('hello ')
  })

  it('should have no side effects aborting twice', async () => {
    const req = request(`${TEST_HTTP_URL}/download`)

    expect.assertions(1)

    req.abort()
    req.abort()

    try {
      await transport()(req)
    } catch (err) {
      expect(err.message).toEqual('Request has been aborted')
    }
  })

  it('should emit download progress', async () => {
    const req = request(`${TEST_HTTP_URL}/download`)
    const spy = jest.fn()

    const res = await transport()(req)

    res.events.on('progress', spy)

    expect(await res.body.text()).toEqual('hello world!')

    // Check spy after body has loaded.
    expect(spy).toBeCalledWith(12)
  })

  it('should work with a cookie jar', async () => {
    let cookie: string | undefined
    const t = transport({ jar: cookieJar() })

    const cookieRes = await t(request(`${TEST_HTTP_URL}/cookie`))

    expect(cookieRes.headers.has('Cookie')).toEqual(false)
    expect(cookieRes.headers.has('Set-Cookie')).toEqual(true)

    cookie = (cookieRes.headers.get('Set-Cookie') || '').split(';').shift()

    const echoRes = await t(request(`${TEST_HTTP_URL}/echo`))

    expect(echoRes.headers.get('Cookie')).toEqual(cookie)
    expect(echoRes.headers.has('Set-Cookie')).toEqual(false)
  })

  it('should update cookies over redirects', async () => {
    const t = transport({ jar: cookieJar() })
    const res = await t(request(`${TEST_HTTP_URL}/cookie/redirect`))

    expect(await res.body.text()).toMatch(/^new=cookie/)
  })

  it('should follow 302 redirect with get', async () => {
    const req = request(`${TEST_HTTP_URL}/redirect`)
    const spy = jest.fn()

    req.events.on('redirect', spy)

    const res = await transport()(req)

    expect(spy).toBeCalledWith(`${TEST_HTTP_URL}/destination`)
    expect(res.statusCode).toEqual(200)
    expect(await res.body.text()).toEqual('welcome get')
  })

  it('should follow 301 redirect with post', async () => {
    const req = request(`${TEST_HTTP_URL}/redirect/status/301`, { method: 'post' })
    const res = await transport()(req)

    expect(res.statusCode).toEqual(200)
    expect(await res.body.text()).toEqual('welcome get')
  })

  it('should follow 303 redirect with post', async () => {
    const req = request(`${TEST_HTTP_URL}/redirect/status/303`, { method: 'post' })
    const res = await transport()(req)

    expect(res.statusCode).toEqual(200)
    expect(await res.body.text()).toEqual('welcome get')
  })

  it('should support disabling following redirects', async () => {
    const req = request(`${TEST_HTTP_URL}/redirect`, { method: 'post' })
    const res = await transport({ follow: false })(req)

    expect(res.statusCode).toEqual(302)
    expect(await res.body.text()).toEqual('Found. Redirecting to /destination')
  })

  it('should default to a maximum of 5 redirects', async () => {
    expect.assertions(2)

    try {
      await transport()(request(`${TEST_HTTP_URL}/redirect/6`))
    } catch (err) {
      expect(err.code).toEqual('EMAXREDIRECTS')
      expect(err.message).toEqual('Maximum redirects exceeded: 5')
    }
  })

  it('should change maximum redirects', async () => {
    const req = request(`${TEST_HTTP_URL}/redirect/6`)
    const res = await transport({ maxRedirects: 10 })(req)

    expect(res.statusCode).toEqual(200)
    expect(await res.body.text()).toEqual('welcome get')
  })

  it('should support head redirects with 307', async () => {
    const req = request(`${TEST_HTTP_URL}/redirect/status/307`, { method: 'head' })
    const res = await transport()(req)

    expect(res.statusCode).toEqual(200)
    expect(await res.body.text()).toEqual('')
  })

  it('should block 307/308 redirects by default', async () => {
    const req = request(`${TEST_HTTP_URL}/redirect/status/307`, { method: 'post' })
    const res = await transport()(req)

    expect(res.statusCode).toEqual(307)
    expect(await res.body.text()).toEqual('Temporary Redirect. Redirecting to /destination')
  })

  it('should stop redirecting on false confirmation', async () => {
    const req = request(`${TEST_HTTP_URL}/redirect/status/307`, { method: 'post' })
    const confirmRedirect = jest.fn(() => false)
    const res = await transport({ confirmRedirect })(req)

    expect(confirmRedirect).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toEqual(307)
    expect(await res.body.text()).toEqual('Temporary Redirect. Redirecting to /destination')
  })

  it('should support user confirmed redirects with 308', async () => {
    const req = request(`${TEST_HTTP_URL}/redirect/status/307`, { method: 'POST' })
    const confirmRedirect = jest.fn(() => true)
    const res = await transport({ confirmRedirect })(req)

    expect(confirmRedirect).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toEqual(200)
    expect(await res.body.text()).toEqual('welcome post')
  })

  it('should reject https unauthorized', async () => {
    expect.assertions(1)

    try {
      await transport()(request(TEST_HTTPS_URL))
    } catch (err) {
      expect(err.code).toEqual('EUNAVAILABLE')
    }
  })

  it.skip('should support https ca option', async () => {
    const req = request(TEST_HTTPS_URL)
    const ca = readFileSync(join(__dirname, '../scripts/support/ca-crt.pem'))
    const res = await transport({ ca })(req)

    expect(res.statusCode).toEqual(200)
    expect(await res.body.text()).toEqual('Success')
  })

  it('should support disabling reject unauthorized', async () => {
    const req = request(TEST_HTTPS_URL)
    const res = await transport({ rejectUnauthorized: false })(req)

    expect(res.statusCode).toEqual(200)
    expect(await res.body.text()).toEqual('Success')
  })
})
