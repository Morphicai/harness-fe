import { defineConfig, type DefaultTheme } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const sharedHead: [string, Record<string, string>][] = [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'og:type', content: 'website' }],
];

const enThemeConfig: DefaultTheme.Config = {
    nav: [
        { text: 'Guide', link: '/guide/quickstart' },
        { text: 'Integrations', link: '/integrations/vite' },
        { text: 'Reference', link: '/reference/overlay-plugins' },
        { text: 'Blog', link: '/blog/' },
        { text: 'Changelog', link: 'https://github.com/Morphicai/harness-fe/blob/main/CHANGELOG.md' },
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
    editLink: {
        pattern: 'https://github.com/Morphicai/harness-fe/edit/main/packages/docs/:path',
        text: 'Edit this page on GitHub',
    },
    footer: {
        message: 'Released under the MIT License.',
        copyright: 'Copyright © 2024-present Morphic AI',
    },
};

const zhThemeConfig: DefaultTheme.Config = {
    nav: [
        { text: '指南', link: '/zh/guide/quickstart' },
        { text: '集成', link: '/zh/integrations/vite' },
        { text: '参考', link: '/zh/reference/overlay-plugins' },
        { text: '博客', link: '/zh/blog/' },
        { text: '更新日志', link: 'https://github.com/Morphicai/harness-fe/blob/main/CHANGELOG.md' },
    ],
    sidebar: {
        '/zh/guide/': [
            {
                text: '入门',
                items: [
                    { text: '简介', link: '/zh/guide/introduction' },
                    { text: '快速开始', link: '/zh/guide/quickstart' },
                    { text: '架构', link: '/zh/guide/architecture' },
                ],
            },
            {
                text: '深入',
                items: [
                    { text: '自调试模式', link: '/zh/guide/self-debug' },
                    { text: '故障排查', link: '/zh/guide/troubleshooting' },
                ],
            },
        ],
        '/zh/integrations/': [
            {
                text: '框架集成',
                items: [
                    { text: 'Vite (React / Vue)', link: '/zh/integrations/vite' },
                    { text: 'Next.js', link: '/zh/integrations/nextjs' },
                    { text: 'Webpack / Rspack', link: '/zh/integrations/webpack' },
                    { text: 'Electron / WebView', link: '/zh/integrations/electron' },
                    { text: 'Vue 2 兼容', link: '/zh/integrations/vue2' },
                ],
            },
            {
                text: '部署',
                items: [
                    { text: '局域网模式', link: '/zh/integrations/lan-mode' },
                    { text: 'Docker', link: '/zh/integrations/docker' },
                    { text: '多守护进程', link: '/zh/integrations/multi-daemon' },
                ],
            },
        ],
        '/zh/reference/': [
            {
                text: 'API 参考',
                items: [
                    { text: 'Overlay 插件', link: '/zh/reference/overlay-plugins' },
                    { text: 'MCP 工具', link: '/zh/reference/mcp-tools' },
                    { text: '版本策略', link: '/zh/reference/versioning-policy' },
                ],
            },
        ],
    },
    editLink: {
        pattern: 'https://github.com/Morphicai/harness-fe/edit/main/packages/docs/:path',
        text: '在 GitHub 上编辑此页',
    },
    footer: {
        message: '基于 MIT 协议开源。',
        copyright: '版权所有 © 2024-至今 Morphic AI',
    },
    docFooter: {
        prev: '上一页',
        next: '下一页',
    },
    outline: { label: '本页目录' },
    lastUpdated: { text: '最后更新' },
    darkModeSwitchLabel: '主题',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    langMenuLabel: '切换语言',
};

export default withMermaid(defineConfig({
    title: 'Harness-FE',
    description: 'Give AI agents eyes, ears, and hands in your frontend.',
    head: sharedHead,

    themeConfig: {
        logo: '/logo.svg',
        siteTitle: 'Harness-FE',
        socialLinks: [
            { icon: 'github', link: 'https://github.com/Morphicai/harness-fe' },
        ],
        search: {
            provider: 'local',
            options: {
                locales: {
                    zh: {
                        translations: {
                            button: {
                                buttonText: '搜索文档',
                                buttonAriaLabel: '搜索文档',
                            },
                            modal: {
                                noResultsText: '无匹配结果',
                                resetButtonTitle: '清除查询',
                                footer: {
                                    selectText: '选择',
                                    navigateText: '切换',
                                    closeText: '关闭',
                                },
                            },
                        },
                    },
                },
            },
        },
    },

    locales: {
        root: {
            label: 'English',
            lang: 'en-US',
            themeConfig: enThemeConfig,
        },
        zh: {
            label: '简体中文',
            lang: 'zh-CN',
            title: 'Harness-FE',
            description: '让 AI 代理拥有看见、操作前端的能力。',
            themeConfig: zhThemeConfig,
        },
    },

    ignoreDeadLinks: [
        /^http:\/\/localhost/,
    ],

    markdown: {
        theme: {
            light: 'github-light',
            dark: 'github-dark',
        },
    },

    mermaid: {
        theme: 'base',
        themeVariables: {
            primaryColor: '#005EFF',
            primaryTextColor: '#FFFFFF',
            primaryBorderColor: '#0F294D',
            lineColor: '#0F294D',
            secondaryColor: '#E7EBF8',
            tertiaryColor: '#FDFEFE',
            fontFamily: "'SF Pro Text', 'PingFang SC', -apple-system, sans-serif",
        },
    },
}));
