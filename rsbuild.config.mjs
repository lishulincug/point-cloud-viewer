import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSass } from '@rsbuild/plugin-sass';

export default defineConfig({
  plugins: [
    pluginReact({
      reactRefreshOptions: {
        exclude: [/[\\/]mock[\\/]/],
      },
    }),
    pluginSass(),
  ],
  source: {
    entry: {
      index: './App.tsx',
    },
  },
  html: {
    title: 'Point Cloud Viewer',
    template: './public/index.html',
  },
  output: {
    distPath: {
      root: 'dist',
    },
    assetPrefix: './',
  },
  tools: {
    rspack: {
      resolve: {
        extensions: ['.tsx', '.ts', '.jsx', '.js'],
        alias: {
          '@': '.',
        },
      },
    },
  },
  server: {
    port: 3030,
    open: true,
  },
});

