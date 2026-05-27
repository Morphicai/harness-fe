import { defineConfig } from 'vitepress';

export default defineConfig({
    lang: 'en-US',
    title: 'Harness-FE',
    description: 'Give AI agents eyes, ears, and hands in your frontend.',

    head: [
        ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
        ['meta', { name: 'og:type', content: 'website' }],
        ['meta', { name: 'og:title', content: 'Harness-FE' }],
        ['meta', { name: 'og:description', content: 'Give AI agents eyes, ears, and hands in your frontend.' }],
    ],

    themeConfig: {
        logo: '/logo.svg',
        siteTitle: 'Harness-FE',

        nav: [
            { text: 'Guide', link: '/guide/quickstart' },
            { text: 'Integrations', link: '/integrations/vite' },
            { text: 'Reference', link: '/reference/overlay-plugins' },
            { text: 'Changelog', link: 'https://github.com/Morphicai/harness-fe/blob/main/CHANGELOG.md' },
            {
                text: 'GitHub',
                link: 'https://github.com/Morphicai/harness-fe',
            },
        ],

        sidebar: {
            '/guide/': [
                {
                    text: 'Getting Started',
                    items: [
                        { text: 'Introduction', link: '/guide/introduction' },
                        { text: 'Quickstart', link: '/guide/quickstart' },
                        { text: 'Architecture', link: '/guide/architecture' },
                    ],
                },
                {
                    text: 'Going Further',
                    items: [
                        { text: 'Self-debug mode', link: '/guide/self-debug' },
                        { text: 'Troubleshooting', link: '/guide/troubleshooting' },
                    ],
                },
            ],
            '/integrations/': [
                {
                    text: 'Framework Guides',
                    items: [
                        { text: 'Vite (React / Vue)', link: '/integrations/vite' },
                        { text: 'Next.js', link: '/integrations/nextjs' },
                        { text: 'Webpack / Rspack', link: '/integrations/webpack' },
                        { text: 'Electron / WebView', link: '/integrations/electron' },
                        { text: 'Vue 2 Compat', link: '/integrations/vue2' },
                    ],
                },
                {
                    text: 'Deployment',
                    items: [
                        { text: 'LAN mode', link: '/integrations/lan-mode' },
                        { text: 'Docker', link: '/integrations/docker' },
                        { text: 'Multi-daemon', link: '/integrations/multi-daemon' },
                    ],
                },
            ],
            '/reference/': [
                {
                    text: 'API Reference',
                    items: [
                        { text: 'Overlay Plugins', link: '/reference/overlay-plugins' },
                        { text: 'MCP Tools', link: '/reference/mcp-tools' },
                        { text: 'Versioning Policy', link: '/reference/versioning-policy' },
                    ],
                },
            ],
        },

        socialLinks: [
            { icon: 'github', link: 'https://github.com/Morphicai/harness-fe' },
        ],

        editLink: {
            pattern: 'https://github.com/Morphicai/harness-fe/edit/main/packages/docs/:path',
            text: 'Edit this page on GitHub',
        },

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © 2024-present Morphic AI',
        },

        search: {
            provider: 'local',
        },
    },

    ignoreDeadLinks: [
        // localhost URLs are valid examples in docs, not real dead links
        /^http:\/\/localhost/,
    ],

    markdown: {
        theme: {
            light: 'github-light',
            dark: 'github-dark',
        },
    },
});
