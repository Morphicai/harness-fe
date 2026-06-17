/**
 * Renderer entry. Pure DOM — no harness import needed: the @harness-fe/vite
 * plugin injects `window.__HARNESS_FE__` + the runtime entry into index.html,
 * which auto-starts the rrweb recorder. This file only drives DOM mutations so
 * rrweb has a stream of incremental events to record (on top of the initial
 * type:2 FullSnapshot).
 *
 * A small auto-driver mutates the DOM on a timer so a recording accumulates even
 * with no manual clicks — handy for the headless verification run.
 */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const countEl = $('count');
let count = 0;
const setCount = (n: number) => {
    count = n;
    countEl.textContent = String(n);
};

$('inc').addEventListener('click', () => setCount(count + 1));
$('reset').addEventListener('click', () => setCount(0));

const list = $('list');
const textInput = $<HTMLInputElement>('text');
const addItem = (text: string) => {
    const value = text.trim();
    if (!value) return;
    const li = document.createElement('li');
    li.textContent = value;
    list.appendChild(li);
    textInput.value = '';
};
$('add').addEventListener('click', () => addItem(textInput.value));
textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem(textInput.value);
});

const box = $('box');
let spun = false;
$('spin').addEventListener('click', () => {
    spun = !spun;
    box.style.transform = spun ? 'rotate(45deg) scale(1.2)' : '';
});

// Auto-driver: a heartbeat of DOM mutations so the recording grows hands-free.
let tick = 0;
setInterval(() => {
    tick += 1;
    setCount(count + 1);
    if (tick % 3 === 0) addItem(`auto item ${tick}`);
    box.style.background = `hsl(${(tick * 37) % 360} 70% 60%)`;
    // Console + error events also flow through harness capture; emit some.
    if (tick % 5 === 0) console.log('[electron-demo] heartbeat', tick);
}, 1500);

// One deliberate error so the timeline has an `err` event to inspect too.
setTimeout(() => {
    try {
        throw new Error('electron-demo sample error (expected)');
    } catch (err) {
        console.error(err);
    }
}, 4000);
