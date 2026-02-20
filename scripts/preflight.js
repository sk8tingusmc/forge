#!/usr/bin/env node
/**
 * Forge Preflight Check
 * Verifies native module dependencies before Electron starts.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJsonPath = path.join(root, 'package.json');

function detectShell() {
  if (process.platform === 'win32') return process.env.PSModulePath ? 'PowerShell' : 'CMD';
  if (process.platform === 'linux' && process.env.WSL_DISTRO_NAME) return `WSL ${process.env.WSL_DISTRO_NAME}`;
  return path.basename(process.env.SHELL || 'bash');
}

function getPlatformBinaries() {
  const platformArch = `${process.platform}-${process.arch}`;
  return {
    esbuild: `@esbuild/${platformArch}`,
    nodePty: `@lydell/node-pty-${platformArch}`,
    platformArch,
  };
}

function getPackageVersions() {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const esbuildVersion = pkg.optionalDependencies?.['@esbuild/win32-x64']
      || pkg.optionalDependencies?.['@esbuild/darwin-arm64']
      || pkg.optionalDependencies?.['@esbuild/linux-x64']
      || '^0.21.5';
    const nodePtyVersion = pkg.dependencies?.['@lydell/node-pty'] || '^1.1.0';
    return { esbuildVersion, nodePtyVersion };
  } catch (err) {
    console.error('[preflight] ERROR: Could not read package.json:', err.message);
    process.exit(1);
  }
}

function isPackageInstalled(packageName) {
  const packagePath = path.join(root, 'node_modules', ...packageName.split('/'));
  return fs.existsSync(packagePath);
}

const SAFE_VERSION = /^[\^~]?[\d.]+(-[\w.]+)?$/;

function installPackage(packageName, version) {
  if (version && !SAFE_VERSION.test(version)) {
    console.error(`[preflight] ERROR: Invalid version format: ${version}`);
    process.exit(1);
  }
  const packageSpec = version ? `${packageName}@${version}` : packageName;
  try {
    execSync(`npm install --no-save ${packageSpec}`, { cwd: root, stdio: 'inherit', timeout: 120000 });
    return true;
  } catch (err) {
    console.error(`[preflight] ERROR: Failed to install ${packageName}:`, err.message);
    return false;
  }
}

function checkNodeModules() {
  process.stdout.write('[preflight] Checking node_modules... ');
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    console.log('MISSING');
    console.log('[preflight] Running npm install...');
    try {
      execSync('npm install --prefer-offline --no-audit --no-fund', { cwd: root, stdio: 'inherit', timeout: 300000 });
      console.log('[preflight] npm install completed');
    } catch (err) {
      console.error('[preflight] ERROR: npm install failed:', err.message);
      process.exit(1);
    }
  } else {
    console.log('OK');
  }
}

function checkEsbuild(binaryName, version) {
  process.stdout.write(`[preflight] Checking ${binaryName}... `);
  if (isPackageInstalled(binaryName)) { console.log('OK'); return; }
  console.log('MISSING');
  if (!installPackage(binaryName, version)) { console.error('[preflight] ERROR: esbuild install failed'); process.exit(1); }
  console.log('[preflight] esbuild installed OK');
}

function checkNodePty(binaryName, version) {
  process.stdout.write(`[preflight] Checking ${binaryName}... `);
  if (isPackageInstalled(binaryName)) { console.log('OK'); return; }
  console.log('MISSING');
  if (!installPackage(binaryName, version)) { console.error('[preflight] ERROR: node-pty install failed'); process.exit(1); }
  console.log('[preflight] node-pty installed OK');
}

function getEffectivePlatform() {
  if (process.platform === 'linux' && process.env.WSL_DISTRO_NAME) return 'win32';
  return process.platform;
}

function getInstalledElectronPlatform() {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  if (fs.existsSync(path.join(dist, 'electron.exe'))) return 'win32';
  if (fs.existsSync(path.join(dist, 'Electron.app'))) return 'darwin';
  if (fs.existsSync(path.join(dist, 'electron'))) return 'linux';
  return null;
}

function checkElectronBinary() {
  process.stdout.write('[preflight] Checking electron binary... ');
  const effective = getEffectivePlatform();
  const installed = getInstalledElectronPlatform();
  if (installed === effective) { console.log('OK'); return; }
  console.log(installed ? `WRONG PLATFORM (have ${installed}, need ${effective})` : 'MISSING');
  console.log(`[preflight] Re-downloading electron for ${effective}...`);
  try {
    const electronDir = path.join(root, 'node_modules', 'electron');
    const distDir = path.join(electronDir, 'dist');
    if (fs.existsSync(distDir)) {
      try {
        if (effective === 'win32') execSync('taskkill.exe /f /im electron.exe', { stdio: 'ignore' });
        else execSync('pkill -f electron || true', { stdio: 'ignore' });
      } catch {}
      execSync(process.platform === 'win32' ? 'timeout /t 1 /nobreak >nul' : 'sleep 1', { stdio: 'ignore' });
      if (effective === 'win32' && process.platform === 'linux') {
        const winPath = distDir.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');
        execSync(`cmd.exe /c "rmdir /s /q ${winPath}"`, { stdio: 'ignore' });
      } else if (process.platform === 'win32') {
        execSync(`rmdir /s /q "${distDir}"`, { stdio: 'ignore', shell: 'cmd.exe' });
      } else {
        execSync(`rm -rf "${distDir}"`, { stdio: 'ignore' });
      }
    }
    try { fs.unlinkSync(path.join(electronDir, 'path.txt')); } catch {}
    const env = { ...process.env };
    if (effective !== process.platform) { env.npm_config_platform = effective; env.npm_config_arch = 'x64'; }
    execSync('node node_modules/electron/install.js', { cwd: root, stdio: 'inherit', timeout: 300000, env });
    console.log('[preflight] Electron binary downloaded OK');
  } catch (err) {
    console.error('[preflight] ERROR: electron download failed:', err.message);
    process.exit(1);
  }
}

function checkBetterSqlite3() {
  process.stdout.write('[preflight] Checking better-sqlite3... ');
  const effective = getEffectivePlatform();
  const nativeModule = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const markerPath = path.join(root, 'node_modules', 'better-sqlite3', '.electron-rebuild-marker');

  let needsRebuild = false;
  let reason = '';

  if (!fs.existsSync(nativeModule)) { needsRebuild = true; reason = 'native module missing'; }
  if (!needsRebuild) {
    try {
      const fd = fs.openSync(nativeModule, 'r');
      const header = Buffer.alloc(4);
      fs.readSync(fd, header, 0, 4, 0);
      fs.closeSync(fd);
      const isPE = header[0] === 0x4D && header[1] === 0x5A;
      const isELF = header[0] === 0x7F && header[1] === 0x45;
      const isMachO = (header[0] === 0xCF && header[1] === 0xFA) || (header[0] === 0xFE && header[1] === 0xED);
      if (effective === 'win32' && !isPE) { needsRebuild = true; reason = 'binary for wrong platform'; }
      else if (effective === 'linux' && !isELF) { needsRebuild = true; reason = 'binary for wrong platform'; }
      else if (effective === 'darwin' && !isMachO) { needsRebuild = true; reason = 'binary for wrong platform'; }
    } catch { needsRebuild = true; reason = 'cannot read module header'; }
  }
  if (!needsRebuild) {
    try {
      const electronPkg = path.join(root, 'node_modules', 'electron', 'package.json');
      const electronVersion = JSON.parse(fs.readFileSync(electronPkg, 'utf8')).version;
      const expected = `${effective}-x64-electron-${electronVersion}`;
      const marker = fs.readFileSync(markerPath, 'utf8').trim();
      if (marker !== expected) { needsRebuild = true; reason = 'Electron version changed'; }
    } catch { needsRebuild = true; reason = 'no rebuild marker'; }
  }

  if (!needsRebuild) { console.log('OK'); return; }
  if (effective !== process.platform) {
    console.log(`REBUILD NEEDED (${reason})`);
    console.error(`[preflight] ERROR: Native module needs ${effective} build but running on ${process.platform}.`);
    console.error(`[preflight] Run "npm run dev" from PowerShell once to rebuild, then WSL will work.`);
    process.exit(1);
  }

  console.log(`REBUILD NEEDED (${reason})`);
  console.log('[preflight] Rebuilding better-sqlite3 for Electron...');
  try {
    const rebuildCli = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
    const rebuildCmd = fs.existsSync(rebuildCli)
      ? `node "${rebuildCli}" -f -w better-sqlite3`
      : 'npx --yes @electron/rebuild -f -w better-sqlite3';
    execSync(rebuildCmd, { cwd: root, stdio: 'inherit', timeout: 120000 });
    try {
      const electronPkg = path.join(root, 'node_modules', 'electron', 'package.json');
      const electronVersion = JSON.parse(fs.readFileSync(electronPkg, 'utf8')).version;
      fs.writeFileSync(markerPath, `${effective}-x64-electron-${electronVersion}`);
    } catch {}
    console.log('[preflight] better-sqlite3 rebuilt OK');
  } catch (err) {
    console.error('[preflight] ERROR: rebuild failed:', err.message);
    process.exit(1);
  }
}

function main() {
  const shell = detectShell();
  const { esbuild, nodePty, platformArch } = getPlatformBinaries();
  const { esbuildVersion, nodePtyVersion } = getPackageVersions();

  console.log(`[preflight] Platform: ${platformArch} (${shell})`);
  console.log(`[preflight] Node: ${process.version}`);

  checkNodeModules();
  checkElectronBinary();
  checkEsbuild(esbuild, esbuildVersion);
  checkNodePty(nodePty, nodePtyVersion);
  checkBetterSqlite3();

  console.log('[preflight] All checks passed. Launching Forge...\n');
}

main();
