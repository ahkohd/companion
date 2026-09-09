import { bundleRuntime, signingTargets, validateNode } from './bundle-menubar.mjs';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.platform !== 'darwin') throw new Error('The menu bar app can only be built on macOS.');
const arch = { arm64: 'arm64', x64: 'x86_64' }[process.arch];
if (!arch) throw new Error(`Unsupported macOS architecture: ${process.arch}`);
const arguments_ = process.argv.slice(2);
if (arguments_.some(arg => !['--release', '--bundle'].includes(arg))) throw new Error('Use --release or --bundle.');
const release = arguments_.includes('--release');
const bundled = release || arguments_.includes('--bundle');
const required = name => { const value = process.env[name]; if (!value) throw new Error(`${name} is required for this build.`); return value; };
const officialNode = bundled ? await validateNode(required('COMPANION_NODE_BINARY'), process.arch) : null;
const sparkleFramework = release ? path.resolve(required('SPARKLE_FRAMEWORK')) : null;
const signingIdentity = release ? required('APPLE_SIGNING_IDENTITY') : '-';
if (release && !signingIdentity.startsWith('Developer ID Application:')) throw new Error('Release builds require a Developer ID Application signing identity.');
const feed = release ? required('SPARKLE_FEED_URL') : null;
if (feed && (new URL(feed).protocol !== 'https:' || new URL(feed).username || new URL(feed).password)) throw new Error('Sparkle feed must be an HTTPS URL without credentials.');
const publicKey = release ? required('SPARKLE_PUBLIC_KEY') : null;
if (publicKey && (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey) || Buffer.from(publicKey, 'base64').length !== 32)) throw new Error('Sparkle public key must be a base64 Ed25519 public key.');
const root = fileURLToPath(new URL('../', import.meta.url));
const tools = path.join(root, '.tools');
const destination = path.join(tools, 'Companion.app');
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.COMPANION_VERSION || packageInfo.version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Version must be numeric major.minor.patch.');
const xml = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${signal || code}).`)));
});
await mkdir(tools, { recursive: true });
const temporary = await mkdtemp(path.join(tools, 'companion-menubar-build-'));
const app = path.join(temporary, 'Companion.app');
const contents = path.join(app, 'Contents');
try {
  await mkdir(path.join(contents, 'MacOS'), { recursive: true });
  await mkdir(path.join(contents, 'Resources'), { recursive: true });
  const resources = path.join(contents, 'Resources');
  await run('/usr/bin/xcrun', ['actool', '--compile', resources, '--app-icon', 'Companion', '--include-all-app-icons', '--output-partial-info-plist', path.join(temporary, 'icon-info.plist'), '--platform', 'macosx', '--minimum-deployment-target', bundled ? '13.5' : '13.0', path.join(root, 'macos/Companion/Companion.icon')]);
  if (bundled) await bundleRuntime({ root, resources, node: officialNode, run, arch });
  if (release) { await mkdir(path.join(contents, 'Frameworks'), { recursive: true }); await cp(sparkleFramework, path.join(contents, 'Frameworks/Sparkle.framework'), { recursive: true, verbatimSymlinks: true }); await cp(path.join(path.dirname(sparkleFramework), 'LICENSE'), path.join(resources, 'Licenses/Sparkle-LICENSE')); }
  const config = bundled ? { root: 'runtime', node: 'node', path: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', port: 4317, bundled: true } : { root, node: process.execPath, path: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin', port: 4317 };
  await writeFile(path.join(resources, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.companion-studio.menubar</string>
<key>CFBundleName</key><string>Companion</string>
<key>CFBundleDisplayName</key><string>Companion</string>
<key>CFBundleExecutable</key><string>Companion</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>Companion</string>
<key>CFBundleIconName</key><string>Companion</string>
<key>CFBundleShortVersionString</key><string>${xml(version)}</string>
<key>CFBundleVersion</key><string>${xml(version)}</string>
<key>LSMinimumSystemVersion</key><string>${bundled ? '13.5' : '13.0'}</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
${release ? `<key>SUFeedURL</key><string>${xml(feed)}</string><key>SUPublicEDKey</key><string>${xml(publicKey)}</string><key>SUEnableAutomaticChecks</key><true/>` : ''}
</dict></plist>\n`);
  await run('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'AppKit', '-framework', 'ServiceManagement', '-target', `${arch}-apple-macosx13.0`, ...(release ? ['-F', path.join(contents, 'Frameworks'), '-framework', 'Sparkle', '-D', 'SPARKLE', '-Xlinker', '-rpath', '-Xlinker', '@executable_path/../Frameworks'] : []), path.join(root, 'macos/Companion/main.swift'), '-o', path.join(contents, 'MacOS/Companion')]);
  await run('/usr/bin/plutil', ['-lint', path.join(contents, 'Info.plist')]);
  if (bundled) {
    const entitlements = path.join(temporary, 'node-entitlements.plist');
    // Node's official tools/osx-entitlements.plist identifies these JIT requirements.
    await writeFile(entitlements, `<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>${release ? '' : '<key>com.apple.security.cs.disable-library-validation</key><true/>'}</dict></plist>`);
    for (const target of await signingTargets(app)) {
      const node = target.path === path.join(resources, 'node');
      await run('/usr/bin/codesign', ['--force', '--options', 'runtime', ...(release ? ['--timestamp'] : []), ...(node ? ['--entitlements', entitlements] : ['--preserve-metadata=entitlements']), '--sign', signingIdentity, target.path]);
    }
    // Test native addon loading after signing, with the same runtime shipped in the app.
    await run(path.join(resources, 'node'), ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(path.join(resources, 'runtime/bridge/device.mjs')).href)}); await import(${JSON.stringify(pathToFileURL(path.join(resources, 'runtime/bridge/roon-source.mjs')).href)});`]);
  } else await run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  await rm(destination, { recursive: true, force: true });
  await rename(app, destination);
  console.log(`Built ${destination}`);
  console.log(bundled ? 'Portable runtime included. Release distribution still requires notarization and packaging.' : 'Copy the app to ~/Applications and launch it. Keep this checkout and Node runtime in place.');
} finally { await rm(temporary, { recursive: true, force: true }); }
