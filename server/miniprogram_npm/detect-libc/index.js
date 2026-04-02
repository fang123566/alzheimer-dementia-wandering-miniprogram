module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1775127000437, function(require, module, exports) {
// Copyright 2017 Lovell Fuller and others.
// SPDX-License-Identifier: Apache-2.0



const childProcess = require('child_process');
const { isLinux, getReport } = require('./process');
const { LDD_PATH, SELF_PATH, readFile, readFileSync } = require('./filesystem');
const { interpreterPath } = require('./elf');

let cachedFamilyInterpreter;
let cachedFamilyFilesystem;
let cachedVersionFilesystem;

const command = 'getconf GNU_LIBC_VERSION 2>&1 || true; ldd --version 2>&1 || true';
let commandOut = '';

const safeCommand = () => {
  if (!commandOut) {
    return new Promise((resolve) => {
      childProcess.exec(command, (err, out) => {
        commandOut = err ? ' ' : out;
        resolve(commandOut);
      });
    });
  }
  return commandOut;
};

const safeCommandSync = () => {
  if (!commandOut) {
    try {
      commandOut = childProcess.execSync(command, { encoding: 'utf8' });
    } catch (_err) {
      commandOut = ' ';
    }
  }
  return commandOut;
};

/**
 * A String constant containing the value `glibc`.
 * @type {string}
 * @public
 */
const GLIBC = 'glibc';

/**
 * A Regexp constant to get the GLIBC Version.
 * @type {string}
 */
const RE_GLIBC_VERSION = /LIBC[a-z0-9 \-).]*?(\d+\.\d+)/i;

/**
 * A String constant containing the value `musl`.
 * @type {string}
 * @public
 */
const MUSL = 'musl';

const isFileMusl = (f) => f.includes('libc.musl-') || f.includes('ld-musl-');

const familyFromReport = () => {
  const report = getReport();
  if (report.header && report.header.glibcVersionRuntime) {
    return GLIBC;
  }
  if (Array.isArray(report.sharedObjects)) {
    if (report.sharedObjects.some(isFileMusl)) {
      return MUSL;
    }
  }
  return null;
};

const familyFromCommand = (out) => {
  const [getconf, ldd1] = out.split(/[\r\n]+/);
  if (getconf && getconf.includes(GLIBC)) {
    return GLIBC;
  }
  if (ldd1 && ldd1.includes(MUSL)) {
    return MUSL;
  }
  return null;
};

const familyFromInterpreterPath = (path) => {
  if (path) {
    if (path.includes('/ld-musl-')) {
      return MUSL;
    } else if (path.includes('/ld-linux-')) {
      return GLIBC;
    }
  }
  return null;
};

const getFamilyFromLddContent = (content) => {
  content = content.toString();
  if (content.includes('musl')) {
    return MUSL;
  }
  if (content.includes('GNU C Library')) {
    return GLIBC;
  }
  return null;
};

const familyFromFilesystem = async () => {
  if (cachedFamilyFilesystem !== undefined) {
    return cachedFamilyFilesystem;
  }
  cachedFamilyFilesystem = null;
  try {
    const lddContent = await readFile(LDD_PATH);
    cachedFamilyFilesystem = getFamilyFromLddContent(lddContent);
  } catch (e) {}
  return cachedFamilyFilesystem;
};

const familyFromFilesystemSync = () => {
  if (cachedFamilyFilesystem !== undefined) {
    return cachedFamilyFilesystem;
  }
  cachedFamilyFilesystem = null;
  try {
    const lddContent = readFileSync(LDD_PATH);
    cachedFamilyFilesystem = getFamilyFromLddContent(lddContent);
  } catch (e) {}
  return cachedFamilyFilesystem;
};

const familyFromInterpreter = async () => {
  if (cachedFamilyInterpreter !== undefined) {
    return cachedFamilyInterpreter;
  }
  cachedFamilyInterpreter = null;
  try {
    const selfContent = await readFile(SELF_PATH);
    const path = interpreterPath(selfContent);
    cachedFamilyInterpreter = familyFromInterpreterPath(path);
  } catch (e) {}
  return cachedFamilyInterpreter;
};

const familyFromInterpreterSync = () => {
  if (cachedFamilyInterpreter !== undefined) {
    return cachedFamilyInterpreter;
  }
  cachedFamilyInterpreter = null;
  try {
    const selfContent = readFileSync(SELF_PATH);
    const path = interpreterPath(selfContent);
    cachedFamilyInterpreter = familyFromInterpreterPath(path);
  } catch (e) {}
  return cachedFamilyInterpreter;
};

/**
 * Resolves with the libc family when it can be determined, `null` otherwise.
 * @returns {Promise<?string>}
 */
const family = async () => {
  let family = null;
  if (isLinux()) {
    family = await familyFromInterpreter();
    if (!family) {
      family = await familyFromFilesystem();
      if (!family) {
        family = familyFromReport();
      }
      if (!family) {
        const out = await safeCommand();
        family = familyFromCommand(out);
      }
    }
  }
  return family;
};

/**
 * Returns the libc family when it can be determined, `null` otherwise.
 * @returns {?string}
 */
const familySync = () => {
  let family = null;
  if (isLinux()) {
    family = familyFromInterpreterSync();
    if (!family) {
      family = familyFromFilesystemSync();
      if (!family) {
        family = familyFromReport();
      }
      if (!family) {
        const out = safeCommandSync();
        family = familyFromCommand(out);
      }
    }
  }
  return family;
};

/**
 * Resolves `true` only when the platform is Linux and the libc family is not `glibc`.
 * @returns {Promise<boolean>}
 */
const isNonGlibcLinux = async () => isLinux() && await family() !== GLIBC;

/**
 * Returns `true` only when the platform is Linux and the libc family is not `glibc`.
 * @returns {boolean}
 */
const isNonGlibcLinuxSync = () => isLinux() && familySync() !== GLIBC;

const versionFromFilesystem = async () => {
  if (cachedVersionFilesystem !== undefined) {
    return cachedVersionFilesystem;
  }
  cachedVersionFilesystem = null;
  try {
    const lddContent = await readFile(LDD_PATH);
    const versionMatch = lddContent.match(RE_GLIBC_VERSION);
    if (versionMatch) {
      cachedVersionFilesystem = versionMatch[1];
    }
  } catch (e) {}
  return cachedVersionFilesystem;
};

const versionFromFilesystemSync = () => {
  if (cachedVersionFilesystem !== undefined) {
    return cachedVersionFilesystem;
  }
  cachedVersionFilesystem = null;
  try {
    const lddContent = readFileSync(LDD_PATH);
    const versionMatch = lddContent.match(RE_GLIBC_VERSION);
    if (versionMatch) {
      cachedVersionFilesystem = versionMatch[1];
    }
  } catch (e) {}
  return cachedVersionFilesystem;
};

const versionFromReport = () => {
  const report = getReport();
  if (report.header && report.header.glibcVersionRuntime) {
    return report.header.glibcVersionRuntime;
  }
  return null;
};

const versionSuffix = (s) => s.trim().split(/\s+/)[1];

const versionFromCommand = (out) => {
  const [getconf, ldd1, ldd2] = out.split(/[\r\n]+/);
  if (getconf && getconf.includes(GLIBC)) {
    return versionSuffix(getconf);
  }
  if (ldd1 && ldd2 && ldd1.includes(MUSL)) {
    return versionSuffix(ldd2);
  }
  return null;
};

/**
 * Resolves with the libc version when it can be determined, `null` otherwise.
 * @returns {Promise<?string>}
 */
const version = async () => {
  let version = null;
  if (isLinux()) {
    version = await versionFromFilesystem();
    if (!version) {
      version = versionFromReport();
    }
    if (!version) {
      const out = await safeCommand();
      version = versionFromCommand(out);
    }
  }
  return version;
};

/**
 * Returns the libc version when it can be determined, `null` otherwise.
 * @returns {?string}
 */
const versionSync = () => {
  let version = null;
  if (isLinux()) {
    version = versionFromFilesystemSync();
    if (!version) {
      version = versionFromReport();
    }
    if (!version) {
      const out = safeCommandSync();
      version = versionFromCommand(out);
    }
  }
  return version;
};

module.exports = {
  GLIBC,
  MUSL,
  family,
  familySync,
  isNonGlibcLinux,
  isNonGlibcLinuxSync,
  version,
  versionSync
};

}, function(modId) {var map = {"./process":1775127000438,"./filesystem":1775127000439,"./elf":1775127000440}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000438, function(require, module, exports) {
// Copyright 2017 Lovell Fuller and others.
// SPDX-License-Identifier: Apache-2.0



const isLinux = () => process.platform === 'linux';

let report = null;
const getReport = () => {
  if (!report) {
    /* istanbul ignore next */
    if (isLinux() && process.report) {
      const orig = process.report.excludeNetwork;
      process.report.excludeNetwork = true;
      report = process.report.getReport();
      process.report.excludeNetwork = orig;
    } else {
      report = {};
    }
  }
  return report;
};

module.exports = { isLinux, getReport };

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000439, function(require, module, exports) {
// Copyright 2017 Lovell Fuller and others.
// SPDX-License-Identifier: Apache-2.0



const fs = require('fs');

const LDD_PATH = '/usr/bin/ldd';
const SELF_PATH = '/proc/self/exe';
const MAX_LENGTH = 2048;

/**
 * Read the content of a file synchronous
 *
 * @param {string} path
 * @returns {Buffer}
 */
const readFileSync = (path) => {
  const fd = fs.openSync(path, 'r');
  const buffer = Buffer.alloc(MAX_LENGTH);
  const bytesRead = fs.readSync(fd, buffer, 0, MAX_LENGTH, 0);
  fs.close(fd, () => {});
  return buffer.subarray(0, bytesRead);
};

/**
 * Read the content of a file
 *
 * @param {string} path
 * @returns {Promise<Buffer>}
 */
const readFile = (path) => new Promise((resolve, reject) => {
  fs.open(path, 'r', (err, fd) => {
    if (err) {
      reject(err);
    } else {
      const buffer = Buffer.alloc(MAX_LENGTH);
      fs.read(fd, buffer, 0, MAX_LENGTH, 0, (_, bytesRead) => {
        resolve(buffer.subarray(0, bytesRead));
        fs.close(fd, () => {});
      });
    }
  });
});

module.exports = {
  LDD_PATH,
  SELF_PATH,
  readFileSync,
  readFile
};

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1775127000440, function(require, module, exports) {
// Copyright 2017 Lovell Fuller and others.
// SPDX-License-Identifier: Apache-2.0



const interpreterPath = (elf) => {
  if (elf.length < 64) {
    return null;
  }
  if (elf.readUInt32BE(0) !== 0x7F454C46) {
    // Unexpected magic bytes
    return null;
  }
  if (elf.readUInt8(4) !== 2) {
    // Not a 64-bit ELF
    return null;
  }
  if (elf.readUInt8(5) !== 1) {
    // Not little-endian
    return null;
  }
  const offset = elf.readUInt32LE(32);
  const size = elf.readUInt16LE(54);
  const count = elf.readUInt16LE(56);
  for (let i = 0; i < count; i++) {
    const headerOffset = offset + (i * size);
    const type = elf.readUInt32LE(headerOffset);
    if (type === 3) {
      const fileOffset = elf.readUInt32LE(headerOffset + 8);
      const fileSize = elf.readUInt32LE(headerOffset + 32);
      return elf.subarray(fileOffset, fileOffset + fileSize).toString().replace(/\0.*$/g, '');
    }
  }
  return null;
};

module.exports = {
  interpreterPath
};

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1775127000437);
})()
//miniprogram-npm-outsideDeps=["child_process","fs"]
//# sourceMappingURL=index.js.map