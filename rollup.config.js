import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';
import pkg from './package.json';

export default [
  // browser-friendly UMD build
  {
    input: 'src/index.js',
    output: {
      file: pkg.browser,
      format: 'umd'
    },
    name: 'bundle',
    plugins: [
      babel({
        exclude: 'node_modules/**'
      }),
      // add babel for es6+ syntax for UglifyJs if used in production
      // UglifyJs do not support ES6+, you can also use babel-minify for better treeshaking: https://github.com/babel/minify
      resolve(), // so Rollup can find `gif.js`
      commonjs() // so Rollup can convert `gif.js` to an ES module
    ]
  },

  // CommonJS (for Node) and ES module (for bundlers) build.
  // (We could have three entries in the configuration array
  // instead of two, but it's quicker to generate multiple
  // builds from a single configuration where possible, using
  // an array for the `output` option, where we can specify
  // `file` and `format` for each target)
  {
    input: 'src/index.js',
    external: ['gif.js'],
    output: [
      { file: pkg.main, format: 'cjs' },
      { file: pkg.module, format: 'es' }
    ]
  }
];
