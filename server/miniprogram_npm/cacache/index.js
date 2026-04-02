module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1775127000391, function(require, module, exports) {


const ls = require('./ls.js')
const get = require('./get.js')
const put = require('./put.js')
const rm = require('./rm.js')
const verify = require('./verify.js')
const { clearMemoized } = require('./lib/memoization.js')
const tmp = require('./lib/util/tmp.js')
const index = require('./lib/entry-index.js')

module.exports.index = {}
module.exports.index.compact = index.compact
module.exports.index.insert = index.insert

module.exports.ls = ls
module.exports.ls.stream = ls.stream

module.exports.get = get
module.exports.get.byDigest = get.byDigest
module.exports.get.sync = get.sync
module.exports.get.sync.byDigest = get.sync.byDigest
module.exports.get.stream = get.stream
module.exports.get.stream.byDigest = get.stream.byDigest
module.exports.get.copy = get.copy
module.exports.get.copy.byDigest = get.copy.byDigest
module.exports.get.info = get.info
module.exports.get.hasContent = get.hasContent
module.exports.get.hasContent.sync = get.hasContent.sync

module.exports.put = put
module.exports.put.stream = put.stream

module.exports.rm = rm.entry
module.exports.rm.all = rm.all
module.exports.rm.entry = module.exports.rm
module.exports.rm.content = rm.content

module.exports.clearMemoized = clearMemoized

module.exports.tmp = {}
module.exports.tmp.mkdir = tmp.mkdir
module.exports.tmp.withTmp = tmp.withTmp

module.exports.verify = verify
module.exports.verify.lastRun = verify.lastRun

}, function(modId) {var map = {"./ls.js":1775127000392,"./get.js":1775127000399,"./put.js":1775127000402,"./rm.js":1775127000405,"./verify.js":1775127000407,"./lib/memoization.js":1775127000400,"./lib/util/tmp.js":1775127000409,"./lib/entry-index.js":1775127000393}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000392, function(require, module, exports) {


const index = require('./lib/entry-index')

module.exports = index.ls
module.exports.stream = index.lsStream

}, function(modId) { var map = {"./lib/entry-index":1775127000393}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000393, function(require, module, exports) {


const util = require('util')
const crypto = require('crypto')
const fs = require('fs')
const Minipass = require('minipass')
const path = require('path')
const ssri = require('ssri')
const uniqueFilename = require('unique-filename')

const { disposer } = require('./util/disposer')
const contentPath = require('./content/path')
const fixOwner = require('./util/fix-owner')
const hashToSegments = require('./util/hash-to-segments')
const indexV = require('../package.json')['cache-version'].index
const moveFile = require('@npmcli/move-file')
const _rimraf = require('rimraf')
const rimraf = util.promisify(_rimraf)
rimraf.sync = _rimraf.sync

const appendFile = util.promisify(fs.appendFile)
const readFile = util.promisify(fs.readFile)
const readdir = util.promisify(fs.readdir)
const writeFile = util.promisify(fs.writeFile)

module.exports.NotFoundError = class NotFoundError extends Error {
  constructor (cache, key) {
    super(`No cache entry for ${key} found in ${cache}`)
    this.code = 'ENOENT'
    this.cache = cache
    this.key = key
  }
}

module.exports.compact = compact

async function compact (cache, key, matchFn, opts = {}) {
  const bucket = bucketPath(cache, key)
  const entries = await bucketEntries(bucket)
  const newEntries = []
  // we loop backwards because the bottom-most result is the newest
  // since we add new entries with appendFile
  for (let i = entries.length - 1; i >= 0; --i) {
    const entry = entries[i]
    // a null integrity could mean either a delete was appended
    // or the user has simply stored an index that does not map
    // to any content. we determine if the user wants to keep the
    // null integrity based on the validateEntry function passed in options.
    // if the integrity is null and no validateEntry is provided, we break
    // as we consider the null integrity to be a deletion of everything
    // that came before it.
    if (entry.integrity === null && !opts.validateEntry)
      break

    // if this entry is valid, and it is either the first entry or
    // the newEntries array doesn't already include an entry that
    // matches this one based on the provided matchFn, then we add
    // it to the beginning of our list
    if ((!opts.validateEntry || opts.validateEntry(entry) === true) &&
      (newEntries.length === 0 ||
        !newEntries.find((oldEntry) => matchFn(oldEntry, entry))))
      newEntries.unshift(entry)
  }

  const newIndex = '\n' + newEntries.map((entry) => {
    const stringified = JSON.stringify(entry)
    const hash = hashEntry(stringified)
    return `${hash}\t${stringified}`
  }).join('\n')

  const setup = async () => {
    const target = uniqueFilename(path.join(cache, 'tmp'), opts.tmpPrefix)
    await fixOwner.mkdirfix(cache, path.dirname(target))
    return {
      target,
      moved: false,
    }
  }

  const teardown = async (tmp) => {
    if (!tmp.moved)
      return rimraf(tmp.target)
  }

  const write = async (tmp) => {
    await writeFile(tmp.target, newIndex, { flag: 'wx' })
    await fixOwner.mkdirfix(cache, path.dirname(bucket))
    // we use @npmcli/move-file directly here because we
    // want to overwrite the existing file
    await moveFile(tmp.target, bucket)
    tmp.moved = true
    try {
      await fixOwner.chownr(cache, bucket)
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err
    }
  }

  // write the file atomically
  await disposer(setup(), teardown, write)

  // we reverse the list we generated such that the newest
  // entries come first in order to make looping through them easier
  // the true passed to formatEntry tells it to keep null
  // integrity values, if they made it this far it's because
  // validateEntry returned true, and as such we should return it
  return newEntries.reverse().map((entry) => formatEntry(cache, entry, true))
}

module.exports.insert = insert

function insert (cache, key, integrity, opts = {}) {
  const { metadata, size } = opts
  const bucket = bucketPath(cache, key)
  const entry = {
    key,
    integrity: integrity && ssri.stringify(integrity),
    time: Date.now(),
    size,
    metadata,
  }
  return fixOwner
    .mkdirfix(cache, path.dirname(bucket))
    .then(() => {
      const stringified = JSON.stringify(entry)
      // NOTE - Cleverness ahoy!
      //
      // This works because it's tremendously unlikely for an entry to corrupt
      // another while still preserving the string length of the JSON in
      // question. So, we just slap the length in there and verify it on read.
      //
      // Thanks to @isaacs for the whiteboarding session that ended up with
      // this.
      return appendFile(bucket, `\n${hashEntry(stringified)}\t${stringified}`)
    })
    .then(() => fixOwner.chownr(cache, bucket))
    .catch((err) => {
      if (err.code === 'ENOENT')
        return undefined

      throw err
      // There's a class of race conditions that happen when things get deleted
      // during fixOwner, or between the two mkdirfix/chownr calls.
      //
      // It's perfectly fine to just not bother in those cases and lie
      // that the index entry was written. Because it's a cache.
    })
    .then(() => {
      return formatEntry(cache, entry)
    })
}

module.exports.insert.sync = insertSync

function insertSync (cache, key, integrity, opts = {}) {
  const { metadata, size } = opts
  const bucket = bucketPath(cache, key)
  const entry = {
    key,
    integrity: integrity && ssri.stringify(integrity),
    time: Date.now(),
    size,
    metadata,
  }
  fixOwner.mkdirfix.sync(cache, path.dirname(bucket))
  const stringified = JSON.stringify(entry)
  fs.appendFileSync(bucket, `\n${hashEntry(stringified)}\t${stringified}`)
  try {
    fixOwner.chownr.sync(cache, bucket)
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err
  }
  return formatEntry(cache, entry)
}

module.exports.find = find

function find (cache, key) {
  const bucket = bucketPath(cache, key)
  return bucketEntries(bucket)
    .then((entries) => {
      return entries.reduce((latest, next) => {
        if (next && next.key === key)
          return formatEntry(cache, next)
        else
          return latest
      }, null)
    })
    .catch((err) => {
      if (err.code === 'ENOENT')
        return null
      else
        throw err
    })
}

module.exports.find.sync = findSync

function findSync (cache, key) {
  const bucket = bucketPath(cache, key)
  try {
    return bucketEntriesSync(bucket).reduce((latest, next) => {
      if (next && next.key === key)
        return formatEntry(cache, next)
      else
        return latest
    }, null)
  } catch (err) {
    if (err.code === 'ENOENT')
      return null
    else
      throw err
  }
}

module.exports.delete = del

function del (cache, key, opts = {}) {
  if (!opts.removeFully)
    return insert(cache, key, null, opts)

  const bucket = bucketPath(cache, key)
  return rimraf(bucket)
}

module.exports.delete.sync = delSync

function delSync (cache, key, opts = {}) {
  if (!opts.removeFully)
    return insertSync(cache, key, null, opts)

  const bucket = bucketPath(cache, key)
  return rimraf.sync(bucket)
}

module.exports.lsStream = lsStream

function lsStream (cache) {
  const indexDir = bucketDir(cache)
  const stream = new Minipass({ objectMode: true })

  readdirOrEmpty(indexDir).then(buckets => Promise.all(
    buckets.map(bucket => {
      const bucketPath = path.join(indexDir, bucket)
      return readdirOrEmpty(bucketPath).then(subbuckets => Promise.all(
        subbuckets.map(subbucket => {
          const subbucketPath = path.join(bucketPath, subbucket)

          // "/cachename/<bucket 0xFF>/<bucket 0xFF>./*"
          return readdirOrEmpty(subbucketPath).then(entries => Promise.all(
            entries.map(entry => {
              const entryPath = path.join(subbucketPath, entry)
              return bucketEntries(entryPath).then(entries =>
                // using a Map here prevents duplicate keys from
                // showing up twice, I guess?
                entries.reduce((acc, entry) => {
                  acc.set(entry.key, entry)
                  return acc
                }, new Map())
              ).then(reduced => {
                // reduced is a map of key => entry
                for (const entry of reduced.values()) {
                  const formatted = formatEntry(cache, entry)
                  if (formatted)
                    stream.write(formatted)
                }
              }).catch(err => {
                if (err.code === 'ENOENT')
                  return undefined
                throw err
              })
            })
          ))
        })
      ))
    })
  ))
    .then(
      () => stream.end(),
      err => stream.emit('error', err)
    )

  return stream
}

module.exports.ls = ls

function ls (cache) {
  return lsStream(cache).collect().then(entries =>
    entries.reduce((acc, xs) => {
      acc[xs.key] = xs
      return acc
    }, {})
  )
}

module.exports.bucketEntries = bucketEntries

function bucketEntries (bucket, filter) {
  return readFile(bucket, 'utf8').then((data) => _bucketEntries(data, filter))
}

module.exports.bucketEntries.sync = bucketEntriesSync

function bucketEntriesSync (bucket, filter) {
  const data = fs.readFileSync(bucket, 'utf8')
  return _bucketEntries(data, filter)
}

function _bucketEntries (data, filter) {
  const entries = []
  data.split('\n').forEach((entry) => {
    if (!entry)
      return

    const pieces = entry.split('\t')
    if (!pieces[1] || hashEntry(pieces[1]) !== pieces[0]) {
      // Hash is no good! Corruption or malice? Doesn't matter!
      // EJECT EJECT
      return
    }
    let obj
    try {
      obj = JSON.parse(pieces[1])
    } catch (e) {
      // Entry is corrupted!
      return
    }
    if (obj)
      entries.push(obj)
  })
  return entries
}

module.exports.bucketDir = bucketDir

function bucketDir (cache) {
  return path.join(cache, `index-v${indexV}`)
}

module.exports.bucketPath = bucketPath

function bucketPath (cache, key) {
  const hashed = hashKey(key)
  return path.join.apply(
    path,
    [bucketDir(cache)].concat(hashToSegments(hashed))
  )
}

module.exports.hashKey = hashKey

function hashKey (key) {
  return hash(key, 'sha256')
}

module.exports.hashEntry = hashEntry

function hashEntry (str) {
  return hash(str, 'sha1')
}

function hash (str, digest) {
  return crypto
    .createHash(digest)
    .update(str)
    .digest('hex')
}

function formatEntry (cache, entry, keepAll) {
  // Treat null digests as deletions. They'll shadow any previous entries.
  if (!entry.integrity && !keepAll)
    return null

  return {
    key: entry.key,
    integrity: entry.integrity,
    path: entry.integrity ? contentPath(cache, entry.integrity) : undefined,
    size: entry.size,
    time: entry.time,
    metadata: entry.metadata,
  }
}

function readdirOrEmpty (dir) {
  return readdir(dir).catch((err) => {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR')
      return []

    throw err
  })
}

}, function(modId) { var map = {"./util/disposer":1775127000394,"./content/path":1775127000395,"./util/fix-owner":1775127000398,"./util/hash-to-segments":1775127000397,"../package.json":1775127000396}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000394, function(require, module, exports) {


module.exports.disposer = disposer

function disposer (creatorFn, disposerFn, fn) {
  const runDisposer = (resource, result, shouldThrow = false) => {
    return disposerFn(resource)
      .then(
        // disposer resolved, do something with original fn's promise
        () => {
          if (shouldThrow)
            throw result

          return result
        },
        // Disposer fn failed, crash process
        (err) => {
          throw err
          // Or process.exit?
        })
  }

  return creatorFn
    .then((resource) => {
      // fn(resource) can throw, so wrap in a promise here
      return Promise.resolve().then(() => fn(resource))
        .then((result) => runDisposer(resource, result))
        .catch((err) => runDisposer(resource, err, true))
    })
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000395, function(require, module, exports) {


const contentVer = require('../../package.json')['cache-version'].content
const hashToSegments = require('../util/hash-to-segments')
const path = require('path')
const ssri = require('ssri')

// Current format of content file path:
//
// sha512-BaSE64Hex= ->
// ~/.my-cache/content-v2/sha512/ba/da/55deadbeefc0ffee
//
module.exports = contentPath

function contentPath (cache, integrity) {
  const sri = ssri.parse(integrity, { single: true })
  // contentPath is the *strongest* algo given
  return path.join(
    contentDir(cache),
    sri.algorithm,
    ...hashToSegments(sri.hexDigest())
  )
}

module.exports.contentDir = contentDir

function contentDir (cache) {
  return path.join(cache, `content-v${contentVer}`)
}

}, function(modId) { var map = {"../../package.json":1775127000396,"../util/hash-to-segments":1775127000397,"path":1775127000395}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000396, function(require, module, exports) {
module.exports = {
  "name": "cacache",
  "version": "15.3.0",
  "cache-version": {
    "content": "2",
    "index": "5"
  },
  "description": "Fast, fault-tolerant, cross-platform, disk-based, data-agnostic, content-addressable cache.",
  "main": "index.js",
  "files": [
    "*.js",
    "lib"
  ],
  "scripts": {
    "benchmarks": "node test/benchmarks",
    "preversion": "npm test",
    "postversion": "npm publish",
    "prepublishOnly": "git push origin --follow-tags",
    "test": "tap",
    "snap": "tap",
    "coverage": "tap",
    "test-docker": "docker run -it --rm --name pacotest -v \"$PWD\":/tmp -w /tmp node:latest npm test",
    "lint": "npm run npmclilint -- \"*.*js\" \"lib/**/*.*js\" \"test/**/*.*js\"",
    "npmclilint": "npmcli-lint",
    "lintfix": "npm run lint -- --fix",
    "postsnap": "npm run lintfix --"
  },
  "repository": "https://github.com/npm/cacache",
  "keywords": [
    "cache",
    "caching",
    "content-addressable",
    "sri",
    "sri hash",
    "subresource integrity",
    "cache",
    "storage",
    "store",
    "file store",
    "filesystem",
    "disk cache",
    "disk storage"
  ],
  "license": "ISC",
  "dependencies": {
    "@npmcli/fs": "^1.0.0",
    "@npmcli/move-file": "^1.0.1",
    "chownr": "^2.0.0",
    "fs-minipass": "^2.0.0",
    "glob": "^7.1.4",
    "infer-owner": "^1.0.4",
    "lru-cache": "^6.0.0",
    "minipass": "^3.1.1",
    "minipass-collect": "^1.0.2",
    "minipass-flush": "^1.0.5",
    "minipass-pipeline": "^1.2.2",
    "mkdirp": "^1.0.3",
    "p-map": "^4.0.0",
    "promise-inflight": "^1.0.1",
    "rimraf": "^3.0.2",
    "ssri": "^8.0.1",
    "tar": "^6.0.2",
    "unique-filename": "^1.1.1"
  },
  "devDependencies": {
    "@npmcli/lint": "^1.0.1",
    "benchmark": "^2.1.4",
    "chalk": "^4.0.0",
    "require-inject": "^1.4.4",
    "tacks": "^1.3.0",
    "tap": "^15.0.9"
  },
  "tap": {
    "100": true,
    "test-regex": "test/[^/]*.js"
  },
  "engines": {
    "node": ">= 10"
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000397, function(require, module, exports) {


module.exports = hashToSegments

function hashToSegments (hash) {
  return [hash.slice(0, 2), hash.slice(2, 4), hash.slice(4)]
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000398, function(require, module, exports) {


const util = require('util')

const chownr = util.promisify(require('chownr'))
const mkdirp = require('mkdirp')
const inflight = require('promise-inflight')
const inferOwner = require('infer-owner')

// Memoize getuid()/getgid() calls.
// patch process.setuid/setgid to invalidate cached value on change
const self = { uid: null, gid: null }
const getSelf = () => {
  if (typeof self.uid !== 'number') {
    self.uid = process.getuid()
    const setuid = process.setuid
    process.setuid = (uid) => {
      self.uid = null
      process.setuid = setuid
      return process.setuid(uid)
    }
  }
  if (typeof self.gid !== 'number') {
    self.gid = process.getgid()
    const setgid = process.setgid
    process.setgid = (gid) => {
      self.gid = null
      process.setgid = setgid
      return process.setgid(gid)
    }
  }
}

module.exports.chownr = fixOwner

function fixOwner (cache, filepath) {
  if (!process.getuid) {
    // This platform doesn't need ownership fixing
    return Promise.resolve()
  }

  getSelf()
  if (self.uid !== 0) {
    // almost certainly can't chown anyway
    return Promise.resolve()
  }

  return Promise.resolve(inferOwner(cache)).then((owner) => {
    const { uid, gid } = owner

    // No need to override if it's already what we used.
    if (self.uid === uid && self.gid === gid)
      return

    return inflight('fixOwner: fixing ownership on ' + filepath, () =>
      chownr(
        filepath,
        typeof uid === 'number' ? uid : self.uid,
        typeof gid === 'number' ? gid : self.gid
      ).catch((err) => {
        if (err.code === 'ENOENT')
          return null

        throw err
      })
    )
  })
}

module.exports.chownr.sync = fixOwnerSync

function fixOwnerSync (cache, filepath) {
  if (!process.getuid) {
    // This platform doesn't need ownership fixing
    return
  }
  const { uid, gid } = inferOwner.sync(cache)
  getSelf()
  if (self.uid !== 0) {
    // almost certainly can't chown anyway
    return
  }

  if (self.uid === uid && self.gid === gid) {
    // No need to override if it's already what we used.
    return
  }
  try {
    chownr.sync(
      filepath,
      typeof uid === 'number' ? uid : self.uid,
      typeof gid === 'number' ? gid : self.gid
    )
  } catch (err) {
    // only catch ENOENT, any other error is a problem.
    if (err.code === 'ENOENT')
      return null

    throw err
  }
}

module.exports.mkdirfix = mkdirfix

function mkdirfix (cache, p, cb) {
  // we have to infer the owner _before_ making the directory, even though
  // we aren't going to use the results, since the cache itself might not
  // exist yet.  If we mkdirp it, then our current uid/gid will be assumed
  // to be correct if it creates the cache folder in the process.
  return Promise.resolve(inferOwner(cache)).then(() => {
    return mkdirp(p)
      .then((made) => {
        if (made)
          return fixOwner(cache, made).then(() => made)
      })
      .catch((err) => {
        if (err.code === 'EEXIST')
          return fixOwner(cache, p).then(() => null)

        throw err
      })
  })
}

module.exports.mkdirfix.sync = mkdirfixSync

function mkdirfixSync (cache, p) {
  try {
    inferOwner.sync(cache)
    const made = mkdirp.sync(p)
    if (made) {
      fixOwnerSync(cache, made)
      return made
    }
  } catch (err) {
    if (err.code === 'EEXIST') {
      fixOwnerSync(cache, p)
      return null
    } else
      throw err
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000399, function(require, module, exports) {


const Collect = require('minipass-collect')
const Minipass = require('minipass')
const Pipeline = require('minipass-pipeline')
const fs = require('fs')
const util = require('util')

const index = require('./lib/entry-index')
const memo = require('./lib/memoization')
const read = require('./lib/content/read')

const writeFile = util.promisify(fs.writeFile)

function getData (cache, key, opts = {}) {
  const { integrity, memoize, size } = opts
  const memoized = memo.get(cache, key, opts)
  if (memoized && memoize !== false) {
    return Promise.resolve({
      metadata: memoized.entry.metadata,
      data: memoized.data,
      integrity: memoized.entry.integrity,
      size: memoized.entry.size,
    })
  }

  return index.find(cache, key, opts).then((entry) => {
    if (!entry)
      throw new index.NotFoundError(cache, key)

    return read(cache, entry.integrity, { integrity, size }).then((data) => {
      if (memoize)
        memo.put(cache, entry, data, opts)

      return {
        data,
        metadata: entry.metadata,
        size: entry.size,
        integrity: entry.integrity,
      }
    })
  })
}
module.exports = getData

function getDataByDigest (cache, key, opts = {}) {
  const { integrity, memoize, size } = opts
  const memoized = memo.get.byDigest(cache, key, opts)
  if (memoized && memoize !== false)
    return Promise.resolve(memoized)

  return read(cache, key, { integrity, size }).then((res) => {
    if (memoize)
      memo.put.byDigest(cache, key, res, opts)
    return res
  })
}
module.exports.byDigest = getDataByDigest

function getDataSync (cache, key, opts = {}) {
  const { integrity, memoize, size } = opts
  const memoized = memo.get(cache, key, opts)

  if (memoized && memoize !== false) {
    return {
      metadata: memoized.entry.metadata,
      data: memoized.data,
      integrity: memoized.entry.integrity,
      size: memoized.entry.size,
    }
  }
  const entry = index.find.sync(cache, key, opts)
  if (!entry)
    throw new index.NotFoundError(cache, key)
  const data = read.sync(cache, entry.integrity, {
    integrity: integrity,
    size: size,
  })
  const res = {
    metadata: entry.metadata,
    data: data,
    size: entry.size,
    integrity: entry.integrity,
  }
  if (memoize)
    memo.put(cache, entry, res.data, opts)

  return res
}

module.exports.sync = getDataSync

function getDataByDigestSync (cache, digest, opts = {}) {
  const { integrity, memoize, size } = opts
  const memoized = memo.get.byDigest(cache, digest, opts)

  if (memoized && memoize !== false)
    return memoized

  const res = read.sync(cache, digest, {
    integrity: integrity,
    size: size,
  })
  if (memoize)
    memo.put.byDigest(cache, digest, res, opts)

  return res
}
module.exports.sync.byDigest = getDataByDigestSync

const getMemoizedStream = (memoized) => {
  const stream = new Minipass()
  stream.on('newListener', function (ev, cb) {
    ev === 'metadata' && cb(memoized.entry.metadata)
    ev === 'integrity' && cb(memoized.entry.integrity)
    ev === 'size' && cb(memoized.entry.size)
  })
  stream.end(memoized.data)
  return stream
}

function getStream (cache, key, opts = {}) {
  const { memoize, size } = opts
  const memoized = memo.get(cache, key, opts)
  if (memoized && memoize !== false)
    return getMemoizedStream(memoized)

  const stream = new Pipeline()
  index
    .find(cache, key)
    .then((entry) => {
      if (!entry)
        throw new index.NotFoundError(cache, key)

      stream.emit('metadata', entry.metadata)
      stream.emit('integrity', entry.integrity)
      stream.emit('size', entry.size)
      stream.on('newListener', function (ev, cb) {
        ev === 'metadata' && cb(entry.metadata)
        ev === 'integrity' && cb(entry.integrity)
        ev === 'size' && cb(entry.size)
      })

      const src = read.readStream(
        cache,
        entry.integrity,
        { ...opts, size: typeof size !== 'number' ? entry.size : size }
      )

      if (memoize) {
        const memoStream = new Collect.PassThrough()
        memoStream.on('collect', data => memo.put(cache, entry, data, opts))
        stream.unshift(memoStream)
      }
      stream.unshift(src)
    })
    .catch((err) => stream.emit('error', err))

  return stream
}

module.exports.stream = getStream

function getStreamDigest (cache, integrity, opts = {}) {
  const { memoize } = opts
  const memoized = memo.get.byDigest(cache, integrity, opts)
  if (memoized && memoize !== false) {
    const stream = new Minipass()
    stream.end(memoized)
    return stream
  } else {
    const stream = read.readStream(cache, integrity, opts)
    if (!memoize)
      return stream

    const memoStream = new Collect.PassThrough()
    memoStream.on('collect', data => memo.put.byDigest(
      cache,
      integrity,
      data,
      opts
    ))
    return new Pipeline(stream, memoStream)
  }
}

module.exports.stream.byDigest = getStreamDigest

function info (cache, key, opts = {}) {
  const { memoize } = opts
  const memoized = memo.get(cache, key, opts)
  if (memoized && memoize !== false)
    return Promise.resolve(memoized.entry)
  else
    return index.find(cache, key)
}
module.exports.info = info

function copy (cache, key, dest, opts = {}) {
  if (read.copy) {
    return index.find(cache, key, opts).then((entry) => {
      if (!entry)
        throw new index.NotFoundError(cache, key)
      return read.copy(cache, entry.integrity, dest, opts)
        .then(() => {
          return {
            metadata: entry.metadata,
            size: entry.size,
            integrity: entry.integrity,
          }
        })
    })
  }

  return getData(cache, key, opts).then((res) => {
    return writeFile(dest, res.data).then(() => {
      return {
        metadata: res.metadata,
        size: res.size,
        integrity: res.integrity,
      }
    })
  })
}
module.exports.copy = copy

function copyByDigest (cache, key, dest, opts = {}) {
  if (read.copy)
    return read.copy(cache, key, dest, opts).then(() => key)

  return getDataByDigest(cache, key, opts).then((res) => {
    return writeFile(dest, res).then(() => key)
  })
}
module.exports.copy.byDigest = copyByDigest

module.exports.hasContent = read.hasContent

}, function(modId) { var map = {"./lib/entry-index":1775127000393,"./lib/memoization":1775127000400,"./lib/content/read":1775127000401}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000400, function(require, module, exports) {


const LRU = require('lru-cache')

const MAX_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_AGE = 3 * 60 * 1000

const MEMOIZED = new LRU({
  max: MAX_SIZE,
  maxAge: MAX_AGE,
  length: (entry, key) => key.startsWith('key:') ? entry.data.length : entry.length,
})

module.exports.clearMemoized = clearMemoized

function clearMemoized () {
  const old = {}
  MEMOIZED.forEach((v, k) => {
    old[k] = v
  })
  MEMOIZED.reset()
  return old
}

module.exports.put = put

function put (cache, entry, data, opts) {
  pickMem(opts).set(`key:${cache}:${entry.key}`, { entry, data })
  putDigest(cache, entry.integrity, data, opts)
}

module.exports.put.byDigest = putDigest

function putDigest (cache, integrity, data, opts) {
  pickMem(opts).set(`digest:${cache}:${integrity}`, data)
}

module.exports.get = get

function get (cache, key, opts) {
  return pickMem(opts).get(`key:${cache}:${key}`)
}

module.exports.get.byDigest = getDigest

function getDigest (cache, integrity, opts) {
  return pickMem(opts).get(`digest:${cache}:${integrity}`)
}

class ObjProxy {
  constructor (obj) {
    this.obj = obj
  }

  get (key) {
    return this.obj[key]
  }

  set (key, val) {
    this.obj[key] = val
  }
}

function pickMem (opts) {
  if (!opts || !opts.memoize)
    return MEMOIZED
  else if (opts.memoize.get && opts.memoize.set)
    return opts.memoize
  else if (typeof opts.memoize === 'object')
    return new ObjProxy(opts.memoize)
  else
    return MEMOIZED
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000401, function(require, module, exports) {


const util = require('util')

const fs = require('fs')
const fsm = require('fs-minipass')
const ssri = require('ssri')
const contentPath = require('./path')
const Pipeline = require('minipass-pipeline')

const lstat = util.promisify(fs.lstat)
const readFile = util.promisify(fs.readFile)

module.exports = read

const MAX_SINGLE_READ_SIZE = 64 * 1024 * 1024
function read (cache, integrity, opts = {}) {
  const { size } = opts
  return withContentSri(cache, integrity, (cpath, sri) => {
    // get size
    return lstat(cpath).then(stat => ({ stat, cpath, sri }))
  }).then(({ stat, cpath, sri }) => {
    if (typeof size === 'number' && stat.size !== size)
      throw sizeError(size, stat.size)

    if (stat.size > MAX_SINGLE_READ_SIZE)
      return readPipeline(cpath, stat.size, sri, new Pipeline()).concat()

    return readFile(cpath, null).then((data) => {
      if (!ssri.checkData(data, sri))
        throw integrityError(sri, cpath)

      return data
    })
  })
}

const readPipeline = (cpath, size, sri, stream) => {
  stream.push(
    new fsm.ReadStream(cpath, {
      size,
      readSize: MAX_SINGLE_READ_SIZE,
    }),
    ssri.integrityStream({
      integrity: sri,
      size,
    })
  )
  return stream
}

module.exports.sync = readSync

function readSync (cache, integrity, opts = {}) {
  const { size } = opts
  return withContentSriSync(cache, integrity, (cpath, sri) => {
    const data = fs.readFileSync(cpath)
    if (typeof size === 'number' && size !== data.length)
      throw sizeError(size, data.length)

    if (ssri.checkData(data, sri))
      return data

    throw integrityError(sri, cpath)
  })
}

module.exports.stream = readStream
module.exports.readStream = readStream

function readStream (cache, integrity, opts = {}) {
  const { size } = opts
  const stream = new Pipeline()
  withContentSri(cache, integrity, (cpath, sri) => {
    // just lstat to ensure it exists
    return lstat(cpath).then((stat) => ({ stat, cpath, sri }))
  }).then(({ stat, cpath, sri }) => {
    if (typeof size === 'number' && size !== stat.size)
      return stream.emit('error', sizeError(size, stat.size))

    readPipeline(cpath, stat.size, sri, stream)
  }, er => stream.emit('error', er))

  return stream
}

let copyFile
if (fs.copyFile) {
  module.exports.copy = copy
  module.exports.copy.sync = copySync
  copyFile = util.promisify(fs.copyFile)
}

function copy (cache, integrity, dest) {
  return withContentSri(cache, integrity, (cpath, sri) => {
    return copyFile(cpath, dest)
  })
}

function copySync (cache, integrity, dest) {
  return withContentSriSync(cache, integrity, (cpath, sri) => {
    return fs.copyFileSync(cpath, dest)
  })
}

module.exports.hasContent = hasContent

function hasContent (cache, integrity) {
  if (!integrity)
    return Promise.resolve(false)

  return withContentSri(cache, integrity, (cpath, sri) => {
    return lstat(cpath).then((stat) => ({ size: stat.size, sri, stat }))
  }).catch((err) => {
    if (err.code === 'ENOENT')
      return false

    if (err.code === 'EPERM') {
      /* istanbul ignore else */
      if (process.platform !== 'win32')
        throw err
      else
        return false
    }
  })
}

module.exports.hasContent.sync = hasContentSync

function hasContentSync (cache, integrity) {
  if (!integrity)
    return false

  return withContentSriSync(cache, integrity, (cpath, sri) => {
    try {
      const stat = fs.lstatSync(cpath)
      return { size: stat.size, sri, stat }
    } catch (err) {
      if (err.code === 'ENOENT')
        return false

      if (err.code === 'EPERM') {
        /* istanbul ignore else */
        if (process.platform !== 'win32')
          throw err
        else
          return false
      }
    }
  })
}

function withContentSri (cache, integrity, fn) {
  const tryFn = () => {
    const sri = ssri.parse(integrity)
    // If `integrity` has multiple entries, pick the first digest
    // with available local data.
    const algo = sri.pickAlgorithm()
    const digests = sri[algo]

    if (digests.length <= 1) {
      const cpath = contentPath(cache, digests[0])
      return fn(cpath, digests[0])
    } else {
      // Can't use race here because a generic error can happen before
      // a ENOENT error, and can happen before a valid result
      return Promise
        .all(digests.map((meta) => {
          return withContentSri(cache, meta, fn)
            .catch((err) => {
              if (err.code === 'ENOENT') {
                return Object.assign(
                  new Error('No matching content found for ' + sri.toString()),
                  { code: 'ENOENT' }
                )
              }
              return err
            })
        }))
        .then((results) => {
          // Return the first non error if it is found
          const result = results.find((r) => !(r instanceof Error))
          if (result)
            return result

          // Throw the No matching content found error
          const enoentError = results.find((r) => r.code === 'ENOENT')
          if (enoentError)
            throw enoentError

          // Throw generic error
          throw results.find((r) => r instanceof Error)
        })
    }
  }

  return new Promise((resolve, reject) => {
    try {
      tryFn()
        .then(resolve)
        .catch(reject)
    } catch (err) {
      reject(err)
    }
  })
}

function withContentSriSync (cache, integrity, fn) {
  const sri = ssri.parse(integrity)
  // If `integrity` has multiple entries, pick the first digest
  // with available local data.
  const algo = sri.pickAlgorithm()
  const digests = sri[algo]
  if (digests.length <= 1) {
    const cpath = contentPath(cache, digests[0])
    return fn(cpath, digests[0])
  } else {
    let lastErr = null
    for (const meta of digests) {
      try {
        return withContentSriSync(cache, meta, fn)
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr
  }
}

function sizeError (expected, found) {
  const err = new Error(`Bad data size: expected inserted data to be ${expected} bytes, but got ${found} instead`)
  err.expected = expected
  err.found = found
  err.code = 'EBADSIZE'
  return err
}

function integrityError (sri, path) {
  const err = new Error(`Integrity verification failed for ${sri} (${path})`)
  err.code = 'EINTEGRITY'
  err.sri = sri
  err.path = path
  return err
}

}, function(modId) { var map = {"./path":1775127000395}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000402, function(require, module, exports) {


const index = require('./lib/entry-index')
const memo = require('./lib/memoization')
const write = require('./lib/content/write')
const Flush = require('minipass-flush')
const { PassThrough } = require('minipass-collect')
const Pipeline = require('minipass-pipeline')

const putOpts = (opts) => ({
  algorithms: ['sha512'],
  ...opts,
})

module.exports = putData

function putData (cache, key, data, opts = {}) {
  const { memoize } = opts
  opts = putOpts(opts)
  return write(cache, data, opts).then((res) => {
    return index
      .insert(cache, key, res.integrity, { ...opts, size: res.size })
      .then((entry) => {
        if (memoize)
          memo.put(cache, entry, data, opts)

        return res.integrity
      })
  })
}

module.exports.stream = putStream

function putStream (cache, key, opts = {}) {
  const { memoize } = opts
  opts = putOpts(opts)
  let integrity
  let size

  let memoData
  const pipeline = new Pipeline()
  // first item in the pipeline is the memoizer, because we need
  // that to end first and get the collected data.
  if (memoize) {
    const memoizer = new PassThrough().on('collect', data => {
      memoData = data
    })
    pipeline.push(memoizer)
  }

  // contentStream is a write-only, not a passthrough
  // no data comes out of it.
  const contentStream = write.stream(cache, opts)
    .on('integrity', (int) => {
      integrity = int
    })
    .on('size', (s) => {
      size = s
    })

  pipeline.push(contentStream)

  // last but not least, we write the index and emit hash and size,
  // and memoize if we're doing that
  pipeline.push(new Flush({
    flush () {
      return index
        .insert(cache, key, integrity, { ...opts, size })
        .then((entry) => {
          if (memoize && memoData)
            memo.put(cache, entry, memoData, opts)

          if (integrity)
            pipeline.emit('integrity', integrity)

          if (size)
            pipeline.emit('size', size)
        })
    },
  }))

  return pipeline
}

}, function(modId) { var map = {"./lib/entry-index":1775127000393,"./lib/memoization":1775127000400,"./lib/content/write":1775127000403}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000403, function(require, module, exports) {


const util = require('util')

const contentPath = require('./path')
const fixOwner = require('../util/fix-owner')
const fs = require('fs')
const moveFile = require('../util/move-file')
const Minipass = require('minipass')
const Pipeline = require('minipass-pipeline')
const Flush = require('minipass-flush')
const path = require('path')
const rimraf = util.promisify(require('rimraf'))
const ssri = require('ssri')
const uniqueFilename = require('unique-filename')
const { disposer } = require('./../util/disposer')
const fsm = require('fs-minipass')

const writeFile = util.promisify(fs.writeFile)

module.exports = write

function write (cache, data, opts = {}) {
  const { algorithms, size, integrity } = opts
  if (algorithms && algorithms.length > 1)
    throw new Error('opts.algorithms only supports a single algorithm for now')

  if (typeof size === 'number' && data.length !== size)
    return Promise.reject(sizeError(size, data.length))

  const sri = ssri.fromData(data, algorithms ? { algorithms } : {})
  if (integrity && !ssri.checkData(data, integrity, opts))
    return Promise.reject(checksumError(integrity, sri))

  return disposer(makeTmp(cache, opts), makeTmpDisposer,
    (tmp) => {
      return writeFile(tmp.target, data, { flag: 'wx' })
        .then(() => moveToDestination(tmp, cache, sri, opts))
    })
    .then(() => ({ integrity: sri, size: data.length }))
}

module.exports.stream = writeStream

// writes proxied to the 'inputStream' that is passed to the Promise
// 'end' is deferred until content is handled.
class CacacheWriteStream extends Flush {
  constructor (cache, opts) {
    super()
    this.opts = opts
    this.cache = cache
    this.inputStream = new Minipass()
    this.inputStream.on('error', er => this.emit('error', er))
    this.inputStream.on('drain', () => this.emit('drain'))
    this.handleContentP = null
  }

  write (chunk, encoding, cb) {
    if (!this.handleContentP) {
      this.handleContentP = handleContent(
        this.inputStream,
        this.cache,
        this.opts
      )
    }
    return this.inputStream.write(chunk, encoding, cb)
  }

  flush (cb) {
    this.inputStream.end(() => {
      if (!this.handleContentP) {
        const e = new Error('Cache input stream was empty')
        e.code = 'ENODATA'
        // empty streams are probably emitting end right away.
        // defer this one tick by rejecting a promise on it.
        return Promise.reject(e).catch(cb)
      }
      this.handleContentP.then(
        (res) => {
          res.integrity && this.emit('integrity', res.integrity)
          res.size !== null && this.emit('size', res.size)
          cb()
        },
        (er) => cb(er)
      )
    })
  }
}

function writeStream (cache, opts = {}) {
  return new CacacheWriteStream(cache, opts)
}

function handleContent (inputStream, cache, opts) {
  return disposer(makeTmp(cache, opts), makeTmpDisposer, (tmp) => {
    return pipeToTmp(inputStream, cache, tmp.target, opts)
      .then((res) => {
        return moveToDestination(
          tmp,
          cache,
          res.integrity,
          opts
        ).then(() => res)
      })
  })
}

function pipeToTmp (inputStream, cache, tmpTarget, opts) {
  let integrity
  let size
  const hashStream = ssri.integrityStream({
    integrity: opts.integrity,
    algorithms: opts.algorithms,
    size: opts.size,
  })
  hashStream.on('integrity', i => {
    integrity = i
  })
  hashStream.on('size', s => {
    size = s
  })

  const outStream = new fsm.WriteStream(tmpTarget, {
    flags: 'wx',
  })

  // NB: this can throw if the hashStream has a problem with
  // it, and the data is fully written.  but pipeToTmp is only
  // called in promisory contexts where that is handled.
  const pipeline = new Pipeline(
    inputStream,
    hashStream,
    outStream
  )

  return pipeline.promise()
    .then(() => ({ integrity, size }))
    .catch(er => rimraf(tmpTarget).then(() => {
      throw er
    }))
}

function makeTmp (cache, opts) {
  const tmpTarget = uniqueFilename(path.join(cache, 'tmp'), opts.tmpPrefix)
  return fixOwner.mkdirfix(cache, path.dirname(tmpTarget)).then(() => ({
    target: tmpTarget,
    moved: false,
  }))
}

function makeTmpDisposer (tmp) {
  if (tmp.moved)
    return Promise.resolve()

  return rimraf(tmp.target)
}

function moveToDestination (tmp, cache, sri, opts) {
  const destination = contentPath(cache, sri)
  const destDir = path.dirname(destination)

  return fixOwner
    .mkdirfix(cache, destDir)
    .then(() => {
      return moveFile(tmp.target, destination)
    })
    .then(() => {
      tmp.moved = true
      return fixOwner.chownr(cache, destination)
    })
}

function sizeError (expected, found) {
  const err = new Error(`Bad data size: expected inserted data to be ${expected} bytes, but got ${found} instead`)
  err.expected = expected
  err.found = found
  err.code = 'EBADSIZE'
  return err
}

function checksumError (expected, found) {
  const err = new Error(`Integrity check failed:
  Wanted: ${expected}
   Found: ${found}`)
  err.code = 'EINTEGRITY'
  err.expected = expected
  err.found = found
  return err
}

}, function(modId) { var map = {"./path":1775127000395,"../util/fix-owner":1775127000398,"../util/move-file":1775127000404,"path":1775127000395,"./../util/disposer":1775127000394}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000404, function(require, module, exports) {


const fs = require('fs')
const util = require('util')
const chmod = util.promisify(fs.chmod)
const unlink = util.promisify(fs.unlink)
const stat = util.promisify(fs.stat)
const move = require('@npmcli/move-file')
const pinflight = require('promise-inflight')

module.exports = moveFile

function moveFile (src, dest) {
  const isWindows = global.__CACACHE_TEST_FAKE_WINDOWS__ ||
    process.platform === 'win32'

  // This isn't quite an fs.rename -- the assumption is that
  // if `dest` already exists, and we get certain errors while
  // trying to move it, we should just not bother.
  //
  // In the case of cache corruption, users will receive an
  // EINTEGRITY error elsewhere, and can remove the offending
  // content their own way.
  //
  // Note that, as the name suggests, this strictly only supports file moves.
  return new Promise((resolve, reject) => {
    fs.link(src, dest, (err) => {
      if (err) {
        if (isWindows && err.code === 'EPERM') {
          // XXX This is a really weird way to handle this situation, as it
          // results in the src file being deleted even though the dest
          // might not exist.  Since we pretty much always write files to
          // deterministic locations based on content hash, this is likely
          // ok (or at worst, just ends in a future cache miss).  But it would
          // be worth investigating at some time in the future if this is
          // really what we want to do here.
          return resolve()
        } else if (err.code === 'EEXIST' || err.code === 'EBUSY') {
          // file already exists, so whatever
          return resolve()
        } else
          return reject(err)
      } else
        return resolve()
    })
  })
    .then(() => {
      // content should never change for any reason, so make it read-only
      return Promise.all([
        unlink(src),
        !isWindows && chmod(dest, '0444'),
      ])
    })
    .catch(() => {
      return pinflight('cacache-move-file:' + dest, () => {
        return stat(dest).catch((err) => {
          if (err.code !== 'ENOENT') {
            // Something else is wrong here. Bail bail bail
            throw err
          }
          // file doesn't already exist! let's try a rename -> copy fallback
          // only delete if it successfully copies
          return move(src, dest)
        })
      })
    })
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000405, function(require, module, exports) {


const util = require('util')

const index = require('./lib/entry-index')
const memo = require('./lib/memoization')
const path = require('path')
const rimraf = util.promisify(require('rimraf'))
const rmContent = require('./lib/content/rm')

module.exports = entry
module.exports.entry = entry

function entry (cache, key, opts) {
  memo.clearMemoized()
  return index.delete(cache, key, opts)
}

module.exports.content = content

function content (cache, integrity) {
  memo.clearMemoized()
  return rmContent(cache, integrity)
}

module.exports.all = all

function all (cache) {
  memo.clearMemoized()
  return rimraf(path.join(cache, '*(content-*|index-*)'))
}

}, function(modId) { var map = {"./lib/entry-index":1775127000393,"./lib/memoization":1775127000400,"./lib/content/rm":1775127000406}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000406, function(require, module, exports) {


const util = require('util')

const contentPath = require('./path')
const { hasContent } = require('./read')
const rimraf = util.promisify(require('rimraf'))

module.exports = rm

function rm (cache, integrity) {
  return hasContent(cache, integrity).then((content) => {
    // ~pretty~ sure we can't end up with a content lacking sri, but be safe
    if (content && content.sri)
      return rimraf(contentPath(cache, content.sri)).then(() => true)
    else
      return false
  })
}

}, function(modId) { var map = {"./path":1775127000395,"./read":1775127000401}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000407, function(require, module, exports) {


module.exports = require('./lib/verify')

}, function(modId) { var map = {"./lib/verify":1775127000408}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000408, function(require, module, exports) {


const util = require('util')

const pMap = require('p-map')
const contentPath = require('./content/path')
const fixOwner = require('./util/fix-owner')
const fs = require('fs')
const fsm = require('fs-minipass')
const glob = util.promisify(require('glob'))
const index = require('./entry-index')
const path = require('path')
const rimraf = util.promisify(require('rimraf'))
const ssri = require('ssri')

const hasOwnProperty = (obj, key) =>
  Object.prototype.hasOwnProperty.call(obj, key)

const stat = util.promisify(fs.stat)
const truncate = util.promisify(fs.truncate)
const writeFile = util.promisify(fs.writeFile)
const readFile = util.promisify(fs.readFile)

const verifyOpts = (opts) => ({
  concurrency: 20,
  log: { silly () {} },
  ...opts,
})

module.exports = verify

function verify (cache, opts) {
  opts = verifyOpts(opts)
  opts.log.silly('verify', 'verifying cache at', cache)

  const steps = [
    markStartTime,
    fixPerms,
    garbageCollect,
    rebuildIndex,
    cleanTmp,
    writeVerifile,
    markEndTime,
  ]

  return steps
    .reduce((promise, step, i) => {
      const label = step.name
      const start = new Date()
      return promise.then((stats) => {
        return step(cache, opts).then((s) => {
          s &&
            Object.keys(s).forEach((k) => {
              stats[k] = s[k]
            })
          const end = new Date()
          if (!stats.runTime)
            stats.runTime = {}

          stats.runTime[label] = end - start
          return Promise.resolve(stats)
        })
      })
    }, Promise.resolve({}))
    .then((stats) => {
      stats.runTime.total = stats.endTime - stats.startTime
      opts.log.silly(
        'verify',
        'verification finished for',
        cache,
        'in',
        `${stats.runTime.total}ms`
      )
      return stats
    })
}

function markStartTime (cache, opts) {
  return Promise.resolve({ startTime: new Date() })
}

function markEndTime (cache, opts) {
  return Promise.resolve({ endTime: new Date() })
}

function fixPerms (cache, opts) {
  opts.log.silly('verify', 'fixing cache permissions')
  return fixOwner
    .mkdirfix(cache, cache)
    .then(() => {
      // TODO - fix file permissions too
      return fixOwner.chownr(cache, cache)
    })
    .then(() => null)
}

// Implements a naive mark-and-sweep tracing garbage collector.
//
// The algorithm is basically as follows:
// 1. Read (and filter) all index entries ("pointers")
// 2. Mark each integrity value as "live"
// 3. Read entire filesystem tree in `content-vX/` dir
// 4. If content is live, verify its checksum and delete it if it fails
// 5. If content is not marked as live, rimraf it.
//
function garbageCollect (cache, opts) {
  opts.log.silly('verify', 'garbage collecting content')
  const indexStream = index.lsStream(cache)
  const liveContent = new Set()
  indexStream.on('data', (entry) => {
    if (opts.filter && !opts.filter(entry))
      return

    liveContent.add(entry.integrity.toString())
  })
  return new Promise((resolve, reject) => {
    indexStream.on('end', resolve).on('error', reject)
  }).then(() => {
    const contentDir = contentPath.contentDir(cache)
    return glob(path.join(contentDir, '**'), {
      follow: false,
      nodir: true,
      nosort: true,
    }).then((files) => {
      return Promise.resolve({
        verifiedContent: 0,
        reclaimedCount: 0,
        reclaimedSize: 0,
        badContentCount: 0,
        keptSize: 0,
      }).then((stats) =>
        pMap(
          files,
          (f) => {
            const split = f.split(/[/\\]/)
            const digest = split.slice(split.length - 3).join('')
            const algo = split[split.length - 4]
            const integrity = ssri.fromHex(digest, algo)
            if (liveContent.has(integrity.toString())) {
              return verifyContent(f, integrity).then((info) => {
                if (!info.valid) {
                  stats.reclaimedCount++
                  stats.badContentCount++
                  stats.reclaimedSize += info.size
                } else {
                  stats.verifiedContent++
                  stats.keptSize += info.size
                }
                return stats
              })
            } else {
              // No entries refer to this content. We can delete.
              stats.reclaimedCount++
              return stat(f).then((s) => {
                return rimraf(f).then(() => {
                  stats.reclaimedSize += s.size
                  return stats
                })
              })
            }
          },
          { concurrency: opts.concurrency }
        ).then(() => stats)
      )
    })
  })
}

function verifyContent (filepath, sri) {
  return stat(filepath)
    .then((s) => {
      const contentInfo = {
        size: s.size,
        valid: true,
      }
      return ssri
        .checkStream(new fsm.ReadStream(filepath), sri)
        .catch((err) => {
          if (err.code !== 'EINTEGRITY')
            throw err

          return rimraf(filepath).then(() => {
            contentInfo.valid = false
          })
        })
        .then(() => contentInfo)
    })
    .catch((err) => {
      if (err.code === 'ENOENT')
        return { size: 0, valid: false }

      throw err
    })
}

function rebuildIndex (cache, opts) {
  opts.log.silly('verify', 'rebuilding index')
  return index.ls(cache).then((entries) => {
    const stats = {
      missingContent: 0,
      rejectedEntries: 0,
      totalEntries: 0,
    }
    const buckets = {}
    for (const k in entries) {
      /* istanbul ignore else */
      if (hasOwnProperty(entries, k)) {
        const hashed = index.hashKey(k)
        const entry = entries[k]
        const excluded = opts.filter && !opts.filter(entry)
        excluded && stats.rejectedEntries++
        if (buckets[hashed] && !excluded)
          buckets[hashed].push(entry)
        else if (buckets[hashed] && excluded) {
          // skip
        } else if (excluded) {
          buckets[hashed] = []
          buckets[hashed]._path = index.bucketPath(cache, k)
        } else {
          buckets[hashed] = [entry]
          buckets[hashed]._path = index.bucketPath(cache, k)
        }
      }
    }
    return pMap(
      Object.keys(buckets),
      (key) => {
        return rebuildBucket(cache, buckets[key], stats, opts)
      },
      { concurrency: opts.concurrency }
    ).then(() => stats)
  })
}

function rebuildBucket (cache, bucket, stats, opts) {
  return truncate(bucket._path).then(() => {
    // This needs to be serialized because cacache explicitly
    // lets very racy bucket conflicts clobber each other.
    return bucket.reduce((promise, entry) => {
      return promise.then(() => {
        const content = contentPath(cache, entry.integrity)
        return stat(content)
          .then(() => {
            return index
              .insert(cache, entry.key, entry.integrity, {
                metadata: entry.metadata,
                size: entry.size,
              })
              .then(() => {
                stats.totalEntries++
              })
          })
          .catch((err) => {
            if (err.code === 'ENOENT') {
              stats.rejectedEntries++
              stats.missingContent++
              return
            }
            throw err
          })
      })
    }, Promise.resolve())
  })
}

function cleanTmp (cache, opts) {
  opts.log.silly('verify', 'cleaning tmp directory')
  return rimraf(path.join(cache, 'tmp'))
}

function writeVerifile (cache, opts) {
  const verifile = path.join(cache, '_lastverified')
  opts.log.silly('verify', 'writing verifile to ' + verifile)
  try {
    return writeFile(verifile, '' + +new Date())
  } finally {
    fixOwner.chownr.sync(cache, verifile)
  }
}

module.exports.lastRun = lastRun

function lastRun (cache) {
  return readFile(path.join(cache, '_lastverified'), 'utf8').then(
    (data) => new Date(+data)
  )
}

}, function(modId) { var map = {"./content/path":1775127000395,"./util/fix-owner":1775127000398,"./entry-index":1775127000393}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000409, function(require, module, exports) {


const fs = require('@npmcli/fs')

const fixOwner = require('./fix-owner')
const path = require('path')

module.exports.mkdir = mktmpdir

function mktmpdir (cache, opts = {}) {
  const { tmpPrefix } = opts
  const tmpDir = path.join(cache, 'tmp')
  return fs.mkdir(tmpDir, { recursive: true, owner: 'inherit' })
    .then(() => {
      // do not use path.join(), it drops the trailing / if tmpPrefix is unset
      const target = `${tmpDir}${path.sep}${tmpPrefix || ''}`
      return fs.mkdtemp(target, { owner: 'inherit' })
    })
}

module.exports.withTmp = withTmp

function withTmp (cache, opts, cb) {
  if (!cb) {
    cb = opts
    opts = {}
  }
  return fs.withTempDir(path.join(cache, 'tmp'), cb, opts)
}

module.exports.fix = fixtmpdir

function fixtmpdir (cache) {
  return fixOwner(cache, path.join(cache, 'tmp'))
}

}, function(modId) { var map = {"./fix-owner":1775127000398}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1775127000391);
})()
//miniprogram-npm-outsideDeps=["util","crypto","fs","minipass","path","ssri","unique-filename","@npmcli/move-file","rimraf","chownr","mkdirp","promise-inflight","infer-owner","minipass-collect","minipass-pipeline","lru-cache","fs-minipass","minipass-flush","p-map","glob","@npmcli/fs"]
//# sourceMappingURL=index.js.map