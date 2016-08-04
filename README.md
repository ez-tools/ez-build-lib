# ez-build-lib
> A command line tool to pack ES2015+ libraries.

![ez-build-lib](http://imgs.xkcd.com/comics/tools.png)

```
Usage: ez-build-lib [options] [command]


Commands:

  init <dir>     Sets up your project. Attention: This will mess up your package.json and bower.json files!
  deploy         Deploys your project to npm & bower
  build <entry>  Builds your project
  test           Tests your project
  dev            Watch files and continuously test & build the project
  *

A command line tool to pack your ES2015 library

Options:

  -h, --help     output usage information
  -V, --version  output the version number


  Example:

    $ ez-build-lib init ./src/test.js

    Updated package.json:

    ..
      "main": "./dist/test.cjs.js",
      "jsnext:main": "./dist/test.mjs",
      "browser": "./dist/test.umd.js",
      "scripts": {
        "build": "ez-build-lib build src/test.js",
        "watch": "ez-build-lib watch src/test.js"
        ..
      }
    ..

    Updated bower.json:

    ..
      "main": "./dist/test.umd.js"
    ..

    It is encouraged to use `npm run <cmd>` from now on:

    $ npm run build
    $ npm run build:watch % for development


```