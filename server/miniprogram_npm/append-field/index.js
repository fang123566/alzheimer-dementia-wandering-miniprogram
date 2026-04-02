module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1775127000325, function(require, module, exports) {
var parsePath = require('./lib/parse-path')
var setValue = require('./lib/set-value')

function appendField (store, key, value) {
  var steps = parsePath(key)

  steps.reduce(function (context, step) {
    return setValue(context, step, context[step.key], value)
  }, store)
}

module.exports = appendField

}, function(modId) {var map = {"./lib/parse-path":1775127000326,"./lib/set-value":1775127000327}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000326, function(require, module, exports) {
var reFirstKey = /^[^\[]*/
var reDigitPath = /^\[(\d+)\]/
var reNormalPath = /^\[([^\]]+)\]/

function parsePath (key) {
  function failure () {
    return [{ type: 'object', key: key, last: true }]
  }

  var firstKey = reFirstKey.exec(key)[0]
  if (!firstKey) return failure()

  var len = key.length
  var pos = firstKey.length
  var tail = { type: 'object', key: firstKey }
  var steps = [tail]

  while (pos < len) {
    var m

    if (key[pos] === '[' && key[pos + 1] === ']') {
      pos += 2
      tail.append = true
      if (pos !== len) return failure()
      continue
    }

    m = reDigitPath.exec(key.substring(pos))
    if (m !== null) {
      pos += m[0].length
      tail.nextType = 'array'
      tail = { type: 'array', key: parseInt(m[1], 10) }
      steps.push(tail)
      continue
    }

    m = reNormalPath.exec(key.substring(pos))
    if (m !== null) {
      pos += m[0].length
      tail.nextType = 'object'
      tail = { type: 'object', key: m[1] }
      steps.push(tail)
      continue
    }

    return failure()
  }

  tail.last = true
  return steps
}

module.exports = parsePath

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000327, function(require, module, exports) {
function valueType (value) {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return 'scalar'
}

function setLastValue (context, step, currentValue, entryValue) {
  switch (valueType(currentValue)) {
    case 'undefined':
      if (step.append) {
        context[step.key] = [entryValue]
      } else {
        context[step.key] = entryValue
      }
      break
    case 'array':
      context[step.key].push(entryValue)
      break
    case 'object':
      return setLastValue(currentValue, { type: 'object', key: '', last: true }, currentValue[''], entryValue)
    case 'scalar':
      context[step.key] = [context[step.key], entryValue]
      break
  }

  return context
}

function setValue (context, step, currentValue, entryValue) {
  if (step.last) return setLastValue(context, step, currentValue, entryValue)

  var obj
  switch (valueType(currentValue)) {
    case 'undefined':
      if (step.nextType === 'array') {
        context[step.key] = []
      } else {
        context[step.key] = Object.create(null)
      }
      return context[step.key]
    case 'object':
      return context[step.key]
    case 'array':
      if (step.nextType === 'array') {
        return currentValue
      }

      obj = Object.create(null)
      context[step.key] = obj
      currentValue.forEach(function (item, i) {
        if (item !== undefined) obj['' + i] = item
      })

      return obj
    case 'scalar':
      obj = Object.create(null)
      obj[''] = currentValue
      context[step.key] = obj
      return obj
  }
}

module.exports = setValue

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1775127000325);
})()
//miniprogram-npm-outsideDeps=[]
//# sourceMappingURL=index.js.map