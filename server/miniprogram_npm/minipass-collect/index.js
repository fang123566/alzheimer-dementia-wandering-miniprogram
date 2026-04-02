module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1775127000618, function(require, module, exports) {
const Minipass = require('minipass')
const _data = Symbol('_data')
const _length = Symbol('_length')
class Collect extends Minipass {
  constructor (options) {
    super(options)
    this[_data] = []
    this[_length] = 0
  }
  write (chunk, encoding, cb) {
    if (typeof encoding === 'function')
      cb = encoding, encoding = 'utf8'

    if (!encoding)
      encoding = 'utf8'

    const c = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    this[_data].push(c)
    this[_length] += c.length
    if (cb)
      cb()
    return true
  }
  end (chunk, encoding, cb) {
    if (typeof chunk === 'function')
      cb = chunk, chunk = null
    if (typeof encoding === 'function')
      cb = encoding, encoding = 'utf8'
    if (chunk)
      this.write(chunk, encoding)
    const result = Buffer.concat(this[_data], this[_length])
    super.write(result)
    return super.end(cb)
  }
}
module.exports = Collect

// it would be possible to DRY this a bit by doing something like
// this.collector = new Collect() and listening on its data event,
// but it's not much code, and we may as well save the extra obj
class CollectPassThrough extends Minipass {
  constructor (options) {
    super(options)
    this[_data] = []
    this[_length] = 0
  }
  write (chunk, encoding, cb) {
    if (typeof encoding === 'function')
      cb = encoding, encoding = 'utf8'

    if (!encoding)
      encoding = 'utf8'

    const c = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    this[_data].push(c)
    this[_length] += c.length
    return super.write(chunk, encoding, cb)
  }
  end (chunk, encoding, cb) {
    if (typeof chunk === 'function')
      cb = chunk, chunk = null
    if (typeof encoding === 'function')
      cb = encoding, encoding = 'utf8'
    if (chunk)
      this.write(chunk, encoding)
    const result = Buffer.concat(this[_data], this[_length])
    this.emit('collect', result)
    return super.end(cb)
  }
}
module.exports.PassThrough = CollectPassThrough

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1775127000618);
})()
//miniprogram-npm-outsideDeps=["minipass"]
//# sourceMappingURL=index.js.map