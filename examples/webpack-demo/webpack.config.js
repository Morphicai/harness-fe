const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { harnessaFE } = require('@morphixai/harnessa-fe.webpack');

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
        harnessaFE(),
    ],
    devServer: {
        port: 3001,
        hot: true,
    },
};
