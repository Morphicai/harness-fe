import { useState } from 'react';

interface FormValues {
    name: string;
    email: string;
    role: string;
    subscribe: boolean;
    fileName: string;
}

const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 15,
    boxSizing: 'border-box',
    marginTop: 6,
};

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontWeight: 600,
    color: '#374151',
    fontSize: 14,
    marginBottom: 16,
};

export function FormsPage() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('Developer');
    const [subscribe, setSubscribe] = useState(false);
    const [fileName, setFileName] = useState('');
    const [submitted, setSubmitted] = useState<FormValues | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitted({ name, email, role, subscribe, fileName });
        console.log('[demo] form submitted', { name, email, role, subscribe });
    };

    return (
        <div>
            <h1 style={{ color: '#1a1a2e' }}>Forms</h1>
            <p style={{ color: '#555' }}>
                Tests: <code>page.type</code>, <code>page.click</code>, <code>page.dom_query</code>
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
                <form onSubmit={handleSubmit}>
                    <label style={labelStyle}>
                        Full name
                        <input
                            type="text"
                            aria-label="Full name"
                            data-morphix-comp="NameInput"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Jane Smith"
                            style={inputStyle}
                        />
                    </label>

                    <label style={labelStyle}>
                        Email address
                        <input
                            type="email"
                            aria-label="Email address"
                            data-morphix-comp="EmailInput"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="jane@example.com"
                            style={inputStyle}
                        />
                    </label>

                    <label style={labelStyle}>
                        Role
                        <select
                            aria-label="Role"
                            data-morphix-comp="RoleSelect"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            style={inputStyle}
                        >
                            <option value="Developer">Developer</option>
                            <option value="Designer">Designer</option>
                            <option value="Manager">Manager</option>
                        </select>
                    </label>

                    <label
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            fontWeight: 600,
                            color: '#374151',
                            fontSize: 14,
                            marginBottom: 24,
                            cursor: 'pointer',
                        }}
                    >
                        <input
                            type="checkbox"
                            aria-label="Subscribe to newsletter"
                            data-morphix-comp="SubscribeCheckbox"
                            checked={subscribe}
                            onChange={(e) => setSubscribe(e.target.checked)}
                            style={{ width: 18, height: 18 }}
                        />
                        Subscribe to newsletter
                    </label>

                    <label style={labelStyle}>
                        Upload file
                        <input
                            type="file"
                            aria-label="Upload file"
                            data-morphix-comp="FileInput"
                            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
                            style={{ ...inputStyle, padding: '8px 12px', cursor: 'pointer' }}
                        />
                        {fileName && (
                            <span style={{ fontSize: 13, color: '#166534', marginTop: 4, display: 'block' }}
                                  data-morphix-comp="SelectedFileName">
                                Selected: {fileName}
                            </span>
                        )}
                    </label>

                    <button
                        type="submit"
                        aria-label="Submit form"
                        data-morphix-comp="SubmitBtn"
                        style={{
                            background: '#e94560',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '12px 28px',
                            fontSize: 15,
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Submit
                    </button>
                </form>
            </div>

            {submitted && (
                <div
                    style={{
                        background: '#f0fdf4',
                        border: '1px solid #86efac',
                        borderRadius: 8,
                        padding: '16px 20px',
                        marginTop: 16,
                    }}
                    data-morphix-comp="SubmittedValues"
                >
                    <h3 style={{ margin: '0 0 12px', color: '#166534' }}>Submitted Values</h3>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
                        <tbody>
                            {Object.entries(submitted).map(([key, val]) => (
                                <tr key={key}>
                                    <td
                                        style={{
                                            padding: '6px 12px 6px 0',
                                            fontWeight: 600,
                                            color: '#374151',
                                            width: 160,
                                        }}
                                    >
                                        {key}
                                    </td>
                                    <td
                                        style={{ padding: '6px 0', color: '#166534' }}
                                        data-morphix-comp={`SubmittedValue-${key}`}
                                    >
                                        {String(val)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

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
                    <li>Use <code>page.type</code> with <code>ariaLabel: "Full name"</code> to fill the name field</li>
                    <li>Use <code>page.type</code> with <code>ariaLabel: "Email address"</code> to fill email</li>
                    <li>Use <code>page.check</code> with <code>ariaLabel: "Subscribe to newsletter"</code> to toggle checkbox</li>
                    <li>Use <code>page.select</code> with <code>ariaLabel: "Role"</code> to change the dropdown</li>
                    <li>Use <code>page.upload</code> with <code>ariaLabel: "Upload file"</code> to inject a file</li>
                    <li>Use <code>page.click</code> with <code>ariaLabel: "Submit form"</code> to submit</li>
                    <li>Use <code>page.dom_query</code> with <code>component: "SubmittedValues"</code> to read results</li>
                </ul>
            </div>
        </div>
    );
}
