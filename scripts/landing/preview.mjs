import {createServer} from 'vite';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../landing-dist/', import.meta.url));
await access(root + 'index.html').catch(() => {throw Error('Run pnpm landing:build first.');});
const server = await createServer({configFile:false,root,publicDir:false,server:{host:'127.0.0.1',port:4320,strictPort:true}});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => {await server.close();process.exit();});
