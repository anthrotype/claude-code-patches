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
  console.log('Claude Code Thinking Visibility Patcher v2.1.87');
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

console.log('Claude Code Thinking Visibility Patcher v2.1.87');
console.log('==============================================\n');

// Helper function to safely execute shell commands
function safeExec(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    return null;
  }
}

// Detect whether a file is a compiled binary (Mach-O/ELF) or plain JS.
function isBinaryFile(filePath) {
  const header = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, header, 0, 4, 0);
  fs.closeSync(fd);
  const magic = header.readUInt32BE(0);
  const machOMagics = new Set([
    0xcffaedfe, // MH_MAGIC_64 (little-endian, arm64/x86_64)
    0xfeedface, // MH_MAGIC (32-bit big-endian)
    0xfeedfacf, // MH_MAGIC_64 (big-endian)
    0xcefaedfe, // MH_MAGIC (little-endian 32-bit)
    0xcafebabe, // FAT_MAGIC (universal binary)
    0xbebafeca, // FAT_MAGIC (swapped)
    0xcafebabf, // FAT_MAGIC_64
    0xbfbafeca, // FAT_MAGIC_64 (swapped)
  ]);
  const isELF = magic === 0x7f454c46; // \x7fELF
  return machOMagics.has(magic) || isELF;
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

  // PRIORITY 0: Bun compiled binary
  // The symlink at ~/.local/bin/claude points to ~/.local/share/claude/versions/<version>
  const claudeSymlink = path.join(homeDir, '.local', 'bin', 'claude');
  const found0 = checkPath(claudeSymlink, 'local bin symlink');
  if (found0) return found0;

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
        // If it's a compiled binary, return it directly
        if (isBinaryFile(realBinary)) return realBinary;
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
    console.error('  - ~/.local/bin/claude (Bun binary)');
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

const binary = isBinaryFile(targetPath);
console.log(`Found Claude Code at: ${targetPath}\n`);

const backupPath = targetPath + '.backup';

// Restore from backup
if (isRestore) {
  if (!fs.existsSync(backupPath)) {
    console.error('❌ Error: Backup file not found at:', backupPath);
    process.exit(1);
  }

  console.log('Restoring from backup...');
  const restoreTmp = targetPath + '.restoring';
  fs.copyFileSync(backupPath, restoreTmp);
  fs.renameSync(restoreTmp, targetPath);
  console.log('✅ Restored successfully!');
  console.log('\nPlease restart Claude Code for changes to take effect.');
  process.exit(0);
}

// Read file
console.log('Reading file...');
if (!fs.existsSync(targetPath)) {
  console.error('❌ Error: File not found at:', targetPath);
  process.exit(1);
}

const buf = fs.readFileSync(targetPath);

// Thinking Visibility Patch (v2.1.87)
// Forces thinking content to always be visible in the CLI output.
//
// Three-layer gating (since v2.1.31+ memo cache structure):
// The case"thinking" handler has THREE independent layers that all suppress
// thinking output. The replacement must fix ALL THREE or thinking stays invisible:
//
//   Layer 1 — Early return guard: if(!j&&!T)return null
//     Returns null when not in transcript mode (j=false) AND not verbose (T=false).
//     Fix: Change to if(0)return null — makes it dead code.
//
//   Layer 2 — Component prop: isTranscriptMode:j
//     Controls whether the thinking component shows content or is collapsed.
//     Fix: Change to isTranscriptMode:!0
//
//   Layer 3 — hideInTranscript: Z = j && !(!X||P===X)
//     In transcript mode (j=true), hides all thinking blocks except the last.
//     The BB_ component does `if(hideInTranscript) return null`.
//     Fix: Change to Z=!1 (always false) — never hide thinking.
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
// v2.1.87 (binary patching via same-length Buffer.copy):
//   darwin-arm64: BB_, guard if(!j&&!T), t4.createElement, _[31-36]
//   darwin-x64:   (not yet extracted — assumed same as arm64, needs verification)
//   linux-x64:    mB$, guard if(!j&&!z), t4.createElement, $[31-36]
//   linux-arm64:  mBq, guard if(!D&&!H), t5.createElement, _[31-36]
//   win32-x64:    CB8, guard if(!j&&!z), t4.createElement, $[31-36]
//   win32-arm64:  IB6, guard if(!M&&!$), t5.createElement, _[31-36]

// Per-platform search/replace patterns. Minified names differ per platform binary.
// Each pair is exactly 283 bytes (all ASCII, verified at startup).
const platformPatterns = [
  { // darwin-arm64
    search:  'case"thinking":{if(!j&&!T)return null;let Z=j&&!(!X||P===X),k;if(_[31]!==$||_[32]!==j||_[33]!==q||_[34]!==Z||_[35]!==T)k=t4.createElement(BB_,{addMargin:$,param:q,isTranscriptMode:j,verbose:T,hideInTranscript:Z}),_[31]=$,_[32]=j,_[33]=q,_[34]=Z,_[35]=T,_[36]=k;else k=_[36];return k}',
    replace: 'case"thinking":{if(0)return null;let Z=!1,k;                 if(_[31]!==$||_[32]!==j||_[33]!==q||_[34]!==Z||_[35]!==T)k=t4.createElement(BB_,{addMargin:$,param:q,isTranscriptMode:!0,verbose:T,hideInTranscript:Z}),_[31]=$,_[32]=j,_[33]=q,_[34]=Z,_[35]=T,_[36]=k;else k=_[36];return k}',
  },
  { // linux-arm64
    search:  'case"thinking":{if(!D&&!H)return null;let k=D&&!(!W||M===W),R;if(_[31]!==O||_[32]!==D||_[33]!==K||_[34]!==k||_[35]!==H)R=t5.createElement(mBq,{addMargin:O,param:K,isTranscriptMode:D,verbose:H,hideInTranscript:k}),_[31]=O,_[32]=D,_[33]=K,_[34]=k,_[35]=H,_[36]=R;else R=_[36];return R}',
    replace: 'case"thinking":{if(0)return null;let k=!1,R;                 if(_[31]!==O||_[32]!==D||_[33]!==K||_[34]!==k||_[35]!==H)R=t5.createElement(mBq,{addMargin:O,param:K,isTranscriptMode:!0,verbose:H,hideInTranscript:k}),_[31]=O,_[32]=D,_[33]=K,_[34]=k,_[35]=H,_[36]=R;else R=_[36];return R}',
  },
  { // linux-x64
    search:  'case"thinking":{if(!j&&!z)return null;let T=j&&!(!L||P===L),k;if($[31]!==K||$[32]!==j||$[33]!==q||$[34]!==T||$[35]!==z)k=t4.createElement(mB$,{addMargin:K,param:q,isTranscriptMode:j,verbose:z,hideInTranscript:T}),$[31]=K,$[32]=j,$[33]=q,$[34]=T,$[35]=z,$[36]=k;else k=$[36];return k}',
    replace: 'case"thinking":{if(0)return null;let T=!1,k;                 if($[31]!==K||$[32]!==j||$[33]!==q||$[34]!==T||$[35]!==z)k=t4.createElement(mB$,{addMargin:K,param:q,isTranscriptMode:!0,verbose:z,hideInTranscript:T}),$[31]=K,$[32]=j,$[33]=q,$[34]=T,$[35]=z,$[36]=k;else k=$[36];return k}',
  },
  { // win32-arm64
    search:  'case"thinking":{if(!M&&!$)return null;let k=M&&!(!Z||W===Z),N;if(_[31]!==z||_[32]!==M||_[33]!==K||_[34]!==k||_[35]!==$)N=t5.createElement(IB6,{addMargin:z,param:K,isTranscriptMode:M,verbose:$,hideInTranscript:k}),_[31]=z,_[32]=M,_[33]=K,_[34]=k,_[35]=$,_[36]=N;else N=_[36];return N}',
    replace: 'case"thinking":{if(0)return null;let k=!1,N;                 if(_[31]!==z||_[32]!==M||_[33]!==K||_[34]!==k||_[35]!==$)N=t5.createElement(IB6,{addMargin:z,param:K,isTranscriptMode:!0,verbose:$,hideInTranscript:k}),_[31]=z,_[32]=M,_[33]=K,_[34]=k,_[35]=$,_[36]=N;else N=_[36];return N}',
  },
  { // win32-x64
    search:  'case"thinking":{if(!j&&!z)return null;let T=j&&!(!J||X===J),V;if($[31]!==K||$[32]!==j||$[33]!==q||$[34]!==T||$[35]!==z)V=t4.createElement(CB8,{addMargin:K,param:q,isTranscriptMode:j,verbose:z,hideInTranscript:T}),$[31]=K,$[32]=j,$[33]=q,$[34]=T,$[35]=z,$[36]=V;else V=$[36];return V}',
    replace: 'case"thinking":{if(0)return null;let T=!1,V;                 if($[31]!==K||$[32]!==j||$[33]!==q||$[34]!==T||$[35]!==z)V=t4.createElement(CB8,{addMargin:K,param:q,isTranscriptMode:!0,verbose:z,hideInTranscript:T}),$[31]=K,$[32]=j,$[33]=q,$[34]=T,$[35]=z,$[36]=V;else V=$[36];return V}',
  },
];

// Sanity-check: all search/replace pairs must be the same byte length.
for (const pat of platformPatterns) {
  const sLen = Buffer.byteLength(pat.search);
  const rLen = Buffer.byteLength(pat.replace);
  if (sLen !== rLen) {
    console.error(`FATAL: search/replace byte length mismatch: ${sLen} vs ${rLen}`);
    process.exit(1);
  }
}

// Try each platform pattern against the binary
let searchBuf = null;
let replaceBuf = null;
let patchApplied = false;
let occurrences = 0;

console.log('Checking patch...\n');

console.log('Patch: Thinking visibility (three-layer fix)');

for (const pat of platformPatterns) {
  const sBuf = Buffer.from(pat.search);
  const rBuf = Buffer.from(pat.replace);

  // Count search pattern occurrences
  let count = 0;
  let idx = 0;
  while ((idx = buf.indexOf(sBuf, idx)) !== -1) {
    count++;
    idx += sBuf.length;
  }

  if (count > 0) {
    searchBuf = sBuf;
    replaceBuf = rBuf;
    occurrences = count;
    patchApplied = true;
    console.log(`  ✅ Pattern found (${count} occurrence${count > 1 ? 's' : ''}) - ready to apply`);
    break;
  }

  // Check if already applied
  if (buf.indexOf(rBuf) !== -1) {
    console.log('  ⚠️  Already applied');
    searchBuf = null; // signal already applied
    break;
  }
}

if (!patchApplied && searchBuf !== null) {
  console.log('  ❌ Pattern not found - may need update for newer version');
}

// Dry run mode - just preview
if (isDryRun) {
  console.log('\n📋 DRY RUN - No changes will be made\n');
  console.log('Summary:');
  console.log(`- Thinking visibility: ${patchApplied ? 'WOULD APPLY' : 'SKIP'}`);

  if (patchApplied) {
    console.log('\nRun without --dry-run to apply patches.');
  }
  process.exit(0);
}

// Apply patch
if (!patchApplied) {
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

let patched = 0;
let idx = 0;
while ((idx = buf.indexOf(searchBuf, idx)) !== -1) {
  replaceBuf.copy(buf, idx);
  patched++;
  idx += searchBuf.length;
}

// Atomic write: write to a temp file, sign it, then rename into place.
// This avoids both partial-write corruption and the window where the binary
// exists at the final path but has an invalid code signature.
const origMode = fs.statSync(targetPath).mode;
const tmpPath = targetPath + '.patching';
fs.writeFileSync(tmpPath, buf);
fs.chmodSync(tmpPath, origMode);

// Re-sign binary on macOS (modifying a signed Mach-O invalidates the code signature,
// and macOS will SIGKILL the process on launch if the signature doesn't verify).
// Sign the temp file BEFORE renaming so the final path is always valid.
if (binary && process.platform === 'darwin') {
  console.log('Re-signing binary (macOS code signature)...');
  try {
    execSync(`codesign --force --sign - "${tmpPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('✅ Binary re-signed with ad-hoc signature');
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    console.error('\n❌ FATAL: Failed to re-sign binary. The original binary is untouched.');
    console.error('\n   To re-sign manually after patching:');
    console.error(`   codesign --force --sign - "${targetPath}"`);
    process.exit(1);
  }
}

fs.renameSync(tmpPath, targetPath);

console.log(`✅ Patched ${patched} occurrence${patched > 1 ? 's' : ''}\n`);

console.log('Summary:');
console.log('- Thinking visibility: APPLIED');
console.log('\n🎉 Patch applied! Please restart Claude Code for changes to take effect.');
console.log('\nTo restore original behavior, run: node patch-thinking.js --restore');
process.exit(0);
