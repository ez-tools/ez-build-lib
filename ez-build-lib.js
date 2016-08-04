#!/usr/bin/env node --harmony

var program = require('commander')
var packageJson = require('./package.json')
var path = require('path').posix
var fs = require('fs')
var rollup = require('rollup')
var commonjs = require('rollup-plugin-commonjs')
var nodeResolve = require('rollup-plugin-node-resolve')
var globals = require('rollup-plugin-node-globals')
var builtins = require('rollup-plugin-node-builtins')
var json = require('rollup-plugin-json')
var babel = require('rollup-plugin-babel')
var uglify = require('rollup-plugin-uglify')
var writeJsonFile = require('write-json-file')
var semver = require('semver')
var loadJsonFile = require('load-json-file')
var exec = require('child_process').exec

process.on('uncaughtException', function (err) {
  console.error('An exception was thrown: ', err)
})

function exit (err) {
  console.error(err)
  process.exit(1)
}

program
  .version(packageJson.version)
  .description(packageJson.description)

program.on('--help', function () {
  console.log(`
  Example:

    $ ez-build-lib init ./src/test.js

    Updated package.json:

    ..
      "main": "./dist/test.cjs.js",
      "jsnext:main": "./dist/test.mjs",
      "browser": "./dist/test.umd.js",
      "scripts": {
        "lint": "standard",
        "build": "ez-build-lib build src/test.js",
        "build:watch": "ez-build-lib watch src/test.js",
        "publish": "npm run lint && npm run build && ez-build-lib publish ."
        ..
      }
    ..

    Updated bower.json:

    ..
      "main": "./dist/test.umd.js"
    ..

    Updated .gitignore

    ..
      ./dist/
    ..

    It is encouraged to use \`npm run <cmd>\` from now on:

    $ npm run build
    $ npm run build:watch % for development

  `)
})

program
  .command('init <entry>')
  .description('Sets reasonable properties in the package.json, .gitignore, and bower.json files (optional)')
  .action(async(function * (getCallback, entry, options) {
    var [err, [dir, p]] = yield getPackageJson(entry)
    entry = path.relative(dir, path.resolve(entry)) // convert e.g. absolute paths to relative ones
    p.main = `./dist/${p.name}.cjs.js`
    p['jsnext:main'] = entry // `./dist/${p.name}.mjs`
    p['browser'] = `./dist/${p.name}.umd.js`
    if (p.scripts == null) {
      p.scripts = {}
    }
    p.scripts.build = `ez-build-lib build ${entry}`
    p.scripts['build:watch'] = `ez-build-lib build:watch ${entry}`
    p.scripts['publish'] = 'npm run lint && npm run build && ez-build-lib publish .'

    ;[err] = yield writeJsonFile(path.join(dir, 'package.json'), p, { indent: 2 })
    if (err != null) exit(err)

    // try to get bower.json
    var bowerPath = path.join(dir, 'bower.json')
    ;[err] = yield fs.access(bowerPath, fs.F_OK, getCallback())
    if (!err) {
      var bower
      ;[err, bower] = yield loadJsonFile(bowerPath)
      if (err) exit(err)
      bower.main = p.browser // the umd module
      ;[err] = yield writeJsonFile(bowerPath, bower, { indent: 2 })
      if (err != null) exit(err)
    } else {
      console.warn('You did not specify a bower.json file.')
    }

    // set .gitignore
    var gitignorePath = path.join(dir, '.gitignore')
    var gitignore
    ;[err, gitignore] = yield fs.readFile(gitignorePath, 'utf8', getCallback())
    if (gitignore == null || gitignore.split('\n').every(function (line) { return line !== './dist' })) {
      gitignore = 'dist\n' + (gitignore || '')
      ;[err] = yield fs.writeFile(gitignorePath, gitignore, getCallback())
      if (err) exit(err)
    }
  }))

program
  .command('build <entry>')
  .description('Builds your project')
  .action(function (entry, options) {
    computeConfig(entry).then(function (config) {
      runBuildCjs(config)
      runBuildUmd(config)
    })
  })

program
  .command('build:watch')
  .description('Builds the project whenever a file changes')

program
  .command('publish <dir>')
  .description('Publish the project including distribution files:\n               Build > version bump > commit > create git tag > publish to npm ')
  .action(async(function * (getCallback, dir) {
    var rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    })
    dir = path.resolve(dir)
    var [err, p] = yield loadJsonFile(path.join(dir, 'package.json'))
    if (err) exit('package.json does not exist in this directory!')

    // ask for version increment type
    var validTypes = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease']
    var [type] = yield rl.question(`How do you want to increment the version? [${validTypes.join('|')}]\n=>`, getCallback())

    var validType = validTypes.some(function (t) { return t === type })

    if (validType) {
      p.version = semver.inc(p.version, type, 'alpha')
      if (p.version == null) exit('Invalid semver version in package.json!')
    } else {
      exit('You must choose one of of these: ' + validTypes.join(' | '))
    }

    var [message] = yield rl.question(`Insert the release message (press double enter to continue)\n=>`, getCallback())
    var input = message
    while (input !== '') {
      ;[input] = yield rl.question('..', getCallback())
      message = message + '\n' + input
    }

    // ask user if sHe really want's to publish
    var [answer] = yield rl.question(`Publishing version ${p.version}. Message: ${message}. Okay? [y|N]\n=>`, getCallback())
    if (['y', 'Y', 'yes'].every(function (a) { return a !== answer })) {
      exit('Interrupt publish')
    }

    // update package.json
    [err] = yield writeJsonFile(path.join(dir, 'package.json'), p, { indent: 2 })
    if (err != null) exit(err)

    // try to update bower.json
    var bowerPath = path.join(dir, 'bower.json')
    ;[err] = yield fs.access(bowerPath, fs.W_OK, getCallback())
    if (!err) {
      var bower
      ;[err, bower] = yield loadJsonFile(bowerPath)
      bower.version = p.version
      ;[err] = yield writeJsonFile(bowerPath, bower, { indent: 2 })
      if (err != null) exit(err)
    }

    var stdout, stderr
    var opts = { cwd: dir }

    // commit remaining changes (changes to package.json & bower.json)
    ;[err, stdout, stderr] = yield exec(`git commit -am "Publish v${p.version}\n\n${message}""`, opts, getCallback())
    if (err) {
      exit(`Unable to commit remaining changes:\n\n${stdout}\n\n${stderr}`)
    } else {
      console.log('✓ Committed remaining changes')
    }

    // push commit
    ;[err, stdout, stderr] = yield exec('git push', opts, getCallback())
    if (err) {
      exit(`Unable to push changes:\n\n${stdout}\n\n${stderr}`)
    } else {
      console.log('✓ Pushed changes')
    }

    // detach head
    ;[err, stdout, stderr] = yield exec('git checkout --detach', opts, getCallback())
    if (err) {
      exit(`Unable to detach head:\n\n${stdout}\n\n${stderr}`)
    } else {
      console.log('✓ Detached head')
    }

    // add dist files (only if dist directory exists)
    ;[err] = yield fs.access(path.join(dir, 'dist'), fs.F_OK, getCallback())
    if (!err) {
      ;[err, stdout, stderr] = yield exec('git add ./dist/* -f', opts, getCallback())
      if (err) {
        exit(`Unable to add dist files:\n\n${stdout}\n\n${stderr}`)
      } else {
        console.log('✓ Added dist files to index')
      }
    }

    // commit dist files
    ;[err, stdout, stderr] = yield exec(`git commit -am "Publish v${p.version} -- added dist files"`, opts, getCallback())
    if (err) {
      exit(`Unable to commit dist files:\n\n${stdout}\n\n${stderr}`)
    } else {
      console.log('✓ Committed dist files')
    }

    // commit dist files
    ;[err, stdout, stderr] = yield exec(`git tag v${p.version} -m "${message}"`, opts, getCallback())
    if (err) {
      exit(`Unable to tag commit:\n\n${stdout}\n\n${stderr}`)
    } else {
      console.log('✓ Tagged release')
    }

    // push tag
    ;[err, stdout, stderr] = yield exec(`git push origin v${p.version}`, opts, getCallback())
    if (err) {
      exit(`Unable to tag commit:\n\n${stdout}\n\n${stderr}`)
    } else {
      console.log('✓ Pushed tag')
    }

    // Publish to npm
    ;[err, stdout, stderr] = yield exec('npm publish', opts, getCallback())
    if (err) {
      console.log('❌ Failed to publish to npm. Please call `npm publish` yourself')
    } else {
      console.log('✓ Published to npm')
    }

    // check out master
    ;[err, stdout, stderr] = yield exec('git checkout master', opts, getCallback())
    if (err) {
      exit(`Unable to checkout branch 'master':\n\n${stdout}\n\n${stderr}`)
    } else {
      console.log('✓ Checked out master branch')
    }
  }))

var cjsBundle = null
var runBuildCjs = function runBuildCjs (config) {
  rollup.rollup({
    entry: config.entry,
    cache: cjsBundle,
    external: config.external
  }).then(function (bundle) {
    cjsBundle = bundle

    bundle.write({
      moduleName: config.name,
      format: 'cjs',
      dest: config.cjs,
      sourceMap: true
    })
  })
}

var umdBundle = null
var runBuildUmd = function runBuildUmd (config) {
  rollup.rollup({
    entry: config.entry,
    cache: umdBundle,
    plugins: [
      builtins(),
      nodeResolve({
        // preferBuiltins: false,
        jsnext: true,
        main: true,
        browser: true
      }),
      commonjs({
        ignoreGlobal: true
      }),
      globals(),
      json(),
      babel({
        exclude: 'node_modules/**',
        presets: ['es2015-rollup'],
        babelrc: false
      }),
      uglify()
    ]
  }).then(function (bundle) {
    umdBundle = bundle
    bundle.write({
      moduleName: config.name,
      format: 'umd',
      dest: config.umd,
      sourceMap: true
    })
  })
}

function computeConfig (entry) {
  return getPackageJson(entry).then(function ([dir, p]) {
    if (p.main == null) {
      exit('You must specify the `main` property in your package.json!')
    }

    // all dependencies are external modules (exclude them in cjs builds)
    var external = []
    for (var name in p.dependencies) {
      external.push(name)
    }

    return Promise.resolve({
      name: p.name,
      entry: entry,
      cjs: path.join(dir, p.main),
      umd: path.join(dir, p['browser']),
      external: external
    })
  })
}

var getPackageJson = async(function * (getCallback, entry) {
  var dir = path.resolve(path.dirname(entry))

  while (true) {
    var [err] = yield fs.access(dir, fs.F_OK, getCallback())
    if (!err) {
      var pDir = path.join(dir, 'package.json')
      ;[err] = yield fs.access(pDir, fs.F_OK, getCallback())
      if (!err) {
        var p
        ;[err, p] = yield loadJsonFile(pDir)
        if (err) exit(err)
        return [dir, p]
      } else {
        dir = path.join(dir, '..')
      }
    } else exit('You need to specify a package.json file!')
  }
})

function async (generator) {
  return function () {
    var args = Array.prototype.slice.call(arguments)
    return new Promise(function (resolve, reject) {
      function getCallback (name) {
        callbacks++
        if (name == null) {
          if (callbacks !== 1) {
            gen.throw('You may either request several named callbacks or one unnamed callback!')
          } else {
            return function cb () {
              callbacks--
              handleResult(gen.next(Array.prototype.slice.call(arguments)))
            }
          }
        } else {
          if (callbackValues[name] != null) {
            gen.throw('You already used that callback namespace! You need to `yield` first!')
          } else {
            return function cb () {
              callbacks--
              callbackValues[name] = Array.prototype.slice.call(arguments)
              if (callbacks === 0) {
                handleResult(gen.next(callbackValues))
                callbackValues = {}
              }
            }
          }
        }
      }
      var callbacks = 0
      var callbackValues = {}
      var gen = generator.apply(this, [getCallback].concat(args))

      function handleResult (result) {
        if (result.done) {
          resolve(result.value)
        } else if (result.value instanceof Promise) {
          result.value.then(function (val) {
            handleResult(gen.next([null, val]))
          }, function (err) {
            handleResult(gen.next([err || 'Promise was rejected']))
          })
        } else if (callbacks === 0) {
          gen.throw('This object is not yield-able, also you did not request any callbacks!')
        }
      }
      handleResult(gen.next())
    })
  }
}

program
  .command('*')
  .action(function (env) {
    program.help()
  })

program
  .parse(process.argv)

if (program.args.length === 0) {
  program.help()
}
