import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { releaseVersion } from './version.mjs';

const env = process.env;
for (const key of ['APPLE_SIGNING_IDENTITY', 'SPARKLE_PUBLIC_KEY', 'COMPANION_UPDATE_BASE_URL']) {
  if (!env[key]) throw Error(`Missing repository variable ${key}`);
}
const channel = env.RELEASE_CHANNEL;
if (!['production', 'beta'].includes(channel)) throw Error('Invalid channel');
const base = new URL(env.COMPANION_UPDATE_BASE_URL);
if (base.protocol !== 'https:') throw Error('HTTPS update host required');
const pkg = JSON.parse(fs.readFileSync('package.json'));
const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).trim().split('\n');
const version = releaseVersion(pkg.version, tags, env.RELEASE_BUMP, env.RELEASE_VERSION?.trim());
const tag = `v${version}${channel === 'beta' ? '-beta' : ''}`;
if (tags.includes(tag)) throw Error(`Release ${tag} already exists`);
pkg.version = version;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const prefix = channel === 'beta' ? 'beta/arm64' : 'arm64';
const url = base.href.replace(/\/$/, '') + (channel === 'beta' ? '/beta' : '');
fs.appendFileSync(env.GITHUB_ENV, `COMPANION_VERSION=${version}\nCOMPANION_UPDATE_BASE_URL=${url}\n`);
fs.appendFileSync(env.GITHUB_OUTPUT, `version=${version}\nprefix=${prefix}\n`);
fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Companion ${version}\n\nChannel: ${channel}\n\nUpdate feed: ${url}/arm64/appcast.xml\n`);
