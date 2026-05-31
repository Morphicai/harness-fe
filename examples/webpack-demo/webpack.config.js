const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { harnessFE } = require('@harness-fe/webpack');

module.exports = {
    mode: 'development',
    entry: './src/index.jsx',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'bundle.js',
    },
    module: {
        rules: [
            {
                test: /\.jsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env', '@babel/preset-react'],
                    },
                },
            },
        ],
    },
    resolve: {
        extensions: ['.js', '.jsx'],
    },
    plugins: [
        new HtmlWebpackPlugin({ template: './public/index.html' }),
        // TEAM / shared-service mode: connect straight to the ONE shared central
        // daemon (fixed port 47900) as a distinct project. Connection is baked in
        // (not env) so `turbo run dev` launches every demo uniformly without
        // leaking the team target into the solo app. See examples/DEMO.md.
        harnessFE({
            projectId: 'webpack-demo',
            mcpUrl: 'ws://127.0.0.1:47950/ws',
            token: process.env.HARNESS_TEAM_TOKEN ?? 'team-secret-demo',
        }),
    ],
    devServer: {
        // Harness-FE demo port band (478xx). 47812 = webpack-demo (team).
        port: 47812,
        hot: true,
    },
};
