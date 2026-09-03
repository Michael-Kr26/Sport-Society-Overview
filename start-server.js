'use strict';

const originalLog = console.log.bind(console);

console.log = (...args) => {
    const first = String(args[0] ?? '');
    if (first.startsWith('Database verbonden:')) return;
    originalLog(...args);
};

require('./r9-export-bootstrap');
