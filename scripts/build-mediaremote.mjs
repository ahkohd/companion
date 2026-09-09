import { mkdir, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Pinned BSD-3-Clause upstream sources; no download or toolchain needed at runtime.
export async function buildMediaRemote({ root, destination, run, arch = process.arch }) {
  const source = path.join(root, 'vendor/mediaremote-adapter');
  const framework = path.join(destination, 'MediaRemoteAdapter.framework');
  await mkdir(path.join(framework, 'Resources'), { recursive: true });
  const files = ['adapter/env', 'adapter/get', 'adapter/globals', 'adapter/keys', 'adapter/now_playing', 'adapter/repeat', 'adapter/seek', 'adapter/send', 'adapter/shuffle', 'adapter/speed', 'adapter/stream', 'adapter/test', 'private/MediaRemote', 'utility/Debounce', 'utility/helpers'];
  await run('/usr/bin/xcrun', ['clang', '-dynamiclib', '-O2', '-fobjc-arc', '-fvisibility=default', '-arch', arch === 'x64' ? 'x86_64' : arch, '-mmacosx-version-min=13.0', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'UniformTypeIdentifiers', '-I', path.join(source, 'include'), '-I', path.join(source, 'src'), ...files.map(file => path.join(source, 'src', `${file}.m`)), '-o', path.join(framework, 'MediaRemoteAdapter')]);
  await writeFile(path.join(framework, 'Resources/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>computer.victor.companion.mediaremote</string><key>CFBundleExecutable</key><string>MediaRemoteAdapter</string><key>CFBundlePackageType</key><string>FMWK</string><key>CFBundleVersion</key><string>0.1.0</string></dict></plist>');
  await cp(path.join(source, 'bin/mediaremote-adapter.pl'), path.join(destination, 'mediaremote-adapter.pl'));
  await cp(path.join(source, 'LICENSE'), path.join(destination, 'MediaRemoteAdapter-LICENSE'));
  await run('/usr/bin/codesign', ['--force', '--sign', '-', framework]);
}
