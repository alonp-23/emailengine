'use strict';

// @postalsys/email-text-tools@2.6.4 builds one jsdom window for the life of the process and
// sanitizes with RETURN_DOM. Every webSafeHtml / preProcessHtml fetch leaves that document
// attached to the window, so the IMAP account workers grow without bound. A window per call,
// closed after the HTML has been read back out as a string, releases it. Output is unchanged.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', '@postalsys', 'email-text-tools', 'dist');

const files = [
    {
        file: path.join(root, 'cjs', 'lib', 'mime-html.js'),
        from:
            '// One sanitizer for the module. Every sanitize() call passes its full config, so calls do not\n' +
            '// leak settings into each other.\n' +
            'const DOMPurify = (0, dompurify_1.default)(new jsdom_cjs_1.JSDOM(\'\').window);\n',
        to: `function withDomPurify(run) {
    const dom = new jsdom_cjs_1.JSDOM('');
    try {
        return run((0, dompurify_1.default)(dom.window));
    } finally {
        dom.window.close();
    }
}
`
    },
    {
        file: path.join(root, 'esm', 'lib', 'mime-html.js'),
        from:
            '// One sanitizer for the module. Every sanitize() call passes its full config, so calls do not\n' +
            '// leak settings into each other.\n' +
            'const DOMPurify = createDOMPurify(new JSDOM(\'\').window);\n',
        to: `function withDomPurify(run) {
    const dom = new JSDOM('');
    try {
        return run(createDOMPurify(dom.window));
    } finally {
        dom.window.close();
    }
}
`
    }
];

const shared = [
    [
        '    // first pass, returns the <html> element of the fixed HTML page\n    const root = DOMPurify.sanitize(html, {\n',
        '    // first pass, returns the <html> element of the fixed HTML page\n    return withDomPurify(DOMPurify => {\n    const root = DOMPurify.sanitize(html, {\n'
    ],
    [
        '    return { html: root.outerHTML, hasStyle, inliningSkipped };\n}',
        '    return { html: root.outerHTML, hasStyle, inliningSkipped };\n    });\n}'
    ],
    [
        'function finishHtml(html, inliningSkipped) {\n    // outputs a BODY DOM element\n    const dom = DOMPurify.sanitize(html, {\n',
        'function finishHtml(html, inliningSkipped) {\n    return withDomPurify(DOMPurify => {\n    // outputs a BODY DOM element\n    const dom = DOMPurify.sanitize(html, {\n'
    ],
    [
        '    return `<div style="overflow: auto; contain: paint;"${marker}>${body}${dom.innerHTML.trim()}</div></div>`;\n}',
        '    return `<div style="overflow: auto; contain: paint;"${marker}>${body}${dom.innerHTML.trim()}</div></div>`;\n    });\n}'
    ]
];

function replaceOnce(source, from, to, file) {
    const found = source.split(from).length - 1;
    if (found !== 1) {
        throw new Error(`${file} has ${found} matches for a patch anchor. email-text-tools is no longer 2.6.4, or the patch was half-applied.`);
    }
    return source.replace(from, to);
}

for (const { file, from, to } of files) {
    if (!fs.existsSync(file)) {
        throw new Error(`missing ${file}. Install dependencies before applying the email-text-tools patch.`);
    }
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes('function withDomPurify(run)')) {
        continue;
    }
    let next = replaceOnce(source, from, to, file);
    for (const [anchor, replacement] of shared) {
        next = replaceOnce(next, anchor, replacement, file);
    }
    fs.writeFileSync(file, next);
}
