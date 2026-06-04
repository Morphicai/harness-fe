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
        //
        // TEAM / shared-service mode: connect straight to the ONE shared central
        // daemon (fixed port 47900) as a distinct project. Connection is baked in
        // (not env) so `turbo run dev` launches every demo uniformly. See DEMO.md.
        harnessFE({
            projectId: 'webpack5-vue3-demo',
            mcpUrl: 'ws://127.0.0.1:47950/ws',
            token: process.env.HARNESS_TEAM_TOKEN,
        }),
    ],
    devServer: {
        // Harness-FE demo port band (478xx). 47813 = webpack5-vue3-demo (team).
        port: 47813,
        hot: true,
    },
};
