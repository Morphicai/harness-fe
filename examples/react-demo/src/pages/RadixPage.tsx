import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

/**
 * Regression fixture for harness-fe#203: page.click on a trigger that opens a
 * portal-rendered Radix DropdownMenu. Radix gates opening on 'pointerdown',
 * so this only opens if page.click dispatches a full pointer/mouse sequence.
 */
export function RadixPage() {
    return (
        <div>
            <h1 style={{ color: '#1a1a2e' }}>Radix</h1>
            <p style={{ color: '#555' }}>
                Tests: <code>page.click</code> on a portal-rendered Radix{' '}
                <code>DropdownMenu</code> (harness-fe#203)
            </p>

            <div
                style={{
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: 32,
                    marginTop: 24,
                }}
            >
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                        <button
                            type="button"
                            aria-label="more actions"
                            data-morphix-comp="MoreActionsBtn"
                            style={{
                                background: '#1a1a2e',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 6,
                                padding: '10px 20px',
                                fontSize: 15,
                                cursor: 'pointer',
                            }}
                        >
                            更多操作
                        </button>
                    </DropdownMenu.Trigger>

                    <DropdownMenu.Portal>
                        <DropdownMenu.Content
                            data-morphix-comp="MoreActionsMenu"
                            style={{
                                background: '#fff',
                                border: '1px solid #e0e0e0',
                                borderRadius: 8,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                padding: 4,
                                minWidth: 160,
                            }}
                        >
                            <DropdownMenu.Item
                                data-morphix-comp="RenameItem"
                                style={{ padding: '8px 12px', borderRadius: 4, cursor: 'pointer', outline: 'none' }}
                            >
                                Rename
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                                data-morphix-comp="DeleteItem"
                                style={{ padding: '8px 12px', borderRadius: 4, cursor: 'pointer', outline: 'none' }}
                            >
                                Delete
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                </DropdownMenu.Root>
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
                    <li>
                        Use <code>page.click</code> with <code>component: "MoreActionsBtn"</code> to open the menu
                    </li>
                    <li>
                        Then <code>page.dom_query</code> with <code>component: "MoreActionsMenu"</code> should find
                        the portal-rendered content
                    </li>
                </ul>
            </div>
        </div>
    );
}
