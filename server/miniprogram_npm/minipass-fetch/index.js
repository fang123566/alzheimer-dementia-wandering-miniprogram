module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1775127000619, function(require, module, exports) {

const Url = require('url')
const http = require('http')
const https = require('https')
const zlib = require('minizlib')
const Minipass = require('minipass')

const Body = require('./body.js')
const { writeToStream, getTotalBytes } = Body
const Response = require('./response.js')
const Headers = require('./headers.js')
const { createHeadersLenient } = Headers
const Request = require('./request.js')
const { getNodeRequestOptions } = Request
const FetchError = require('./fetch-error.js')
const AbortError = require('./abort-error.js')

const resolveUrl = Url.resolve

const fetch = (url, opts) => {
  if (/^data:/.test(url)) {
    const request = new Request(url, opts)
    try {
      const split = url.split(',')
      const data = Buffer.from(split[1], 'base64')
      const type = split[0].match(/^data:(.*);base64$/)[1]
      return Promise.resolve(new Response(data, {
        headers: {
          'Content-Type': type,
          'Content-Length': data.length,
        }
      }))
    } catch (er) {
      return Promise.reject(new FetchError(`[${request.method}] ${
        request.url} invalid URL, ${er.message}`, 'system', er))
    }
  }

  return new Promise((resolve, reject) => {
    // build request object
    const request = new Request(url, opts)
    let options
    try {
      options = getNodeRequestOptions(request)
    } catch (er) {
      return reject(er)
    }

    const send = (options.protocol === 'https:' ? https : http).request
    const { signal } = request
    let response = null
    const abort = () => {
      const error = new AbortError('The user aborted a request.')
      reject(error)
      if (Minipass.isStream(request.body) &&
          typeof request.body.destroy === 'function') {
        request.body.destroy(error)
      }
      if (response && response.body) {
        response.body.emit('error', error)
      }
    }

    if (signal && signal.aborted)
      return abort()

    const abortAndFinalize = () => {
      abort()
      finalize()
    }

    const finalize = () => {
      req.abort()
      if (signal)
        signal.removeEventListener('abort', abortAndFinalize)
      clearTimeout(reqTimeout)
    }

    // send request
    const req = send(options)

    if (signal)
      signal.addEventListener('abort', abortAndFinalize)

    let reqTimeout = null
    if (request.timeout) {
      req.once('socket', socket => {
        reqTimeout = setTimeout(() => {
          reject(new FetchError(`network timeout at: ${
            request.url}`, 'request-timeout'))
          finalize()
        }, request.timeout)
      })
    }

    req.on('error', er => {
      // if a 'response' event is emitted before the 'error' event, then by the
      // time this handler is run it's too late to reject the Promise for the
      // response. instead, we forward the error event to the response stream
      // so that the error will surface to the user when they try to consume
      // the body. this is done as a side effect of aborting the request except
      // for in windows, where we must forward the event manually, otherwise
      // there is no longer a ref'd socket attached to the request and the
      // stream never ends so the event loop runs out of work and the process
      // exits without warning.
      // coverage skipped here due to the difficulty in testing
      // istanbul ignore next
      if (req.res)
        req.res.emit('error', er)
      reject(new FetchError(`request to ${request.url} failed, reason: ${
        er.message}`, 'system', er))
      finalize()
    })

    req.on('response', res => {
      clearTimeout(reqTimeout)

      const headers = createHeadersLenient(res.headers)

      // HTTP fetch step 5
      if (fetch.isRedirect(res.statusCode)) {
        // HTTP fetch step 5.2
        const location = headers.get('Location')

        // HTTP fetch step 5.3
        const locationURL = location === null ? null
          : resolveUrl(request.url, location)

        // HTTP fetch step 5.5
        switch (request.redirect) {
          case 'error':
            reject(new FetchError(`uri requested responds with a redirect, redirect mode is set to error: ${
              request.url}`, 'no-redirect'))
            finalize()
            return

          case 'manual':
            // node-fetch-specific step: make manual redirect a bit easier to
            // use by setting the Location header value to the resolved URL.
            if (locationURL !== null) {
              // handle corrupted header
              try {
                headers.set('Location', locationURL)
              } catch (err) {
                /* istanbul ignore next: nodejs server prevent invalid
                   response headers, we can't test this through normal
                   request */
                reject(err)
              }
            }
            break

          case 'follow':
            // HTTP-redirect fetch step 2
            if (locationURL === null) {
              break
            }

            // HTTP-redirect fetch step 5
            if (request.counter >= request.follow) {
              reject(new FetchError(`maximum redirect reached at: ${
                request.url}`, 'max-redirect'))
              finalize()
              return
            }

            // HTTP-redirect fetch step 9
            if (res.statusCode !== 303 &&
                request.body &&
                getTotalBytes(request) === null) {
              reject(new FetchError(
                'Cannot follow redirect with body being a readable stream',
                'unsupported-redirect'
              ))
              finalize()
              return
            }

            // Update host due to redirection
            request.headers.set('host', Url.parse(locationURL).host)

            // HTTP-redirect fetch step 6 (counter increment)
            // Create a new Request object.
            const requestOpts = {
              headers: new Headers(request.headers),
              follow: request.follow,
              counter: request.counter + 1,
              agent: request.agent,
              compress: request.compress,
              method: request.method,
              body: request.body,
              signal: request.signal,
              timeout: request.timeout,
            }

            // HTTP-redirect fetch step 11
            if (res.statusCode === 303 || (
                (res.statusCode === 301 || res.statusCode === 302) &&
                request.method === 'POST'
            )) {
              requestOpts.method = 'GET'
              requestOpts.body = undefined
              requestOpts.headers.delete('content-length')
            }

            // HTTP-redirect fetch step 15
            resolve(fetch(new Request(locationURL, requestOpts)))
            finalize()
            return
        }
      } // end if(isRedirect)


      // prepare response
      res.once('end', () =>
        signal && signal.removeEventListener('abort', abortAndFinalize))

      const body = new Minipass()
      // exceedingly rare that the stream would have an error,
      // but just in case we proxy it to the stream in use.
      res.on('error', /* istanbul ignore next */ er => body.emit('error', er))
      res.on('data', (chunk) => body.write(chunk))
      res.on('end', () => body.end())

      const responseOptions = {
        url: request.url,
        status: res.statusCode,
        statusText: res.statusMessage,
        headers: headers,
        size: request.size,
        timeout: request.timeout,
        counter: request.counter,
        trailer: new Promise(resolve =>
          res.on('end', () => resolve(createHeadersLenient(res.trailers))))
      }

      // HTTP-network fetch step 12.1.1.3
      const codings = headers.get('Content-Encoding')

      // HTTP-network fetch step 12.1.1.4: handle content codings

      // in following scenarios we ignore compression support
      // 1. compression support is disabled
      // 2. HEAD request
      // 3. no Content-Encoding header
      // 4. no content response (204)
      // 5. content not modified response (304)
      if (!request.compress ||
          request.method === 'HEAD' ||
          codings === null ||
          res.statusCode === 204 ||
          res.statusCode === 304) {
        response = new Response(body, responseOptions)
        resolve(response)
        return
      }


      // Be less strict when decoding compressed responses, since sometimes
      // servers send slightly invalid responses that are still accepted
      // by common browsers.
      // Always using Z_SYNC_FLUSH is what cURL does.
      const zlibOptions = {
        flush: zlib.constants.Z_SYNC_FLUSH,
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      }

      // for gzip
      if (codings == 'gzip' || codings == 'x-gzip') {
        const unzip = new zlib.Gunzip(zlibOptions)
        response = new Response(
          // exceedingly rare that the stream would have an error,
          // but just in case we proxy it to the stream in use.
          body.on('error', /* istanbul ignore next */ er => unzip.emit('error', er)).pipe(unzip),
          responseOptions
        )
        resolve(response)
        return
      }

      // for deflate
      if (codings == 'deflate' || codings == 'x-deflate') {
        // handle the infamous raw deflate response from old servers
        // a hack for old IIS and Apache servers
        const raw = res.pipe(new Minipass())
        raw.once('data', chunk => {
          // see http://stackoverflow.com/questions/37519828
          const decoder = (chunk[0] & 0x0F) === 0x08
            ? new zlib.Inflate()
            : new zlib.InflateRaw()
          // exceedingly rare that the stream would have an error,
          // but just in case we proxy it to the stream in use.
          body.on('error', /* istanbul ignore next */ er => decoder.emit('error', er)).pipe(decoder)
          response = new Response(decoder, responseOptions)
          resolve(response)
        })
        return
      }


      // for br
      if (codings == 'br') {
        // ignoring coverage so tests don't have to fake support (or lack of) for brotli
        // istanbul ignore next
        try {
          var decoder = new zlib.BrotliDecompress()
        } catch (err) {
          reject(err)
          finalize()
          return
        }
        // exceedingly rare that the stream would have an error,
        // but just in case we proxy it to the stream in use.
        body.on('error', /* istanbul ignore next */ er => decoder.emit('error', er)).pipe(decoder)
        response = new Response(decoder, responseOptions)
        resolve(response)
        return
      }

      // otherwise, use response as-is
      response = new Response(body, responseOptions)
      resolve(response)
    })

    writeToStream(req, request)
  })
}

module.exports = fetch

fetch.isRedirect = code =>
  code === 301 ||
  code === 302 ||
  code === 303 ||
  code === 307 ||
  code === 308

fetch.Headers = Headers
fetch.Request = Request
fetch.Response = Response
fetch.FetchError = FetchError

}, function(modId) {var map = {"./body.js":1775127000620,"./response.js":1775127000623,"./headers.js":1775127000624,"./request.js":1775127000625,"./fetch-error.js":1775127000622,"./abort-error.js":1775127000627}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000620, function(require, module, exports) {

const Minipass = require('minipass')
const MinipassSized = require('minipass-sized')

const Blob = require('./blob.js')
const {BUFFER} = Blob
const FetchError = require('./fetch-error.js')

// optional dependency on 'encoding'
let convert
try {
  convert = require('encoding').convert
} catch (e) {}

const INTERNALS = Symbol('Body internals')
const CONSUME_BODY = Symbol('consumeBody')

class Body {
  constructor (bodyArg, options = {}) {
    const { size = 0, timeout = 0 } = options
    const body = bodyArg === undefined || bodyArg === null ? null
      : isURLSearchParams(bodyArg) ? Buffer.from(bodyArg.toString())
      : isBlob(bodyArg) ? bodyArg
      : Buffer.isBuffer(bodyArg) ? bodyArg
      : Object.prototype.toString.call(bodyArg) === '[object ArrayBuffer]'
        ? Buffer.from(bodyArg)
      : ArrayBuffer.isView(bodyArg)
        ? Buffer.from(bodyArg.buffer, bodyArg.byteOffset, bodyArg.byteLength)
      : Minipass.isStream(bodyArg) ? bodyArg
      : Buffer.from(String(bodyArg))

    this[INTERNALS] = {
      body,
      disturbed: false,
      error: null,
    }

    this.size = size
    this.timeout = timeout

    if (Minipass.isStream(body)) {
      body.on('error', er => {
        const error = er.name === 'AbortError' ? er
          : new FetchError(`Invalid response while trying to fetch ${
            this.url}: ${er.message}`, 'system', er)
        this[INTERNALS].error = error
      })
    }
  }

  get body () {
    return this[INTERNALS].body
  }

  get bodyUsed () {
    return this[INTERNALS].disturbed
  }

  arrayBuffer () {
    return this[CONSUME_BODY]().then(buf =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  }

  blob () {
    const ct = this.headers && this.headers.get('content-type') || ''
    return this[CONSUME_BODY]().then(buf => Object.assign(
      new Blob([], { type: ct.toLowerCase() }),
      { [BUFFER]: buf }
    ))
  }

  json () {
    return this[CONSUME_BODY]().then(buf => {
      try {
        return JSON.parse(buf.toString())
      } catch (er) {
        return Promise.reject(new FetchError(
          `invalid json response body at ${
            this.url} reason: ${er.message}`, 'invalid-json'))
      }
    })
  }

  text () {
    return this[CONSUME_BODY]().then(buf => buf.toString())
  }

  buffer () {
    return this[CONSUME_BODY]()
  }

  textConverted () {
    return this[CONSUME_BODY]().then(buf => convertBody(buf, this.headers))
  }

  [CONSUME_BODY] () {
    if (this[INTERNALS].disturbed)
      return Promise.reject(new TypeError(`body used already for: ${
        this.url}`))

    this[INTERNALS].disturbed = true

    if (this[INTERNALS].error)
      return Promise.reject(this[INTERNALS].error)

    // body is null
    if (this.body === null) {
      return Promise.resolve(Buffer.alloc(0))
    }

    if (Buffer.isBuffer(this.body))
      return Promise.resolve(this.body)

    const upstream = isBlob(this.body) ? this.body.stream() : this.body

    /* istanbul ignore if: should never happen */
    if (!Minipass.isStream(upstream))
      return Promise.resolve(Buffer.alloc(0))

    const stream = this.size && upstream instanceof MinipassSized ? upstream
      : !this.size && upstream instanceof Minipass &&
        !(upstream instanceof MinipassSized) ? upstream
      : this.size ? new MinipassSized({ size: this.size })
      : new Minipass()

    // allow timeout on slow response body
    const resTimeout = this.timeout ? setTimeout(() => {
      stream.emit('error', new FetchError(
        `Response timeout while trying to fetch ${
          this.url} (over ${this.timeout}ms)`, 'body-timeout'))
    }, this.timeout) : null

    // do not keep the process open just for this timeout, even
    // though we expect it'll get cleared eventually.
    if (resTimeout) {
      resTimeout.unref()
    }

    // do the pipe in the promise, because the pipe() can send too much
    // data through right away and upset the MP Sized object
    return new Promise((resolve, reject) => {
      // if the stream is some other kind of stream, then pipe through a MP
      // so we can collect it more easily.
      if (stream !== upstream) {
        upstream.on('error', er => stream.emit('error', er))
        upstream.pipe(stream)
      }
      resolve()
    }).then(() => stream.concat()).then(buf => {
      clearTimeout(resTimeout)
      return buf
    }).catch(er => {
      clearTimeout(resTimeout)
      // request was aborted, reject with this Error
      if (er.name === 'AbortError' || er.name === 'FetchError')
        throw er
      else if (er.name === 'RangeError')
        throw new FetchError(`Could not create Buffer from response body for ${
          this.url}: ${er.message}`, 'system', er)
      else
        // other errors, such as incorrect content-encoding or content-length
        throw new FetchError(`Invalid response body while trying to fetch ${
          this.url}: ${er.message}`, 'system', er)
    })
  }

  static clone (instance) {
    if (instance.bodyUsed)
      throw new Error('cannot clone body after it is used')

    const body = instance.body

    // check that body is a stream and not form-data object
    // NB: can't clone the form-data object without having it as a dependency
    if (Minipass.isStream(body) && typeof body.getBoundary !== 'function') {
      // create a dedicated tee stream so that we don't lose data
      // potentially sitting in the body stream's buffer by writing it
      // immediately to p1 and not having it for p2.
      const tee = new Minipass()
      const p1 = new Minipass()
      const p2 = new Minipass()
      tee.on('error', er => {
        p1.emit('error', er)
        p2.emit('error', er)
      })
      body.on('error', er => tee.emit('error', er))
      tee.pipe(p1)
      tee.pipe(p2)
      body.pipe(tee)
      // set instance body to one fork, return the other
      instance[INTERNALS].body = p1
      return p2
    } else
      return instance.body
  }

  static extractContentType (body) {
    return body === null || body === undefined ? null
      : typeof body === 'string' ? 'text/plain;charset=UTF-8'
      : isURLSearchParams(body)
        ? 'application/x-www-form-urlencoded;charset=UTF-8'
      : isBlob(body) ? body.type || null
      : Buffer.isBuffer(body) ? null
      : Object.prototype.toString.call(body) === '[object ArrayBuffer]' ? null
      : ArrayBuffer.isView(body) ? null
      : typeof body.getBoundary === 'function'
        ? `multipart/form-data;boundary=${body.getBoundary()}`
      : Minipass.isStream(body) ? null
      : 'text/plain;charset=UTF-8'
  }

  static getTotalBytes (instance) {
    const {body} = instance
    return (body === null || body === undefined) ? 0
    : isBlob(body) ? body.size
    : Buffer.isBuffer(body) ? body.length
    : body && typeof body.getLengthSync === 'function' && (
        // detect form data input from form-data module
        body._lengthRetrievers &&
        /* istanbul ignore next */ body._lengthRetrievers.length == 0 || // 1.x
        body.hasKnownLength && body.hasKnownLength()) // 2.x
      ? body.getLengthSync()
    : null
  }

  static writeToStream (dest, instance) {
    const {body} = instance

    if (body === null || body === undefined)
      dest.end()
    else if (Buffer.isBuffer(body) || typeof body === 'string')
      dest.end(body)
    else {
      // body is stream or blob
      const stream = isBlob(body) ? body.stream() : body
      stream.on('error', er => dest.emit('error', er)).pipe(dest)
    }

    return dest
  }
}

Object.defineProperties(Body.prototype, {
  body: { enumerable: true },
  bodyUsed: { enumerable: true },
  arrayBuffer: { enumerable: true },
  blob: { enumerable: true },
  json: { enumerable: true },
  text: { enumerable: true }
})


const isURLSearchParams = obj =>
  // Duck-typing as a necessary condition.
  (typeof obj !== 'object' ||
    typeof obj.append !== 'function' ||
    typeof obj.delete !== 'function' ||
    typeof obj.get !== 'function' ||
    typeof obj.getAll !== 'function' ||
    typeof obj.has !== 'function' ||
    typeof obj.set !== 'function') ? false
  // Brand-checking and more duck-typing as optional condition.
  : obj.constructor.name === 'URLSearchParams' ||
    Object.prototype.toString.call(obj) === '[object URLSearchParams]' ||
    typeof obj.sort === 'function'

const isBlob = obj =>
  typeof obj === 'object' &&
  typeof obj.arrayBuffer === 'function' &&
  typeof obj.type === 'string' &&
  typeof obj.stream === 'function' &&
  typeof obj.constructor === 'function' &&
  typeof obj.constructor.name === 'string' &&
  /^(Blob|File)$/.test(obj.constructor.name) &&
  /^(Blob|File)$/.test(obj[Symbol.toStringTag])


const convertBody = (buffer, headers) => {
  /* istanbul ignore if */
  if (typeof convert !== 'function')
    throw new Error('The package `encoding` must be installed to use the textConverted() function')

  const ct = headers && headers.get('content-type')
  let charset = 'utf-8'
  let res, str

  // header
  if (ct)
    res = /charset=([^;]*)/i.exec(ct)

  // no charset in content type, peek at response body for at most 1024 bytes
  str = buffer.slice(0, 1024).toString()

  // html5
  if (!res && str)
    res = /<meta.+?charset=(['"])(.+?)\1/i.exec(str)

  // html4
  if (!res && str) {
    res = /<meta[\s]+?http-equiv=(['"])content-type\1[\s]+?content=(['"])(.+?)\2/i.exec(str)

    if (!res) {
      res = /<meta[\s]+?content=(['"])(.+?)\1[\s]+?http-equiv=(['"])content-type\3/i.exec(str)
      if (res)
        res.pop() // drop last quote
    }

    if (res)
      res = /charset=(.*)/i.exec(res.pop())
  }

  // xml
  if (!res && str)
    res = /<\?xml.+?encoding=(['"])(.+?)\1/i.exec(str)

  // found charset
  if (res) {
    charset = res.pop()

    // prevent decode issues when sites use incorrect encoding
    // ref: https://hsivonen.fi/encoding-menu/
    if (charset === 'gb2312' || charset === 'gbk')
      charset = 'gb18030'
  }

  // turn raw buffers into a single utf-8 buffer
  return convert(
    buffer,
    'UTF-8',
    charset
  ).toString()
}

module.exports = Body

}, function(modId) { var map = {"./blob.js":1775127000621,"./fetch-error.js":1775127000622}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000621, function(require, module, exports) {

const Minipass = require('minipass')
const TYPE = Symbol('type')
const BUFFER = Symbol('buffer')

class Blob {
  constructor (blobParts, options) {
    this[TYPE] = ''

    const buffers = []
    let size = 0

    if (blobParts) {
      const a = blobParts
      const length = Number(a.length)
      for (let i = 0; i < length; i++) {
        const element = a[i]
        const buffer = element instanceof Buffer ? element
          : ArrayBuffer.isView(element)
            ? Buffer.from(element.buffer, element.byteOffset, element.byteLength)
          : element instanceof ArrayBuffer ? Buffer.from(element)
          : element instanceof Blob ? element[BUFFER]
          : typeof element === 'string' ? Buffer.from(element)
          : Buffer.from(String(element))
        size += buffer.length
        buffers.push(buffer)
      }
    }

    this[BUFFER] = Buffer.concat(buffers, size)

    const type = options && options.type !== undefined
      && String(options.type).toLowerCase()
    if (type && !/[^\u0020-\u007E]/.test(type)) {
      this[TYPE] = type
    }
  }

  get size () {
    return this[BUFFER].length
  }

  get type () {
    return this[TYPE]
  }

  text () {
    return Promise.resolve(this[BUFFER].toString())
  }

  arrayBuffer () {
    const buf = this[BUFFER]
    const off = buf.byteOffset
    const len = buf.byteLength
    const ab = buf.buffer.slice(off, off + len)
    return Promise.resolve(ab)
  }

  stream () {
    return new Minipass().end(this[BUFFER])
  }

  slice (start, end, type) {
    const size = this.size
    const relativeStart = start === undefined ? 0
      : start < 0 ? Math.max(size + start, 0)
      : Math.min(start, size)
    const relativeEnd = end === undefined ? size
      : end < 0 ? Math.max(size + end, 0)
      : Math.min(end, size)
    const span = Math.max(relativeEnd - relativeStart, 0)

    const buffer = this[BUFFER]
    const slicedBuffer = buffer.slice(
      relativeStart,
      relativeStart + span
    )
    const blob = new Blob([], { type })
    blob[BUFFER] = slicedBuffer
    return blob
  }

  get [Symbol.toStringTag] () {
    return 'Blob'
  }

  static get BUFFER () {
    return BUFFER
  }
}

Object.defineProperties(Blob.prototype, {
  size: { enumerable: true },
  type: { enumerable: true },
})

module.exports = Blob

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000622, function(require, module, exports) {

class FetchError extends Error {
  constructor (message, type, systemError) {
    super(message)
    this.code = 'FETCH_ERROR'

    // pick up code, expected, path, ...
    if (systemError)
      Object.assign(this, systemError)

    this.errno = this.code

    // override anything the system error might've clobbered
    this.type = this.code === 'EBADSIZE' && this.found > this.expect
      ? 'max-size' : type
    this.message = message
    Error.captureStackTrace(this, this.constructor)
  }

  get name () {
    return 'FetchError'
  }

  // don't allow name to be overwritten
  set name (n) {}

  get [Symbol.toStringTag] () {
    return 'FetchError'
  }
}
module.exports = FetchError

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000623, function(require, module, exports) {

const http = require('http')
const { STATUS_CODES } = http

const Headers = require('./headers.js')
const Body = require('./body.js')
const { clone, extractContentType } = Body

const INTERNALS = Symbol('Response internals')

class Response extends Body {
  constructor (body = null, opts = {}) {
    super(body, opts)

    const status = opts.status || 200
    const headers = new Headers(opts.headers)

    if (body !== null && body !== undefined && !headers.has('Content-Type')) {
      const contentType = extractContentType(body)
      if (contentType)
        headers.append('Content-Type', contentType)
    }

    this[INTERNALS] = {
      url: opts.url,
      status,
      statusText: opts.statusText || STATUS_CODES[status],
      headers,
      counter: opts.counter,
      trailer: Promise.resolve(opts.trailer || new Headers()),
    }
  }

  get trailer () {
    return this[INTERNALS].trailer
  }

  get url () {
    return this[INTERNALS].url || ''
  }

  get status () {
    return this[INTERNALS].status
  }

  get ok ()  {
    return this[INTERNALS].status >= 200 && this[INTERNALS].status < 300
  }

  get redirected () {
    return this[INTERNALS].counter > 0
  }

  get statusText () {
    return this[INTERNALS].statusText
  }

  get headers () {
    return this[INTERNALS].headers
  }

  clone () {
    return new Response(clone(this), {
      url: this.url,
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
      ok: this.ok,
      redirected: this.redirected,
      trailer: this.trailer,
    })
  }

  get [Symbol.toStringTag] () {
    return 'Response'
  }
}

module.exports = Response

Object.defineProperties(Response.prototype, {
  url: { enumerable: true },
  status: { enumerable: true },
  ok: { enumerable: true },
  redirected: { enumerable: true },
  statusText: { enumerable: true },
  headers: { enumerable: true },
  clone: { enumerable: true },
})

}, function(modId) { var map = {"./headers.js":1775127000624,"./body.js":1775127000620}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000624, function(require, module, exports) {

const invalidTokenRegex = /[^\^_`a-zA-Z\-0-9!#$%&'*+.|~]/
const invalidHeaderCharRegex = /[^\t\x20-\x7e\x80-\xff]/

const validateName = name => {
  name = `${name}`
  if (invalidTokenRegex.test(name) || name === '')
    throw new TypeError(`${name} is not a legal HTTP header name`)
}

const validateValue = value => {
  value = `${value}`
  if (invalidHeaderCharRegex.test(value))
    throw new TypeError(`${value} is not a legal HTTP header value`)
}

const find = (map, name) => {
  name = name.toLowerCase()
  for (const key in map) {
    if (key.toLowerCase() === name)
      return key
  }
  return undefined
}

const MAP = Symbol('map')
class Headers {
  constructor (init = undefined) {
    this[MAP] = Object.create(null)
    if (init instanceof Headers) {
      const rawHeaders = init.raw()
      const headerNames = Object.keys(rawHeaders)
      for (const headerName of headerNames) {
        for (const value of rawHeaders[headerName]) {
          this.append(headerName, value)
        }
      }
      return
    }

    // no-op
    if (init === undefined || init === null)
      return

    if (typeof init === 'object') {
      const method = init[Symbol.iterator]
      if (method !== null && method !== undefined) {
        if (typeof method !== 'function')
          throw new TypeError('Header pairs must be iterable')

        // sequence<sequence<ByteString>>
        // Note: per spec we have to first exhaust the lists then process them
        const pairs = []
        for (const pair of init) {
          if (typeof pair !== 'object' ||
              typeof pair[Symbol.iterator] !== 'function')
            throw new TypeError('Each header pair must be iterable')
          const arrPair = Array.from(pair)
          if (arrPair.length !== 2)
            throw new TypeError('Each header pair must be a name/value tuple')
          pairs.push(arrPair)
        }

        for (const pair of pairs) {
          this.append(pair[0], pair[1])
        }
      } else {
        // record<ByteString, ByteString>
        for (const key of Object.keys(init)) {
          this.append(key, init[key])
        }
      }
    } else
      throw new TypeError('Provided initializer must be an object')
  }

  get (name) {
    name = `${name}`
    validateName(name)
    const key = find(this[MAP], name)
    if (key === undefined)
      return null

    return this[MAP][key].join(', ')
  }

  forEach (callback, thisArg = undefined) {
    let pairs = getHeaders(this)
    for (let i = 0; i < pairs.length; i++) {
      const [name, value] = pairs[i]
      callback.call(thisArg, value, name, this)
      // refresh in case the callback added more headers
      pairs = getHeaders(this)
    }
  }

  set (name, value) {
    name = `${name}`
    value = `${value}`
    validateName(name)
    validateValue(value)
    const key = find(this[MAP], name)
    this[MAP][key !== undefined ? key : name] = [value]
  }

  append (name, value) {
    name = `${name}`
    value = `${value}`
    validateName(name)
    validateValue(value)
    const key = find(this[MAP], name)
    if (key !== undefined)
      this[MAP][key].push(value)
    else
      this[MAP][name] = [value]
  }

  has (name) {
    name = `${name}`
    validateName(name)
    return find(this[MAP], name) !== undefined
  }

  delete (name) {
    name = `${name}`
    validateName(name)
    const key = find(this[MAP], name)
    if (key !== undefined)
      delete this[MAP][key]
  }

  raw () {
    return this[MAP]
  }

  keys () {
    return new HeadersIterator(this, 'key')
  }

  values () {
    return new HeadersIterator(this, 'value')
  }

  [Symbol.iterator]() {
    return new HeadersIterator(this, 'key+value')
  }

  entries () {
    return new HeadersIterator(this, 'key+value')
  }

  get [Symbol.toStringTag] () {
    return 'Headers'
  }

  static exportNodeCompatibleHeaders (headers) {
    const obj = Object.assign(Object.create(null), headers[MAP])

    // http.request() only supports string as Host header. This hack makes
    // specifying custom Host header possible.
    const hostHeaderKey = find(headers[MAP], 'Host')
    if (hostHeaderKey !== undefined)
      obj[hostHeaderKey] = obj[hostHeaderKey][0]

    return obj
  }

  static createHeadersLenient (obj) {
    const headers = new Headers()
    for (const name of Object.keys(obj)) {
      if (invalidTokenRegex.test(name))
        continue

      if (Array.isArray(obj[name])) {
        for (const val of obj[name]) {
          if (invalidHeaderCharRegex.test(val))
            continue

          if (headers[MAP][name] === undefined)
            headers[MAP][name] = [val]
          else
            headers[MAP][name].push(val)
        }
      } else if (!invalidHeaderCharRegex.test(obj[name]))
        headers[MAP][name] = [obj[name]]
    }
    return headers
  }
}

Object.defineProperties(Headers.prototype, {
  get: { enumerable: true },
  forEach: { enumerable: true },
  set: { enumerable: true },
  append: { enumerable: true },
  has: { enumerable: true },
  delete: { enumerable: true },
  keys: { enumerable: true },
  values: { enumerable: true },
  entries: { enumerable: true },
})

const getHeaders = (headers, kind = 'key+value') =>
  Object.keys(headers[MAP]).sort().map(
    kind === 'key' ? k => k.toLowerCase()
    : kind === 'value' ? k => headers[MAP][k].join(', ')
    : k => [k.toLowerCase(), headers[MAP][k].join(', ')]
  )

const INTERNAL = Symbol('internal')

class HeadersIterator {
  constructor (target, kind) {
    this[INTERNAL] = {
      target,
      kind,
      index: 0,
    }
  }

  get [Symbol.toStringTag] () {
    return 'HeadersIterator'
  }

  next () {
    /* istanbul ignore if: should be impossible */
    if (!this || Object.getPrototypeOf(this) !== HeadersIterator.prototype)
      throw new TypeError('Value of `this` is not a HeadersIterator')

    const { target, kind, index } = this[INTERNAL]
    const values = getHeaders(target, kind)
    const len = values.length
    if (index >= len) {
      return {
        value: undefined,
        done: true,
      }
    }

    this[INTERNAL].index++

    return { value: values[index], done: false }
  }
}

// manually extend because 'extends' requires a ctor
Object.setPrototypeOf(HeadersIterator.prototype,
  Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())))

module.exports = Headers

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000625, function(require, module, exports) {

const Url = require('url')
const Minipass = require('minipass')
const Headers = require('./headers.js')
const { exportNodeCompatibleHeaders } = Headers
const Body = require('./body.js')
const { clone, extractContentType, getTotalBytes } = Body

const version = require('../package.json').version
const defaultUserAgent =
  `minipass-fetch/${version} (+https://github.com/isaacs/minipass-fetch)`

const INTERNALS = Symbol('Request internals')

const { parse: parseUrl, format: formatUrl } = Url

const isRequest = input =>
  typeof input === 'object' && typeof input[INTERNALS] === 'object'

const isAbortSignal = signal => {
  const proto = (
    signal
    && typeof signal === 'object'
    && Object.getPrototypeOf(signal)
  )
  return !!(proto && proto.constructor.name === 'AbortSignal')
}

class Request extends Body {
  constructor (input, init = {}) {
    const parsedURL = isRequest(input) ? Url.parse(input.url)
      : input && input.href ? Url.parse(input.href)
      : Url.parse(`${input}`)

    if (isRequest(input))
      init = { ...input[INTERNALS], ...init }
    else if (!input || typeof input === 'string')
      input = {}

    const method = (init.method || input.method || 'GET').toUpperCase()
    const isGETHEAD = method === 'GET' || method === 'HEAD'

    if ((init.body !== null && init.body !== undefined ||
        isRequest(input) && input.body !== null) && isGETHEAD)
      throw new TypeError('Request with GET/HEAD method cannot have body')

    const inputBody = init.body !== null && init.body !== undefined ? init.body
      : isRequest(input) && input.body !== null ? clone(input)
      : null

    super(inputBody, {
      timeout: init.timeout || input.timeout || 0,
      size: init.size || input.size || 0,
    })

    const headers = new Headers(init.headers || input.headers || {})

    if (inputBody !== null && inputBody !== undefined &&
        !headers.has('Content-Type')) {
      const contentType = extractContentType(inputBody)
      if (contentType)
        headers.append('Content-Type', contentType)
    }

    const signal = 'signal' in init ? init.signal
      : null

    if (signal !== null && signal !== undefined && !isAbortSignal(signal))
      throw new TypeError('Expected signal must be an instanceof AbortSignal')

    // TLS specific options that are handled by node
    const {
      ca,
      cert,
      ciphers,
      clientCertEngine,
      crl,
      dhparam,
      ecdhCurve,
      family,
      honorCipherOrder,
      key,
      passphrase,
      pfx,
      rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
      secureOptions,
      secureProtocol,
      servername,
      sessionIdContext,
    } = init

    this[INTERNALS] = {
      method,
      redirect: init.redirect || input.redirect || 'follow',
      headers,
      parsedURL,
      signal,
      ca,
      cert,
      ciphers,
      clientCertEngine,
      crl,
      dhparam,
      ecdhCurve,
      family,
      honorCipherOrder,
      key,
      passphrase,
      pfx,
      rejectUnauthorized,
      secureOptions,
      secureProtocol,
      servername,
      sessionIdContext,
    }

    // node-fetch-only options
    this.follow = init.follow !== undefined ? init.follow
      : input.follow !== undefined ? input.follow
      : 20
    this.compress = init.compress !== undefined ? init.compress
      : input.compress !== undefined ? input.compress
      : true
    this.counter = init.counter || input.counter || 0
    this.agent = init.agent || input.agent
  }

  get method() {
    return this[INTERNALS].method
  }

  get url() {
    return formatUrl(this[INTERNALS].parsedURL)
  }

  get headers() {
    return this[INTERNALS].headers
  }

  get redirect() {
    return this[INTERNALS].redirect
  }

  get signal() {
    return this[INTERNALS].signal
  }

  clone () {
    return new Request(this)
  }

  get [Symbol.toStringTag] () {
    return 'Request'
  }

  static getNodeRequestOptions (request) {
    const parsedURL = request[INTERNALS].parsedURL
    const headers = new Headers(request[INTERNALS].headers)

    // fetch step 1.3
    if (!headers.has('Accept'))
      headers.set('Accept', '*/*')

    // Basic fetch
    if (!parsedURL.protocol || !parsedURL.hostname)
      throw new TypeError('Only absolute URLs are supported')

    if (!/^https?:$/.test(parsedURL.protocol))
      throw new TypeError('Only HTTP(S) protocols are supported')

    if (request.signal &&
        Minipass.isStream(request.body) &&
        typeof request.body.destroy !== 'function') {
      throw new Error(
        'Cancellation of streamed requests with AbortSignal is not supported')
    }

    // HTTP-network-or-cache fetch steps 2.4-2.7
    const contentLengthValue =
      (request.body === null || request.body === undefined) &&
        /^(POST|PUT)$/i.test(request.method) ? '0'
      : request.body !== null && request.body !== undefined
        ? getTotalBytes(request)
      : null

    if (contentLengthValue)
      headers.set('Content-Length', contentLengthValue + '')

    // HTTP-network-or-cache fetch step 2.11
    if (!headers.has('User-Agent'))
      headers.set('User-Agent', defaultUserAgent)

    // HTTP-network-or-cache fetch step 2.15
    if (request.compress && !headers.has('Accept-Encoding'))
      headers.set('Accept-Encoding', 'gzip,deflate')

    const agent = typeof request.agent === 'function'
      ? request.agent(parsedURL)
      : request.agent

    if (!headers.has('Connection') && !agent)
      headers.set('Connection', 'close')

    // TLS specific options that are handled by node
    const {
      ca,
      cert,
      ciphers,
      clientCertEngine,
      crl,
      dhparam,
      ecdhCurve,
      family,
      honorCipherOrder,
      key,
      passphrase,
      pfx,
      rejectUnauthorized,
      secureOptions,
      secureProtocol,
      servername,
      sessionIdContext,
    } = request[INTERNALS]

    // HTTP-network fetch step 4.2
    // chunked encoding is handled by Node.js

    return {
      ...parsedURL,
      method: request.method,
      headers: exportNodeCompatibleHeaders(headers),
      agent,
      ca,
      cert,
      ciphers,
      clientCertEngine,
      crl,
      dhparam,
      ecdhCurve,
      family,
      honorCipherOrder,
      key,
      passphrase,
      pfx,
      rejectUnauthorized,
      secureOptions,
      secureProtocol,
      servername,
      sessionIdContext,
    }
  }
}

module.exports = Request

Object.defineProperties(Request.prototype, {
  method: { enumerable: true },
  url: { enumerable: true },
  headers: { enumerable: true },
  redirect: { enumerable: true },
  clone: { enumerable: true },
  signal: { enumerable: true },
})

}, function(modId) { var map = {"./headers.js":1775127000624,"./body.js":1775127000620,"../package.json":1775127000626}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000626, function(require, module, exports) {
module.exports = {
  "name": "minipass-fetch",
  "version": "1.4.1",
  "description": "An implementation of window.fetch in Node.js using Minipass streams",
  "license": "MIT",
  "main": "lib/index.js",
  "scripts": {
    "test": "tap",
    "snap": "tap",
    "preversion": "npm test",
    "postversion": "npm publish",
    "postpublish": "git push origin --follow-tags"
  },
  "tap": {
    "coverage-map": "map.js",
    "check-coverage": true
  },
  "devDependencies": {
    "@ungap/url-search-params": "^0.1.2",
    "abort-controller": "^3.0.0",
    "abortcontroller-polyfill": "~1.3.0",
    "form-data": "^2.5.1",
    "parted": "^0.1.1",
    "string-to-arraybuffer": "^1.0.2",
    "tap": "^15.0.9",
    "whatwg-url": "^7.0.0"
  },
  "dependencies": {
    "minipass": "^3.1.0",
    "minipass-sized": "^1.0.3",
    "minizlib": "^2.0.0"
  },
  "optionalDependencies": {
    "encoding": "^0.1.12"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/npm/minipass-fetch.git"
  },
  "keywords": [
    "fetch",
    "minipass",
    "node-fetch",
    "window.fetch"
  ],
  "files": [
    "index.js",
    "lib/*.js"
  ],
  "engines": {
    "node": ">=8"
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000627, function(require, module, exports) {

class AbortError extends Error {
  constructor (message) {
    super(message)
    this.code = 'FETCH_ABORTED'
    this.type = 'aborted'
    Error.captureStackTrace(this, this.constructor)
  }

  get name () {
    return 'AbortError'
  }

  // don't allow name to be overridden, but don't throw either
  set name (s) {}
}
module.exports = AbortError

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1775127000619);
})()
//miniprogram-npm-outsideDeps=["url","http","https","minizlib","minipass","minipass-sized","encoding"]
//# sourceMappingURL=index.js.map