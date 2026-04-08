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
  console.log('Claude Code Thinking Visibility Patcher v2.1.96');
  console.log('==============================================\n');
  console.log('Usage: node patch-thinking.js [options]\n');
  console.log('Options:');
  console.log('  --dry-run    Preview changes without applying them');
  console.log('  --restore    Restore from backup file');
  console.log('  --help, -h   Show this help message\n');
  console.log('Examples:');
  console.log('  node patch-thinking.js              # Apply patches');
  console.log('  node patch-thinking.js --dry-run    # Preview changes');
  console.log('  node patch-thinking.js --restore    # Restore original');
  process.exit(0);
}

console.log('Claude Code Thinking Visibility Patcher v2.1.96');
console.log('==============================================\n');

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

const backupPath = targetPath + '.backup';

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

// Thinking Visibility Patch (v2.1.89)
// Forces thinking content to always be visible in the CLI output.
//
// Two-layer gating (since v2.1.31+ memo cache structure):
// The case"thinking" handler has TWO independent layers that both suppress
// thinking output. The replacement must fix BOTH or thinking stays invisible:
//
//   Layer 1 — Early return guard: if(!X&&!O)return null
//     Returns null when not in transcript mode (X=false) AND not verbose (O=false).
//     Fix: Change to if(0)return null — makes it dead code.
//
//   Layer 2 — Component prop: isTranscriptMode:X
//     Controls whether the thinking component shows content or is collapsed.
//     Fix: Change to isTranscriptMode:!0
//
//   Layer 3 — hideInTranscript: k = X && !(!f||D===f)
//     In transcript mode (X=true), hides all thinking blocks except the last.
//     The Wx8 component does `if(hideInTranscript) return null`.
//     Fix: Change to k=!1 (always false) — never hide thinking.
//
// Note: Banner function (ZT2/vo4 etc.) was deprecated in v2.0.71.
//
// Version history:
// v2.1.80: rE8, guard if(!X&&!w), S3.createElement, q[31-36], banner vo4
// v2.1.81: same as v2.1.80
// v2.1.83: uL8, guard if(!P&&!w), C5.createElement, q[31-36], no banner
// v2.1.84: OC8, guard if(!P&&!w), F5.createElement, q[31-36]
// v2.1.85: Xb8, guard if(!M&&!A), U3.createElement, K[31-36], memo cache var K (not q)
// v2.1.86: MI8, guard if(!M&&!O), n3.createElement, K[31-36], verbose A→O, hideInTranscript v→T, addMargin z→Y
// v2.1.89: Wx8, guard if(!X&&!O), w9.createElement, K[34-39], guard M→X, hideInTranscript T→k, addMargin Y→z, hideInTranscript Z→f W→D
// v2.1.90: AI8, guard if(!X&&!O), H9.createElement, K[34-39], NS w9→H9, component Wx8→AI8
// v2.1.91: QI8, guard if(!X&&!O), j9.createElement, K[34-39], NS H9→j9, component AI8→QI8
// v2.1.92: Su8, guard if(!X&&!A), P9.createElement, K[34-39], verbose O→A, NS j9→P9, component QI8→Su8
// v2.1.96: $p8, guard if(!X&&!A), Z9.createElement, K[34-39], NS P9→Z9, component Su8→$p8

const thinkingSearchPattern = 'case"thinking":{if(!X&&!A)return null;let k=X&&!(!f||D===f),V;if(K[34]!==z||K[35]!==X||K[36]!==_||K[37]!==k||K[38]!==A)V=Z9.createElement($p8,{addMargin:z,param:_,isTranscriptMode:X,verbose:A,hideInTranscript:k}),K[34]=z,K[35]=X,K[36]=_,K[37]=k,K[38]=A,K[39]=V;else V=K[39];return V}';

const thinkingReplacement = 'case"thinking":{if(0)return null;let k=!1,V;if(K[34]!==z||K[35]!==X||K[36]!==_||K[37]!==k||K[38]!==A)V=Z9.createElement($p8,{addMargin:z,param:_,isTranscriptMode:!0,verbose:A,hideInTranscript:k}),K[34]=z,K[35]=X,K[36]=_,K[37]=k,K[38]=A,K[39]=V;else V=K[39];return V}';

// Broken-patch pattern: previous patch had guard fixed but hideInTranscript still active.
// Re-running the patch will fix it.
const thinkingBrokenPattern = 'case"thinking":{if(0)return null;let k=X&&!(!f||D===f),V;if(K[34]!==z||K[35]!==X||K[36]!==_||K[37]!==k||K[38]!==A)V=Z9.createElement($p8,{addMargin:z,param:_,isTranscriptMode:!0,verbose:A,hideInTranscript:k}),K[34]=z,K[35]=X,K[36]=_,K[37]=k,K[38]=A,K[39]=V;else V=K[39];return V}';

let patchApplied = false;
let patchBrokenFixed = false;

// Check if patch can be applied
console.log('Checking patch...\n');

console.log('Patch: Thinking visibility (two-layer fix)');
if (content.includes(thinkingSearchPattern)) {
  patchApplied = true;
  console.log('  ✅ Pattern found - ready to apply');
} else if (content.includes(thinkingReplacement)) {
  console.log('  ⚠️  Already applied');
} else if (content.includes(thinkingBrokenPattern)) {
  patchBrokenFixed = true;
  console.log('  ⚠️  Previous patch detected (hideInTranscript not disabled) - will fix');
} else {
  console.log('  ❌ Pattern not found - may need update for newer version');
}

// Dry run mode - just preview
if (isDryRun) {
  console.log('\n📋 DRY RUN - No changes will be made\n');
  console.log('Summary:');
  console.log(`- Thinking visibility: ${patchApplied ? 'WOULD APPLY' : patchBrokenFixed ? 'WOULD FIX BROKEN PATCH' : 'SKIP'}`);

  if (patchApplied || patchBrokenFixed) {
    console.log('\nRun without --dry-run to apply patches.');
  }
  process.exit(0);
}

// Apply patch
if (!patchApplied && !patchBrokenFixed) {
  console.error('\n❌ No patches to apply');
  console.error('Patches may already be applied or version may have changed.');
  console.error('Run with --dry-run to see details.');
  process.exit(1);
}

// Create backup if it doesn't exist
if (!fs.existsSync(backupPath)) {
  console.log('\nCreating backup...');
  fs.copyFileSync(targetPath, backupPath);
  console.log(`✅ Backup created: ${backupPath}`);
}

console.log('\nApplying patch...');

if (patchApplied) {
  content = content.replace(thinkingSearchPattern, thinkingReplacement);
  console.log('✅ Patch applied: guard disabled (if(0)) + isTranscriptMode forced to !0');
} else if (patchBrokenFixed) {
  content = content.replace(thinkingBrokenPattern, thinkingReplacement);
  console.log('✅ Broken patch fixed: guard disabled (if(0))');
}

// Write file
console.log('\nWriting patched file...');
fs.writeFileSync(targetPath, content, 'utf8');
console.log('✅ File written successfully\n');

console.log('Summary:');
console.log(`- Thinking visibility: ${patchApplied ? 'APPLIED' : 'FIXED BROKEN PATCH'}`);
console.log('\n🎉 Patch applied! Please restart Claude Code for changes to take effect.');
console.log('\nTo restore original behavior, run: node patch-thinking.js --restore');
process.exit(0);
