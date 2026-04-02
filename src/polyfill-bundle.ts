import { plugin } from 'bun';
plugin({
  name: 'bundle-polyfill',
  setup(build) {
    build.module('bun:bundle', () => ({
      exports: {
        feature: (name: string) => name === 'BUDDY',
      },
      loader: 'object',
    }));
  },
});
