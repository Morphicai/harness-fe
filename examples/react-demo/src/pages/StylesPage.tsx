export function StylesPage() {
    return (
        <div>
            <h1 style={{ color: '#1a1a2e' }}>Styles &amp; HTML</h1>
            <p style={{ color: '#555' }}>
                Tests: <code>page.set_style</code>, <code>page.set_html</code>, <code>page.screenshot</code>
            </p>

            {/* Style target */}
            <div
                style={{
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: 24,
                    marginTop: 24,
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 12,
                    }}
                >
                    <span
                        style={{
                            background: '#e94560',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 4,
                            letterSpacing: 1,
                        }}
                    >
                        TARGET
                    </span>
                    <code style={{ fontSize: 13, color: '#555' }}>id="style-target"</code>
                </div>

                <div
                    id="style-target"
                    style={{
                        background: '#1a1a2e',
                        borderRadius: 8,
                        padding: 24,
                        color: '#fff',
                    }}
                >
                    <h2 style={{ margin: '0 0 8px', fontSize: 20 }} data-morphix-comp="StyleTargetTitle">
                        Style Target Card
                    </h2>
                    <p style={{ margin: '0 0 16px', color: '#ccc', fontSize: 14 }} data-morphix-comp="StyleTargetDesc">
                        Use <code>page.set_style</code> to change the background, text color, padding, or any CSS property of this card.
                    </p>
                    <button
                        type="button"
                        aria-label="Style target button"
                        data-morphix-comp="StyleTargetBtn"
                        style={{
                            background: '#e94560',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '10px 20px',
                            fontSize: 14,
                            cursor: 'pointer',
                        }}
                    >
                        Colored Button
                    </button>
                </div>

                <p style={{ color: '#888', fontSize: 13, marginTop: 12 }}>
                    Example: set <code>#style-target</code> background to <code>#0f4c75</code> or change padding to <code>48px</code>
                </p>
            </div>

            {/* HTML target */}
            <div
                style={{
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: 24,
                    marginTop: 16,
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 12,
                    }}
                >
                    <span
                        style={{
                            background: '#2563eb',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 4,
                            letterSpacing: 1,
                        }}
                    >
                        TARGET
                    </span>
                    <code style={{ fontSize: 13, color: '#555' }}>id="html-target"</code>
                </div>

                <ul
                    id="html-target"
                    style={{
                        margin: 0,
                        paddingLeft: 24,
                        lineHeight: 2,
                        color: '#374151',
                    }}
                    data-morphix-comp="HtmlTargetList"
                >
                    <li data-morphix-comp="HtmlItem1">Item one — original content</li>
                    <li data-morphix-comp="HtmlItem2">Item two — original content</li>
                    <li data-morphix-comp="HtmlItem3">Item three — original content</li>
                </ul>

                <p style={{ color: '#888', fontSize: 13, marginTop: 12 }}>
                    Example: replace the <code>#html-target</code> innerHTML with new list items using <code>page.set_html</code>
                </p>
            </div>

            {/* Screenshot target */}
            <div
                style={{
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: 24,
                    marginTop: 16,
                }}
            >
                <h3 style={{ margin: '0 0 12px', color: '#1a1a2e' }}>Screenshot Target</h3>
                <div
                    id="screenshot-target"
                    data-morphix-comp="ScreenshotTarget"
                    style={{
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        borderRadius: 8,
                        padding: 32,
                        textAlign: 'center',
                        color: '#fff',
                    }}
                >
                    <div style={{ fontSize: 48, marginBottom: 8 }}>📸</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>Capture me with page.screenshot</div>
                    <div style={{ fontSize: 14, opacity: 0.8, marginTop: 4 }}>
                        Use selector <code style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: 3 }}>
                            component: "ScreenshotTarget"
                        </code>
                    </div>
                </div>
            </div>

            <div
                style={{
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: '16px 20px',
                    marginTop: 16,
                }}
            >
                <h3 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>How to test</h3>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#555', fontSize: 14, lineHeight: 1.8 }}>
                    <li>Use <code>page.set_style</code> on <code>#style-target</code> to change its appearance</li>
                    <li>Use <code>page.set_html</code> on <code>#html-target</code> to replace the list items</li>
                    <li>Use <code>page.screenshot</code> with <code>component: "ScreenshotTarget"</code> to capture just that element</li>
                    <li>Use <code>page.screenshot</code> without a selector to capture the full page</li>
                </ul>
            </div>
        </div>
    );
}
