module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1775127000597, function(require, module, exports) {
const { FetchError, Headers, Request, Response } = require('minipass-fetch')

const configureOptions = require('./options.js')
const fetch = require('./fetch.js')

const makeFetchHappen = (url, opts) => {
  const options = configureOptions(opts)

  const request = new Request(url, options)
  return fetch(request, options)
}

makeFetchHappen.defaults = (defaultUrl, defaultOptions = {}) => {
  if (typeof defaultUrl === 'object') {
    defaultOptions = defaultUrl
    defaultUrl = null
  }

  const defaultedFetch = (url, options = {}) => {
    const finalUrl = url || defaultUrl
    const finalOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers,
      },
    }
    return makeFetchHappen(finalUrl, finalOptions)
  }

  defaultedFetch.defaults = makeFetchHappen.defaults
  return defaultedFetch
}

module.exports = makeFetchHappen
module.exports.FetchError = FetchError
module.exports.Headers = Headers
module.exports.Request = Request
module.exports.Response = Response

}, function(modId) {var map = {"./options.js":1775127000598,"./fetch.js":1775127000599}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000598, function(require, module, exports) {
const conditionalHeaders = [
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
  'if-match',
  'if-range',
]

const configureOptions = (opts) => {
  const {strictSSL, ...options} = { ...opts }
  options.method = options.method ? options.method.toUpperCase() : 'GET'
  options.rejectUnauthorized = strictSSL !== false

  if (!options.retry)
    options.retry = { retries: 0 }
  else if (typeof options.retry === 'string') {
    const retries = parseInt(options.retry, 10)
    if (isFinite(retries))
      options.retry = { retries }
    else
      options.retry = { retries: 0 }
  } else if (typeof options.retry === 'number')
    options.retry = { retries: options.retry }
  else
    options.retry = { retries: 0, ...options.retry }

  options.cache = options.cache || 'default'
  if (options.cache === 'default') {
    const hasConditionalHeader = Object.keys(options.headers || {}).some((name) => {
      return conditionalHeaders.includes(name.toLowerCase())
    })
    if (hasConditionalHeader)
      options.cache = 'no-store'
  }

  // cacheManager is deprecated, but if it's set and
  // cachePath is not we should copy it to the new field
  if (options.cacheManager && !options.cachePath)
    options.cachePath = options.cacheManager

  return options
}

module.exports = configureOptions

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000599, function(require, module, exports) {


const { FetchError, Request, isRedirect } = require('minipass-fetch')
const url = require('url')

const CachePolicy = require('./cache/policy.js')
const cache = require('./cache/index.js')
const remote = require('./remote.js')

// given a Request, a Response and user options
// return true if the response is a redirect that
// can be followed. we throw errors that will result
// in the fetch being rejected if the redirect is
// possible but invalid for some reason
const canFollowRedirect = (request, response, options) => {
  if (!isRedirect(response.status))
    return false

  if (options.redirect === 'manual')
    return false

  if (options.redirect === 'error')
    throw new FetchError(`redirect mode is set to error: ${request.url}`, 'no-redirect', { code: 'ENOREDIRECT' })

  if (!response.headers.has('location'))
    throw new FetchError(`redirect location header missing for: ${request.url}`, 'no-location', { code: 'EINVALIDREDIRECT' })

  if (request.counter >= request.follow)
    throw new FetchError(`maximum redirect reached at: ${request.url}`, 'max-redirect', { code: 'EMAXREDIRECT' })

  return true
}

// given a Request, a Response, and the user's options return an object
// with a new Request and a new options object that will be used for
// following the redirect
const getRedirect = (request, response, options) => {
  const _opts = { ...options }
  const location = response.headers.get('location')
  const redirectUrl = new url.URL(location, /^https?:/.test(location) ? undefined : request.url)
  // Comment below is used under the following license:
  // Copyright (c) 2010-2012 Mikeal Rogers
  // Licensed under the Apache License, Version 2.0 (the "License");
  // you may not use this file except in compliance with the License.
  // You may obtain a copy of the License at
  // http://www.apache.org/licenses/LICENSE-2.0
  // Unless required by applicable law or agreed to in writing,
  // software distributed under the License is distributed on an "AS
  // IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
  // express or implied. See the License for the specific language
  // governing permissions and limitations under the License.

  // Remove authorization if changing hostnames (but not if just
  // changing ports or protocols).  This matches the behavior of request:
  // https://github.com/request/request/blob/b12a6245/lib/redirect.js#L134-L138
  if (new url.URL(request.url).hostname !== redirectUrl.hostname)
    request.headers.delete('authorization')

  // for POST request with 301/302 response, or any request with 303 response,
  // use GET when following redirect
  if (response.status === 303 || (request.method === 'POST' && [301, 302].includes(response.status))) {
    _opts.method = 'GET'
    _opts.body = null
    request.headers.delete('content-length')
  }

  _opts.headers = {}
  request.headers.forEach((value, key) => {
    _opts.headers[key] = value
  })

  _opts.counter = ++request.counter
  const redirectReq = new Request(url.format(redirectUrl), _opts)
  return {
    request: redirectReq,
    options: _opts,
  }
}

const fetch = async (request, options) => {
  const response = CachePolicy.storable(request, options)
    ? await cache(request, options)
    : await remote(request, options)

  // if the request wasn't a GET or HEAD, and the response
  // status is between 200 and 399 inclusive, invalidate the
  // request url
  if (!['GET', 'HEAD'].includes(request.method) &&
      response.status >= 200 &&
      response.status <= 399)
    await cache.invalidate(request, options)

  if (!canFollowRedirect(request, response, options))
    return response

  const redirect = getRedirect(request, response, options)
  return fetch(redirect.request, redirect.options)
}

module.exports = fetch

}, function(modId) { var map = {"./cache/policy.js":1775127000600,"./cache/index.js":1775127000601,"./remote.js":1775127000605}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000600, function(require, module, exports) {
const CacheSemantics = require('http-cache-semantics')
const Negotiator = require('negotiator')
const ssri = require('ssri')

// HACK: negotiator lazy loads several of its own modules
// as a micro optimization. we need to be sure that they're
// in memory as soon as possible at startup so that we do
// not try to lazy load them after the directory has been
// retired during a self update of the npm CLI, we do this
// by calling all of the methods that trigger a lazy load
// on a fake instance.
const preloadNegotiator = new Negotiator({ headers: {} })
preloadNegotiator.charsets()
preloadNegotiator.encodings()
preloadNegotiator.languages()
preloadNegotiator.mediaTypes()

// options passed to http-cache-semantics constructor
const policyOptions = {
  shared: false,
  ignoreCargoCult: true,
}

// a fake empty response, used when only testing the
// request for storability
const emptyResponse = { status: 200, headers: {} }

// returns a plain object representation of the Request
const requestObject = (request) => {
  const _obj = {
    method: request.method,
    url: request.url,
    headers: {},
  }

  request.headers.forEach((value, key) => {
    _obj.headers[key] = value
  })

  return _obj
}

// returns a plain object representation of the Response
const responseObject = (response) => {
  const _obj = {
    status: response.status,
    headers: {},
  }

  response.headers.forEach((value, key) => {
    _obj.headers[key] = value
  })

  return _obj
}

class CachePolicy {
  constructor ({ entry, request, response, options }) {
    this.entry = entry
    this.request = requestObject(request)
    this.response = responseObject(response)
    this.options = options
    this.policy = new CacheSemantics(this.request, this.response, policyOptions)

    if (this.entry) {
      // if we have an entry, copy the timestamp to the _responseTime
      // this is necessary because the CacheSemantics constructor forces
      // the value to Date.now() which means a policy created from a
      // cache entry is likely to always identify itself as stale
      this.policy._responseTime = this.entry.metadata.time
    }
  }

  // static method to quickly determine if a request alone is storable
  static storable (request, options) {
    // no cachePath means no caching
    if (!options.cachePath)
      return false

    // user explicitly asked not to cache
    if (options.cache === 'no-store')
      return false

    // we only cache GET and HEAD requests
    if (!['GET', 'HEAD'].includes(request.method))
      return false

    // otherwise, let http-cache-semantics make the decision
    // based on the request's headers
    const policy = new CacheSemantics(requestObject(request), emptyResponse, policyOptions)
    return policy.storable()
  }

  // returns true if the policy satisfies the request
  satisfies (request) {
    const _req = requestObject(request)
    if (this.request.headers.host !== _req.headers.host)
      return false

    const negotiatorA = new Negotiator(this.request)
    const negotiatorB = new Negotiator(_req)

    if (JSON.stringify(negotiatorA.mediaTypes()) !== JSON.stringify(negotiatorB.mediaTypes()))
      return false

    if (JSON.stringify(negotiatorA.languages()) !== JSON.stringify(negotiatorB.languages()))
      return false

    if (JSON.stringify(negotiatorA.encodings()) !== JSON.stringify(negotiatorB.encodings()))
      return false

    if (this.options.integrity)
      return ssri.parse(this.options.integrity).match(this.entry.integrity)

    return true
  }

  // returns true if the request and response allow caching
  storable () {
    return this.policy.storable()
  }

  // NOTE: this is a hack to avoid parsing the cache-control
  // header ourselves, it returns true if the response's
  // cache-control contains must-revalidate
  get mustRevalidate () {
    return !!this.policy._rescc['must-revalidate']
  }

  // returns true if the cached response requires revalidation
  // for the given request
  needsRevalidation (request) {
    const _req = requestObject(request)
    // force method to GET because we only cache GETs
    // but can serve a HEAD from a cached GET
    _req.method = 'GET'
    return !this.policy.satisfiesWithoutRevalidation(_req)
  }

  responseHeaders () {
    return this.policy.responseHeaders()
  }

  // returns a new object containing the appropriate headers
  // to send a revalidation request
  revalidationHeaders (request) {
    const _req = requestObject(request)
    return this.policy.revalidationHeaders(_req)
  }

  // returns true if the request/response was revalidated
  // successfully. returns false if a new response was received
  revalidated (request, response) {
    const _req = requestObject(request)
    const _res = responseObject(response)
    const policy = this.policy.revalidatedPolicy(_req, _res)
    return !policy.modified
  }
}

module.exports = CachePolicy

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000601, function(require, module, exports) {
const { NotCachedError } = require('./errors.js')
const CacheEntry = require('./entry.js')
const remote = require('../remote.js')

// do whatever is necessary to get a Response and return it
const cacheFetch = async (request, options) => {
  // try to find a cached entry that satisfies this request
  const entry = await CacheEntry.find(request, options)
  if (!entry) {
    // no cached result, if the cache mode is 'only-if-cached' that's a failure
    if (options.cache === 'only-if-cached')
      throw new NotCachedError(request.url)

    // otherwise, we make a request, store it and return it
    const response = await remote(request, options)
    const entry = new CacheEntry({ request, response, options })
    return entry.store('miss')
  }

  // we have a cached response that satisfies this request, however if the cache
  // mode is 'no-cache' then we send the revalidation request no matter what
  if (options.cache === 'no-cache')
    return entry.revalidate(request, options)

  // if the cached entry is not stale, or if the cache mode is 'force-cache' or
  // 'only-if-cached' we can respond with the cached entry. set the status
  // based on the result of needsRevalidation and respond
  const _needsRevalidation = entry.policy.needsRevalidation(request)
  if (options.cache === 'force-cache' ||
      options.cache === 'only-if-cached' ||
      !_needsRevalidation)
    return entry.respond(request.method, options, _needsRevalidation ? 'stale' : 'hit')

  // if we got here, the cache entry is stale so revalidate it
  return entry.revalidate(request, options)
}

cacheFetch.invalidate = async (request, options) => {
  if (!options.cachePath)
    return

  return CacheEntry.invalidate(request, options)
}

module.exports = cacheFetch

}, function(modId) { var map = {"./errors.js":1775127000602,"./entry.js":1775127000603,"../remote.js":1775127000605}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000602, function(require, module, exports) {
class NotCachedError extends Error {
  constructor (url) {
    super(`request to ${url} failed: cache mode is 'only-if-cached' but no cached response is available.`)
    this.code = 'ENOTCACHED'
  }
}

module.exports = {
  NotCachedError,
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000603, function(require, module, exports) {
const { Request, Response } = require('minipass-fetch')
const Minipass = require('minipass')
const MinipassCollect = require('minipass-collect')
const MinipassFlush = require('minipass-flush')
const MinipassPipeline = require('minipass-pipeline')
const cacache = require('cacache')
const url = require('url')

const CachePolicy = require('./policy.js')
const cacheKey = require('./key.js')
const remote = require('../remote.js')

const hasOwnProperty = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop)

// maximum amount of data we will buffer into memory
// if we'll exceed this, we switch to streaming
const MAX_MEM_SIZE = 5 * 1024 * 1024 // 5MB

// allow list for request headers that will be written to the cache index
// note: we will also store any request headers
// that are named in a response's vary header
const KEEP_REQUEST_HEADERS = [
  'accept-charset',
  'accept-encoding',
  'accept-language',
  'accept',
  'cache-control',
]

// allow list for response headers that will be written to the cache index
// note: we must not store the real response's age header, or when we load
// a cache policy based on the metadata it will think the cached response
// is always stale
const KEEP_RESPONSE_HEADERS = [
  'cache-control',
  'content-encoding',
  'content-language',
  'content-type',
  'date',
  'etag',
  'expires',
  'last-modified',
  'location',
  'pragma',
  'vary',
]

// return an object containing all metadata to be written to the index
const getMetadata = (request, response, options) => {
  const metadata = {
    time: Date.now(),
    url: request.url,
    reqHeaders: {},
    resHeaders: {},
  }

  // only save the status if it's not a 200 or 304
  if (response.status !== 200 && response.status !== 304)
    metadata.status = response.status

  for (const name of KEEP_REQUEST_HEADERS) {
    if (request.headers.has(name))
      metadata.reqHeaders[name] = request.headers.get(name)
  }

  // if the request's host header differs from the host in the url
  // we need to keep it, otherwise it's just noise and we ignore it
  const host = request.headers.get('host')
  const parsedUrl = new url.URL(request.url)
  if (host && parsedUrl.host !== host)
    metadata.reqHeaders.host = host

  // if the response has a vary header, make sure
  // we store the relevant request headers too
  if (response.headers.has('vary')) {
    const vary = response.headers.get('vary')
    // a vary of "*" means every header causes a different response.
    // in that scenario, we do not include any additional headers
    // as the freshness check will always fail anyway and we don't
    // want to bloat the cache indexes
    if (vary !== '*') {
      // copy any other request headers that will vary the response
      const varyHeaders = vary.trim().toLowerCase().split(/\s*,\s*/)
      for (const name of varyHeaders) {
        // explicitly ignore accept-encoding here
        if (name !== 'accept-encoding' && request.headers.has(name))
          metadata.reqHeaders[name] = request.headers.get(name)
      }
    }
  }

  for (const name of KEEP_RESPONSE_HEADERS) {
    if (response.headers.has(name))
      metadata.resHeaders[name] = response.headers.get(name)
  }

  // we only store accept-encoding and content-encoding if the user
  // has disabled automatic compression and decompression in minipass-fetch
  // since if it's enabled (the default) then the content will have
  // already been decompressed making the header a lie
  if (options.compress === false) {
    metadata.reqHeaders['accept-encoding'] = request.headers.get('accept-encoding')
    metadata.resHeaders['content-encoding'] = response.headers.get('content-encoding')
  }

  return metadata
}

// symbols used to hide objects that may be lazily evaluated in a getter
const _request = Symbol('request')
const _response = Symbol('response')
const _policy = Symbol('policy')

class CacheEntry {
  constructor ({ entry, request, response, options }) {
    if (entry) {
      this.key = entry.key
      this.entry = entry
      // previous versions of this module didn't write an explicit timestamp in
      // the metadata, so fall back to the entry's timestamp. we can't use the
      // entry timestamp to determine staleness because cacache will update it
      // when it verifies its data
      this.entry.metadata.time = this.entry.metadata.time || this.entry.time
    } else
      this.key = cacheKey(request)

    this.options = options

    // these properties are behind getters that lazily evaluate
    this[_request] = request
    this[_response] = response
    this[_policy] = null
  }

  // returns a CacheEntry instance that satisfies the given request
  // or undefined if no existing entry satisfies
  static async find (request, options) {
    try {
      // compacts the index and returns an array of unique entries
      var matches = await cacache.index.compact(options.cachePath, cacheKey(request), (A, B) => {
        const entryA = new CacheEntry({ entry: A, options })
        const entryB = new CacheEntry({ entry: B, options })
        return entryA.policy.satisfies(entryB.request)
      }, {
        validateEntry: (entry) => {
          // if an integrity is null, it needs to have a status specified
          if (entry.integrity === null)
            return !!(entry.metadata && entry.metadata.status)

          return true
        },
      })
    } catch (err) {
      // if the compact request fails, ignore the error and return
      return
    }

    // a cache mode of 'reload' means to behave as though we have no cache
    // on the way to the network. return undefined to allow cacheFetch to
    // create a brand new request no matter what.
    if (options.cache === 'reload')
      return

    // find the specific entry that satisfies the request
    let match
    for (const entry of matches) {
      const _entry = new CacheEntry({
        entry,
        options,
      })

      if (_entry.policy.satisfies(request)) {
        match = _entry
        break
      }
    }

    return match
  }

  // if the user made a PUT/POST/PATCH then we invalidate our
  // cache for the same url by deleting the index entirely
  static async invalidate (request, options) {
    const key = cacheKey(request)
    try {
      await cacache.rm.entry(options.cachePath, key, { removeFully: true })
    } catch (err) {
      // ignore errors
    }
  }

  get request () {
    if (!this[_request]) {
      this[_request] = new Request(this.entry.metadata.url, {
        method: 'GET',
        headers: this.entry.metadata.reqHeaders,
      })
    }

    return this[_request]
  }

  get response () {
    if (!this[_response]) {
      this[_response] = new Response(null, {
        url: this.entry.metadata.url,
        counter: this.options.counter,
        status: this.entry.metadata.status || 200,
        headers: {
          ...this.entry.metadata.resHeaders,
          'content-length': this.entry.size,
        },
      })
    }

    return this[_response]
  }

  get policy () {
    if (!this[_policy]) {
      this[_policy] = new CachePolicy({
        entry: this.entry,
        request: this.request,
        response: this.response,
        options: this.options,
      })
    }

    return this[_policy]
  }

  // wraps the response in a pipeline that stores the data
  // in the cache while the user consumes it
  async store (status) {
    // if we got a status other than 200, 301, or 308,
    // or the CachePolicy forbid storage, append the
    // cache status header and return it untouched
    if (this.request.method !== 'GET' || ![200, 301, 308].includes(this.response.status) || !this.policy.storable()) {
      this.response.headers.set('x-local-cache-status', 'skip')
      return this.response
    }

    const size = this.response.headers.get('content-length')
    const fitsInMemory = !!size && Number(size) < MAX_MEM_SIZE
    const shouldBuffer = this.options.memoize !== false && fitsInMemory
    const cacheOpts = {
      algorithms: this.options.algorithms,
      metadata: getMetadata(this.request, this.response, this.options),
      size,
      memoize: fitsInMemory && this.options.memoize,
    }

    let body = null
    // we only set a body if the status is a 200, redirects are
    // stored as metadata only
    if (this.response.status === 200) {
      let cacheWriteResolve, cacheWriteReject
      const cacheWritePromise = new Promise((resolve, reject) => {
        cacheWriteResolve = resolve
        cacheWriteReject = reject
      })

      body = new MinipassPipeline(new MinipassFlush({
        flush () {
          return cacheWritePromise
        },
      }))

      let abortStream, onResume
      if (shouldBuffer) {
        // if the result fits in memory, use a collect stream to gather
        // the response and write it to cacache while also passing it through
        // to the user
        onResume = () => {
          const collector = new MinipassCollect.PassThrough()
          abortStream = collector
          collector.on('collect', (data) => {
            // TODO if the cache write fails, log a warning but return the response anyway
            cacache.put(this.options.cachePath, this.key, data, cacheOpts).then(cacheWriteResolve, cacheWriteReject)
          })
          body.unshift(collector)
          body.unshift(this.response.body)
        }
      } else {
        // if it does not fit in memory, create a tee stream and use
        // that to pipe to both the cache and the user simultaneously
        onResume = () => {
          const tee = new Minipass()
          const cacheStream = cacache.put.stream(this.options.cachePath, this.key, cacheOpts)
          abortStream = cacheStream
          tee.pipe(cacheStream)
          // TODO if the cache write fails, log a warning but return the response anyway
          cacheStream.promise().then(cacheWriteResolve, cacheWriteReject)
          body.unshift(tee)
          body.unshift(this.response.body)
        }
      }

      body.once('resume', onResume)
      body.once('end', () => body.removeListener('resume', onResume))
      this.response.body.on('error', (err) => {
        // the abortStream will either be a MinipassCollect if we buffer
        // or a cacache write stream, either way be sure to listen for
        // errors from the actual response and avoid writing data that we
        // know to be invalid to the cache
        abortStream.destroy(err)
      })
    } else
      await cacache.index.insert(this.options.cachePath, this.key, null, cacheOpts)

    // note: we do not set the x-local-cache-hash header because we do not know
    // the hash value until after the write to the cache completes, which doesn't
    // happen until after the response has been sent and it's too late to write
    // the header anyway
    this.response.headers.set('x-local-cache', encodeURIComponent(this.options.cachePath))
    this.response.headers.set('x-local-cache-key', encodeURIComponent(this.key))
    this.response.headers.set('x-local-cache-mode', shouldBuffer ? 'buffer' : 'stream')
    this.response.headers.set('x-local-cache-status', status)
    this.response.headers.set('x-local-cache-time', new Date().toISOString())
    const newResponse = new Response(body, {
      url: this.response.url,
      status: this.response.status,
      headers: this.response.headers,
      counter: this.options.counter,
    })
    return newResponse
  }

  // use the cached data to create a response and return it
  async respond (method, options, status) {
    let response
    const size = Number(this.response.headers.get('content-length'))
    const fitsInMemory = !!size && size < MAX_MEM_SIZE
    const shouldBuffer = this.options.memoize !== false && fitsInMemory
    if (method === 'HEAD' || [301, 308].includes(this.response.status)) {
      // if the request is a HEAD, or the response is a redirect,
      // then the metadata in the entry already includes everything
      // we need to build a response
      response = this.response
    } else {
      // we're responding with a full cached response, so create a body
      // that reads from cacache and attach it to a new Response
      const body = new Minipass()
      const removeOnResume = () => body.removeListener('resume', onResume)
      let onResume
      if (shouldBuffer) {
        onResume = async () => {
          removeOnResume()
          try {
            const content = await cacache.get.byDigest(this.options.cachePath, this.entry.integrity, { memoize: this.options.memoize })
            body.end(content)
          } catch (err) {
            if (err.code === 'EINTEGRITY')
              await cacache.rm.content(this.options.cachePath, this.entry.integrity, { memoize: this.options.memoize })
            if (err.code === 'ENOENT' || err.code === 'EINTEGRITY')
              await CacheEntry.invalidate(this.request, this.options)
            body.emit('error', err)
          }
        }
      } else {
        onResume = () => {
          const cacheStream = cacache.get.stream.byDigest(this.options.cachePath, this.entry.integrity, { memoize: this.options.memoize })
          cacheStream.on('error', async (err) => {
            cacheStream.pause()
            if (err.code === 'EINTEGRITY')
              await cacache.rm.content(this.options.cachePath, this.entry.integrity, { memoize: this.options.memoize })
            if (err.code === 'ENOENT' || err.code === 'EINTEGRITY')
              await CacheEntry.invalidate(this.request, this.options)
            body.emit('error', err)
            cacheStream.resume()
          })
          cacheStream.pipe(body)
        }
      }

      body.once('resume', onResume)
      body.once('end', removeOnResume)
      response = new Response(body, {
        url: this.entry.metadata.url,
        counter: options.counter,
        status: 200,
        headers: {
          ...this.policy.responseHeaders(),
        },
      })
    }

    response.headers.set('x-local-cache', encodeURIComponent(this.options.cachePath))
    response.headers.set('x-local-cache-hash', encodeURIComponent(this.entry.integrity))
    response.headers.set('x-local-cache-key', encodeURIComponent(this.key))
    response.headers.set('x-local-cache-mode', shouldBuffer ? 'buffer' : 'stream')
    response.headers.set('x-local-cache-status', status)
    response.headers.set('x-local-cache-time', new Date(this.entry.metadata.time).toUTCString())
    return response
  }

  // use the provided request along with this cache entry to
  // revalidate the stored response. returns a response, either
  // from the cache or from the update
  async revalidate (request, options) {
    const revalidateRequest = new Request(request, {
      headers: this.policy.revalidationHeaders(request),
    })

    try {
      // NOTE: be sure to remove the headers property from the
      // user supplied options, since we have already defined
      // them on the new request object. if they're still in the
      // options then those will overwrite the ones from the policy
      var response = await remote(revalidateRequest, {
        ...options,
        headers: undefined,
      })
    } catch (err) {
      // if the network fetch fails, return the stale
      // cached response unless it has a cache-control
      // of 'must-revalidate'
      if (!this.policy.mustRevalidate)
        return this.respond(request.method, options, 'stale')

      throw err
    }

    if (this.policy.revalidated(revalidateRequest, response)) {
      // we got a 304, write a new index to the cache and respond from cache
      const metadata = getMetadata(request, response, options)
      // 304 responses do not include headers that are specific to the response data
      // since they do not include a body, so we copy values for headers that were
      // in the old cache entry to the new one, if the new metadata does not already
      // include that header
      for (const name of KEEP_RESPONSE_HEADERS) {
        if (!hasOwnProperty(metadata.resHeaders, name) && hasOwnProperty(this.entry.metadata.resHeaders, name))
          metadata.resHeaders[name] = this.entry.metadata.resHeaders[name]
      }

      try {
        await cacache.index.insert(options.cachePath, this.key, this.entry.integrity, {
          size: this.entry.size,
          metadata,
        })
      } catch (err) {
        // if updating the cache index fails, we ignore it and
        // respond anyway
      }
      return this.respond(request.method, options, 'revalidated')
    }

    // if we got a modified response, create a new entry based on it
    const newEntry = new CacheEntry({
      request,
      response,
      options,
    })

    // respond with the new entry while writing it to the cache
    return newEntry.store('updated')
  }
}

module.exports = CacheEntry

}, function(modId) { var map = {"./policy.js":1775127000600,"./key.js":1775127000604,"../remote.js":1775127000605}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000604, function(require, module, exports) {
const { URL, format } = require('url')

// options passed to url.format() when generating a key
const formatOptions = {
  auth: false,
  fragment: false,
  search: true,
  unicode: false,
}

// returns a string to be used as the cache key for the Request
const cacheKey = (request) => {
  const parsed = new URL(request.url)
  return `make-fetch-happen:request-cache:${format(parsed, formatOptions)}`
}

module.exports = cacheKey

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000605, function(require, module, exports) {
const Minipass = require('minipass')
const MinipassPipeline = require('minipass-pipeline')
const fetch = require('minipass-fetch')
const promiseRetry = require('promise-retry')
const ssri = require('ssri')

const getAgent = require('./agent.js')
const pkg = require('../package.json')

const USER_AGENT = `${pkg.name}/${pkg.version} (+https://npm.im/${pkg.name})`

const RETRY_ERRORS = [
  'ECONNRESET', // remote socket closed on us
  'ECONNREFUSED', // remote host refused to open connection
  'EADDRINUSE', // failed to bind to a local port (proxy?)
  'ETIMEDOUT', // someone in the transaction is WAY TOO SLOW
  'ERR_SOCKET_TIMEOUT', // same as above, but this one comes from agentkeepalive
  // Known codes we do NOT retry on:
  // ENOTFOUND (getaddrinfo failure. Either bad hostname, or offline)
]

const RETRY_TYPES = [
  'request-timeout',
]

// make a request directly to the remote source,
// retrying certain classes of errors as well as
// following redirects (through the cache if necessary)
// and verifying response integrity
const remoteFetch = (request, options) => {
  const agent = getAgent(request.url, options)
  if (!request.headers.has('connection'))
    request.headers.set('connection', agent ? 'keep-alive' : 'close')

  if (!request.headers.has('user-agent'))
    request.headers.set('user-agent', USER_AGENT)

  // keep our own options since we're overriding the agent
  // and the redirect mode
  const _opts = {
    ...options,
    agent,
    redirect: 'manual',
  }

  return promiseRetry(async (retryHandler, attemptNum) => {
    const req = new fetch.Request(request, _opts)
    try {
      let res = await fetch(req, _opts)
      if (_opts.integrity && res.status === 200) {
        // we got a 200 response and the user has specified an expected
        // integrity value, so wrap the response in an ssri stream to verify it
        const integrityStream = ssri.integrityStream({ integrity: _opts.integrity })
        res = new fetch.Response(new MinipassPipeline(res.body, integrityStream), res)
      }

      res.headers.set('x-fetch-attempts', attemptNum)

      // do not retry POST requests, or requests with a streaming body
      // do retry requests with a 408, 420, 429 or 500+ status in the response
      const isStream = Minipass.isStream(req.body)
      const isRetriable = req.method !== 'POST' &&
          !isStream &&
          ([408, 420, 429].includes(res.status) || res.status >= 500)

      if (isRetriable) {
        if (typeof options.onRetry === 'function')
          options.onRetry(res)

        return retryHandler(res)
      }

      return res
    } catch (err) {
      const code = (err.code === 'EPROMISERETRY')
        ? err.retried.code
        : err.code

      // err.retried will be the thing that was thrown from above
      // if it's a response, we just got a bad status code and we
      // can re-throw to allow the retry
      const isRetryError = err.retried instanceof fetch.Response ||
        (RETRY_ERRORS.includes(code) && RETRY_TYPES.includes(err.type))

      if (req.method === 'POST' || isRetryError)
        throw err

      if (typeof options.onRetry === 'function')
        options.onRetry(err)

      return retryHandler(err)
    }
  }, options.retry).catch((err) => {
    // don't reject for http errors, just return them
    if (err.status >= 400 && err.type !== 'system')
      return err

    throw err
  })
}

module.exports = remoteFetch

}, function(modId) { var map = {"./agent.js":1775127000606,"../package.json":1775127000607}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000606, function(require, module, exports) {

const LRU = require('lru-cache')
const url = require('url')
const isLambda = require('is-lambda')

const AGENT_CACHE = new LRU({ max: 50 })
const HttpAgent = require('agentkeepalive')
const HttpsAgent = HttpAgent.HttpsAgent

module.exports = getAgent

const getAgentTimeout = timeout =>
  typeof timeout !== 'number' || !timeout ? 0 : timeout + 1

const getMaxSockets = maxSockets => maxSockets || 15

function getAgent (uri, opts) {
  const parsedUri = new url.URL(typeof uri === 'string' ? uri : uri.url)
  const isHttps = parsedUri.protocol === 'https:'
  const pxuri = getProxyUri(parsedUri.href, opts)

  // If opts.timeout is zero, set the agentTimeout to zero as well. A timeout
  // of zero disables the timeout behavior (OS limits still apply). Else, if
  // opts.timeout is a non-zero value, set it to timeout + 1, to ensure that
  // the node-fetch-npm timeout will always fire first, giving us more
  // consistent errors.
  const agentTimeout = getAgentTimeout(opts.timeout)
  const agentMaxSockets = getMaxSockets(opts.maxSockets)

  const key = [
    `https:${isHttps}`,
    pxuri
      ? `proxy:${pxuri.protocol}//${pxuri.host}:${pxuri.port}`
      : '>no-proxy<',
    `local-address:${opts.localAddress || '>no-local-address<'}`,
    `strict-ssl:${isHttps ? opts.rejectUnauthorized : '>no-strict-ssl<'}`,
    `ca:${(isHttps && opts.ca) || '>no-ca<'}`,
    `cert:${(isHttps && opts.cert) || '>no-cert<'}`,
    `key:${(isHttps && opts.key) || '>no-key<'}`,
    `timeout:${agentTimeout}`,
    `maxSockets:${agentMaxSockets}`,
  ].join(':')

  if (opts.agent != null) { // `agent: false` has special behavior!
    return opts.agent
  }

  // keep alive in AWS lambda makes no sense
  const lambdaAgent = !isLambda ? null
    : isHttps ? require('https').globalAgent
    : require('http').globalAgent

  if (isLambda && !pxuri)
    return lambdaAgent

  if (AGENT_CACHE.peek(key))
    return AGENT_CACHE.get(key)

  if (pxuri) {
    const pxopts = isLambda ? {
      ...opts,
      agent: lambdaAgent,
    } : opts
    const proxy = getProxy(pxuri, pxopts, isHttps)
    AGENT_CACHE.set(key, proxy)
    return proxy
  }

  const agent = isHttps ? new HttpsAgent({
    maxSockets: agentMaxSockets,
    ca: opts.ca,
    cert: opts.cert,
    key: opts.key,
    localAddress: opts.localAddress,
    rejectUnauthorized: opts.rejectUnauthorized,
    timeout: agentTimeout,
  }) : new HttpAgent({
    maxSockets: agentMaxSockets,
    localAddress: opts.localAddress,
    timeout: agentTimeout,
  })
  AGENT_CACHE.set(key, agent)
  return agent
}

function checkNoProxy (uri, opts) {
  const host = new url.URL(uri).hostname.split('.').reverse()
  let noproxy = (opts.noProxy || getProcessEnv('no_proxy'))
  if (typeof noproxy === 'string')
    noproxy = noproxy.split(/\s*,\s*/g)

  return noproxy && noproxy.some(no => {
    const noParts = no.split('.').filter(x => x).reverse()
    if (!noParts.length)
      return false
    for (let i = 0; i < noParts.length; i++) {
      if (host[i] !== noParts[i])
        return false
    }
    return true
  })
}

module.exports.getProcessEnv = getProcessEnv

function getProcessEnv (env) {
  if (!env)
    return

  let value

  if (Array.isArray(env)) {
    for (const e of env) {
      value = process.env[e] ||
        process.env[e.toUpperCase()] ||
        process.env[e.toLowerCase()]
      if (typeof value !== 'undefined')
        break
    }
  }

  if (typeof env === 'string') {
    value = process.env[env] ||
      process.env[env.toUpperCase()] ||
      process.env[env.toLowerCase()]
  }

  return value
}

module.exports.getProxyUri = getProxyUri
function getProxyUri (uri, opts) {
  const protocol = new url.URL(uri).protocol

  const proxy = opts.proxy ||
    (
      protocol === 'https:' &&
      getProcessEnv('https_proxy')
    ) ||
    (
      protocol === 'http:' &&
      getProcessEnv(['https_proxy', 'http_proxy', 'proxy'])
    )
  if (!proxy)
    return null

  const parsedProxy = (typeof proxy === 'string') ? new url.URL(proxy) : proxy

  return !checkNoProxy(uri, opts) && parsedProxy
}

const getAuth = u =>
  u.username && u.password ? decodeURIComponent(`${u.username}:${u.password}`)
  : u.username ? decodeURIComponent(u.username)
  : null

const getPath = u => u.pathname + u.search + u.hash

const HttpProxyAgent = require('http-proxy-agent')
const HttpsProxyAgent = require('https-proxy-agent')
const SocksProxyAgent = require('socks-proxy-agent')
module.exports.getProxy = getProxy
function getProxy (proxyUrl, opts, isHttps) {
  const popts = {
    host: proxyUrl.hostname,
    port: proxyUrl.port,
    protocol: proxyUrl.protocol,
    path: getPath(proxyUrl),
    auth: getAuth(proxyUrl),
    ca: opts.ca,
    cert: opts.cert,
    key: opts.key,
    timeout: getAgentTimeout(opts.timeout),
    localAddress: opts.localAddress,
    maxSockets: getMaxSockets(opts.maxSockets),
    rejectUnauthorized: opts.rejectUnauthorized,
  }

  if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
    if (!isHttps)
      return new HttpProxyAgent(popts)
    else
      return new HttpsProxyAgent(popts)
  } else if (proxyUrl.protocol.startsWith('socks'))
    return new SocksProxyAgent(popts)
  else {
    throw Object.assign(
      new Error(`unsupported proxy protocol: '${proxyUrl.protocol}'`),
      {
        url: proxyUrl.href,
      }
    )
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000607, function(require, module, exports) {
module.exports = {
  "name": "make-fetch-happen",
  "version": "9.1.0",
  "description": "Opinionated, caching, retrying fetch client",
  "main": "lib/index.js",
  "files": [
    "lib"
  ],
  "scripts": {
    "preversion": "npm t",
    "postversion": "npm publish",
    "prepublishOnly": "git push --follow-tags",
    "test": "tap",
    "posttest": "npm run lint",
    "eslint": "eslint",
    "lint": "npm run eslint -- lib test",
    "lintfix": "npm run lint -- --fix"
  },
  "repository": "https://github.com/npm/make-fetch-happen",
  "keywords": [
    "http",
    "request",
    "fetch",
    "mean girls",
    "caching",
    "cache",
    "subresource integrity"
  ],
  "author": {
    "name": "Kat Marchán",
    "email": "kzm@zkat.tech",
    "twitter": "maybekatz"
  },
  "license": "ISC",
  "dependencies": {
    "agentkeepalive": "^4.1.3",
    "cacache": "^15.2.0",
    "http-cache-semantics": "^4.1.0",
    "http-proxy-agent": "^4.0.1",
    "https-proxy-agent": "^5.0.0",
    "is-lambda": "^1.0.1",
    "lru-cache": "^6.0.0",
    "minipass": "^3.1.3",
    "minipass-collect": "^1.0.2",
    "minipass-fetch": "^1.3.2",
    "minipass-flush": "^1.0.5",
    "minipass-pipeline": "^1.2.4",
    "negotiator": "^0.6.2",
    "promise-retry": "^2.0.1",
    "socks-proxy-agent": "^6.0.0",
    "ssri": "^8.0.0"
  },
  "devDependencies": {
    "eslint": "^7.26.0",
    "eslint-plugin-import": "^2.23.2",
    "eslint-plugin-node": "^11.1.0",
    "eslint-plugin-promise": "^5.1.0",
    "eslint-plugin-standard": "^5.0.0",
    "mkdirp": "^1.0.4",
    "nock": "^13.0.11",
    "npmlog": "^5.0.0",
    "require-inject": "^1.4.2",
    "rimraf": "^3.0.2",
    "safe-buffer": "^5.2.1",
    "standard-version": "^9.3.0",
    "tap": "^15.0.9"
  },
  "engines": {
    "node": ">= 10"
  },
  "tap": {
    "color": 1,
    "files": "test/*.js",
    "check-coverage": true
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1775127000597);
})()
//miniprogram-npm-outsideDeps=["minipass-fetch","url","http-cache-semantics","negotiator","ssri","minipass","minipass-collect","minipass-flush","minipass-pipeline","cacache","promise-retry","lru-cache","is-lambda","agentkeepalive","https","http","http-proxy-agent","https-proxy-agent","socks-proxy-agent"]
//# sourceMappingURL=index.js.map