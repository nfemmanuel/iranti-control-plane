#!/usr/bin/env node
'use strict';
// Iranti write-guard hook — fires on PreToolUse for Edit/Write.
// Checks whether the agent has pending unwritten edits by querying the
// .iranti-write-debt signal file. If the agent edited files without calling
// iranti_write, this hook DENIES the next edit and injects a reminder.
//
// Falls through silently (allows) for non-Iranti projects or if check fails.
const fs = require('fs');
const path = require('path');

const envFile = path.join(process.cwd(), '.env.iranti');
if (!fs.existsSync(envFile)) {
    process.exit(0);
}

let input = '';
try {
    input = fs.readFileSync(0, 'utf8');
} catch {
    process.exit(0);
}

let hookData;
try {
    hookData = JSON.parse(input);
} catch {
    process.exit(0);
}

const toolName = hookData.tool_name || hookData.toolName || '';
if (toolName !== 'Edit' && toolName !== 'Write') {
    process.exit(0);
}

const signalFile = path.join(process.cwd(), '.iranti-write-debt');
if (!fs.existsSync(signalFile)) {
    process.exit(0);
}

let debt;
try {
    debt = JSON.parse(fs.readFileSync(signalFile, 'utf8'));
} catch {
    process.exit(0);
}

const pendingEdits = debt.pendingEdits || 0;
const lastEditAt = debt.lastEditAt || null;

if (pendingEdits < 1) {
    process.exit(0);
}

const output = JSON.stringify({
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: `Iranti write-guard: ${pendingEdits} file edit(s) since last iranti_write (last edit: ${lastEditAt || 'unknown'}). Call iranti_write for each pending edit before making new changes.`,
    additionalContext: [
        'IRANTI WRITE-GUARD BLOCKED THIS EDIT.',
        `You have ${pendingEdits} pending file edit(s) that have not been written to Iranti shared memory.`,
        'Before making any more edits, you MUST call iranti_write for each pending edit.',
        'Include: entity (project/[id]/file/[filename]), absolutePath, lines changed, what changed and why.',
        'After writing all pending edits, this guard will allow new edits.',
    ].join('\n'),
});

require('fs').writeSync(1, output);
