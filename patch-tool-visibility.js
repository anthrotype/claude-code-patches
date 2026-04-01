#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isRestore = args.includes('--restore');
const showHelp = args.includes('--help') || args.includes('-h');

// Display help
if (showHelp) {
  console.log('Claude Code Tool Visibility Patcher v2.1.89');
  console.log('=============================================\n');
  console.log('Usage: node patch-tool-visibility.js [options]\n');
  console.log('Options:');
  console.log('  --dry-run    Preview changes without applying them');
  console.log('  --restore    Restore from backup file');
  console.log('  --help, -h   Show this help message\n');
  console.log('Examples:');
  console.log('  node patch-tool-visibility.js              # Apply patch');
  console.log('  node patch-tool-visibility.js --dry-run    # Preview changes');
  console.log('  node patch-tool-visibility.js --restore    # Restore original');
  console.log('\nThis patch forces Read/Glob/Grep tool calls to always show');
  console.log('individual file paths and search patterns instead of collapsed');
  console.log('summaries like "Read 1 file (ctrl+o to expand)".');
  process.exit(0);
}

console.log('Claude Code Tool Visibility Patcher v2.1.89');
console.log('=============================================\n');

// Helper function to safely execute shell commands
function safeExec(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    return null;
  }
}

// Auto-detect Claude Code installation path
function getClaudeCodePath() {
  const homeDir = os.homedir();
  const attemptedPaths = [];

  // Helper to check and return path if it exists
  function checkPath(testPath, method) {
    if (!testPath) return null;

    attemptedPaths.push({ path: testPath, method });

    try {
      if (fs.existsSync(testPath)) {
        // Resolve symlinks for global npm installs
        try {
          const realPath = fs.realpathSync(testPath);
          return realPath;
        } catch (e) {
          return testPath;
        }
      }
    } catch (error) {
      // Path check failed, continue
    }
    return null;
  }

  // PRIORITY 1: Local installations (existing behavior - user overrides)
  const localPaths = [
    path.join(homeDir, '.claude', 'local', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    path.join(homeDir, '.config', 'claude', 'local', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
  ];

  for (const localPath of localPaths) {
    const found = checkPath(localPath, 'local installation');
    if (found) return found;
  }

  // PRIORITY 2: Global npm installation via 'npm root -g'
  const npmGlobalRoot = safeExec('npm root -g');
  if (npmGlobalRoot) {
    const npmGlobalPath = path.join(npmGlobalRoot, '@anthropic-ai', 'claude-code', 'cli.js');
    const found = checkPath(npmGlobalPath, 'npm root -g');
    if (found) return found;
  }

  // PRIORITY 3: Derive from process.execPath
  // Global modules are typically in ../lib/node_modules relative to node binary
  const nodeDir = path.dirname(process.execPath);
  const derivedGlobalPath = path.join(nodeDir, '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  const found = checkPath(derivedGlobalPath, 'derived from process.execPath');
  if (found) return found;

  // PRIORITY 4: Unix systems - try 'which claude' to find binary
  if (process.platform !== 'win32') {
    const claudeBinary = safeExec('which claude');
    if (claudeBinary) {
      try {
        // Resolve symlinks
        const realBinary = fs.realpathSync(claudeBinary);
        // Navigate from bin/claude to lib/node_modules/@anthropic-ai/claude-code/cli.js
        const binDir = path.dirname(realBinary);
        const nodeModulesPath = path.join(binDir, '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
        const foundFromBinary = checkPath(nodeModulesPath, 'which claude');
        if (foundFromBinary) return foundFromBinary;
      } catch (e) {
        // Failed to resolve, continue
      }
    }
  }

  // No installation found, return null and include attempted paths for error reporting
  getClaudeCodePath.attemptedPaths = attemptedPaths;
  return null;
}

const targetPath = getClaudeCodePath();

if (!targetPath) {
  console.error('❌ Error: Could not find Claude Code installation\n');
  console.error('Searched using the following methods:\n');

  const attemptedPaths = getClaudeCodePath.attemptedPaths || [];

  if (attemptedPaths.length > 0) {
    // Group by method for cleaner output
    const byMethod = {};
    attemptedPaths.forEach(({ path, method }) => {
      if (!byMethod[method]) byMethod[method] = [];
      byMethod[method].push(path);
    });

    Object.entries(byMethod).forEach(([method, paths]) => {
      console.error(`  [${method}]`);
      paths.forEach(p => console.error(`    - ${p}`));
    });
  } else {
    console.error('  - ~/.claude/local/node_modules/@anthropic-ai/claude-code/cli.js');
    console.error('  - ~/.config/claude/local/node_modules/@anthropic-ai/claude-code/cli.js');
    console.error('  - Global npm installation (npm root -g)');
  }

  console.error('\n💡 Troubleshooting:');
  console.error('  1. Verify Claude Code is installed: claude --version');
  console.error('  2. For local install: Check ~/.claude/local or ~/.config/claude/local');
  console.error('  3. For global install: Ensure "npm install -g @anthropic-ai/claude-code" succeeded');
  console.error('  4. Check that npm is in your PATH if using global install');
  process.exit(1);
}

console.log(`Found Claude Code at: ${targetPath}\n`);

const backupPath = targetPath + '.tool-visibility.backup';

// Restore from backup
if (isRestore) {
  if (!fs.existsSync(backupPath)) {
    console.error('❌ Error: Backup file not found at:', backupPath);
    process.exit(1);
  }

  console.log('Restoring from backup...');
  fs.copyFileSync(backupPath, targetPath);
  console.log('✅ Restored successfully!');
  console.log('\nPlease restart Claude Code for changes to take effect.');
  process.exit(0);
}

// Read file
console.log('Reading cli.js...');
if (!fs.existsSync(targetPath)) {
  console.error('❌ Error: cli.js not found at:', targetPath);
  process.exit(1);
}

let content = fs.readFileSync(targetPath, 'utf8');

// Tool Visibility Patch (v2.1.89)
// Shows individual tool calls (with file paths/patterns) instead of collapsed
// summaries like "Searched for 2 patterns, read 1 file (ctrl+o to expand)".
//
// 4-site patch strategy (v2.1.89):
//   Parent passes verbose:z to nKK. nKK checks if(z) to decide
//   expanded vs collapsed. OQz (inner renderer) hardcodes verbose:!0 in
//   renderToolResultMessage. The patch forces nKK's verbose branch while
//   threading the original verbose value to OQz so renderToolResultMessage
//   gets false (condensed) in normal mode and true (expanded) in transcript.
//
//   1. nKK verbose branch: force if(z) → if(!0) so individual tool calls
//      always render. z retains its original value for passthrough.
//   2. nKK → OQz call: pass verbose:z so OQz receives the original verbose
//      value (false=normal, true=transcript).
//   3. OQz destructuring: accept the new verbose prop as VB.
//   4. OQz renderToolResultMessage: use VB??!0 so results are condensed in
//      normal mode (VB=false) but fully expanded in transcript mode (VB=true).
//
// Version history for collapsed_read_search renderer:
// v2.1.81: _t4 -> ay_, 4-site: force verbose branch, thread verbose through
// v2.1.83: Btq -> mL_, 4-site: same approach, different var names
// v2.1.84: Btq -> Sx_, 4-site: same approach, J6->$6, U->F, t->s
// v2.1.85: Gpz -> IKK -> fpz, 4-site: IKK verbose check if(z), fpz inner
//   renderer, F unchanged (useEffect dep), z=verbose var, _6=array var
// v2.1.86: iiY -> R_K -> hiY, 4-site: R_K verbose check if(Y), hiY inner
//   renderer, g=useEffect dep, Y=verbose var, X6=array var
// v2.1.89: nKK -> OQz, 4-site: nKK verbose check if(z), OQz inner
//   renderer, z=verbose var, P6=array var

// Patch 1: Force nKK verbose branch (always show individual tool calls)
// Changes the if-condition from using z (verbose prop) to !0 (always true)
// so the verbose branch is always entered regardless of mode.
// The z variable retains its original value for passthrough to OQz.
const patch1Search = '$Qz);if(z){let P6=[]';
const patch1Replace = '$Qz);if(!0){let P6=[]';

// Patch 2: Pass verbose prop through nKK -> OQz
// Adds verbose:z to the OQz createElement call so OQz receives the original
// verbose value (false in normal mode, true in transcript mode).
const patch2Search = 'createElement(OQz,{key:w6.id,content:w6,tools:Y,lookups:$,inProgressToolUseIDs:K,shouldAnimate:_,theme:D})';
const patch2Replace = 'createElement(OQz,{key:w6.id,content:w6,tools:Y,lookups:$,inProgressToolUseIDs:K,shouldAnimate:_,theme:D,verbose:z})';

// Patch 3: Accept verbose prop in OQz component
// Adds verbose:VB to the destructuring so it's available in the function body.
const patch3Search = '{content:_,tools:z,lookups:Y,inProgressToolUseIDs:$,shouldAnimate:O,theme:A}=q';
const patch3Replace = '{content:_,tools:z,lookups:Y,inProgressToolUseIDs:$,shouldAnimate:O,theme:A,verbose:VB}=q';

// Patch 4: Use verbose prop in OQz renderToolResultMessage
// Changes hardcoded verbose:!0 to VB??!0 so results are condensed when
// VB is false (normal mode) but fully expanded when VB is true (transcript).
const patch4Search = 'renderToolResultMessage?.(k,[],{verbose:!0,tools:z,theme:A})';
const patch4Replace = 'renderToolResultMessage?.(k,[],{verbose:VB??!0,tools:z,theme:A})';

const patches = [
  { name: 'Force nKK verbose branch', search: patch1Search, replace: patch1Replace },
  { name: 'Pass verbose to OQz', search: patch2Search, replace: patch2Replace },
  { name: 'Accept verbose in OQz', search: patch3Search, replace: patch3Replace },
  { name: 'Use verbose in OQz results', search: patch4Search, replace: patch4Replace },
];

// Check which patches can be applied
console.log('Checking patches...\n');

let anyToApply = false;
let allApplied = true;

for (let i = 0; i < patches.length; i++) {
  const p = patches[i];
  console.log(`Patch ${i + 1}: ${p.name}`);
  if (content.includes(p.search)) {
    p.ready = true;
    anyToApply = true;
    allApplied = false;
    console.log('  ✅ Pattern found - ready to apply');
  } else if (content.includes(p.replace)) {
    p.ready = false;
    console.log('  ⚠️  Already applied');
  } else {
    p.ready = false;
    allApplied = false;
    console.log('  ❌ Pattern not found - may need update for newer version');
  }
}

// Dry run mode - just preview
if (isDryRun) {
  console.log('\n📋 DRY RUN - No changes will be made\n');
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    console.log(`Patch ${i + 1} (${p.name}): ${p.ready ? 'WOULD APPLY' : 'SKIP'}`);
  }
  if (anyToApply) {
    console.log('\nRun without --dry-run to apply patches.');
  }
  process.exit(0);
}

// Apply patches
if (!anyToApply) {
  if (allApplied) {
    console.log('\n⚠️  All patches already applied.');
  } else {
    console.error('\n❌ No patches to apply');
    console.error('Patches may already be applied or version may have changed.');
    console.error('Run with --dry-run to see details.');
  }
  process.exit(allApplied ? 0 : 1);
}

// Create backup if it doesn't exist
if (!fs.existsSync(backupPath)) {
  console.log('\nCreating backup...');
  fs.copyFileSync(targetPath, backupPath);
  console.log(`✅ Backup created: ${backupPath}`);
}

console.log('\nApplying patches...');

for (let i = 0; i < patches.length; i++) {
  const p = patches[i];
  if (p.ready) {
    content = content.replace(p.search, p.replace);
    console.log(`✅ Patch ${i + 1} applied: ${p.name}`);
  }
}

// Write file
console.log('\nWriting patched file...');
fs.writeFileSync(targetPath, content, 'utf8');
console.log('✅ File written successfully');

console.log('\n🎉 Patch applied! Please restart Claude Code for changes to take effect.');
console.log('\nTo restore original behavior, run: node patch-tool-visibility.js --restore');
process.exit(0);
