/** @type {import("snowpack").SnowpackUserConfig } */

module.exports = {
  mount: {
    public: {url: '/', static: true},
    src: {url: '/dist'},
  },
  plugins: [
      '@snowpack/plugin-svelte',
      '@snowpack/plugin-dotenv',
      'snowpack-plugin-glslify',
      '@snowpack/plugin-postcss',
    ],
/*
  routes: [
      {src: "/.well-known/!*", dest: "/well-known/!*"},
      {src: ".*", dest: "/index.html"}
  ],
*/
  exclude: [
    '**/_*',
  ],
  optimize: {
    bundle: true,
  },
  packageOptions: {
    polyfillNode: true,
    // source: "remote"
  },
  devOptions: {
    secure: true,
    hostname: '0.0.0.0',
    open: 'none',
    tailwindConfig: './tailwind.config.js',
  },
  buildOptions: {
    htmlFragments: true
  },
  alias: {
    '@components': './src/components',
    '@core': './src/core',
    '@public': './public',
    '@shaders': './src/core/engines/ogl/shaders',
    '@src': './src',
    '@thirdparty': './src/third-party',
    '@experiments': './src/experiments'
  }
};
