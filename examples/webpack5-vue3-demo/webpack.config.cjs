const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { VueLoaderPlugin } = require('vue-loader');
const { harnessFE } = require('@harness-fe/webpack');

module.exports = {
    mode: 'development',
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'bundle.js',
        clean: true,
    },
    module: {
        rules: [
            { test: /\.vue$/, loader: 'vue-loader' },
            { test: /\.css$/, use: ['style-loader', 'css-loader'] },
        ],
    },
    resolve: {
        extensions: ['.js', '.vue'],
    },
    plugins: [
        new VueLoaderPlugin(),
        new HtmlWebpackPlugin({ template: './public/index.html' }),
        // harnessFE() must run AFTER VueLoaderPlugin so the unplugin transform
        // sees the original .vue source (vue-loader splits SFCs into virtual
        // submodules, but the unplugin loader hooks the root .vue request
        // before that split). Order matters: register harnessFE last.
        harnessFE(),
    ],
    devServer: {
        port: 3002,
        hot: true,
    },
};
