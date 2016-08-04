# ez-build-lib
> A command line tool to pack ES2015+ libraries.

![ez-build-lib](http://imgs.xkcd.com/comics/tools.png)

```
  Usage: ez-build-lib [options] [command]


  Commands:

    init <entry>   Sets reasonable properties in the package.json, .gitignore, and bower.json files (optional)
    build <entry>  Builds your project
    build:watch    Builds the project whenever a file changes
    publish <dir>  Publish the project including distribution files:
                   Build > version bump > commit > create git tag > publish to npm
    *

  A command line tool to pack ES2015+ libraries

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

    It is encouraged to use `npm run <cmd>` from now on:

    $ npm run build
    $ npm run build:watch % for development
```
