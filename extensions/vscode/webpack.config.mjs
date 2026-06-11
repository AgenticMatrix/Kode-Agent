import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/extension/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist', 'extension'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
    tiktoken: 'commonjs tiktoken',
    react: 'commonjs react',
    ink: 'commonjs ink',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    rules: [{
      test: /\.tsx?$/,
      exclude: /node_modules/,
      use: [{
        loader: 'ts-loader',
        options: {
          configFile: path.resolve(__dirname, 'tsconfig.json'),
          compilerOptions: { noImplicitAny: false, strict: false },
        },
      }],
    }],
  },
  devtool: 'source-map',
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './src/webview/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist', 'webview'),
    filename: 'webview.js',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.css'],
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
    alias: { react: 'preact/compat', 'react-dom': 'preact/compat' },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [{
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.json'),
            compilerOptions: { module: 'esnext', noImplicitAny: false, strict: false },
          },
        }],
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  devtool: 'source-map',
};

export default [extensionConfig, webviewConfig];
