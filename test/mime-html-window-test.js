'use strict';

// email-text-tools 2.6.4 keeps one jsdom window for the process. scripts/email-text-tools-window.js
// gives each sanitize its own window and closes it. This checks the window is actually released:
// a few dozen styled messages must not keep their documents after a GC.

if (process.env.MIME_HTML_WINDOW_CHECK === '1') {
    const { mimeHtml } = require('@postalsys/email-text-tools');

    const later = () => new Promise(resolve => setImmediate(resolve));
    const html =
        '<html><head><style>p{color:red}</style></head><body>' + '<p>Hello <b>there</b> <a href="https://example.com">link</a></p>'.repeat(80) + '</body></html>';

    const run = async () => {
        for (let i = 0; i < 3; i++) {
            mimeHtml({ html });
        }
        await later();
        global.gc();
        await later();
        global.gc();
        const before = process.memoryUsage().heapUsed;
        for (let i = 0; i < 20; i++) {
            mimeHtml({ html });
        }
        await later();
        global.gc();
        await later();
        global.gc();
        const grown = process.memoryUsage().heapUsed - before;
        if (grown > 8 * 1024 * 1024) {
            console.error(`mimeHtml retained ${grown} bytes across 20 messages`);
            process.exit(1);
        }
        process.exit(0);
    };

    run();
} else {
    const test = require('node:test');
    const assert = require('node:assert').strict;
    const { spawnSync } = require('node:child_process');

    const exitWhenStandalone = require('./helpers/exit-standalone');

    test('mimeHtml releases the jsdom window between messages', () => {
        const result = spawnSync(process.execPath, ['--expose-gc', __filename], {
            env: { ...process.env, MIME_HTML_WINDOW_CHECK: '1' },
            encoding: 'utf8'
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    });

    exitWhenStandalone();
}
