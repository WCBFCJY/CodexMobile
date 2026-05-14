import {execFileSync, spawn} from 'node:child_process';
import {existsSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outputDir = path.join(repoRoot, 'docs/images/codexmobile-real-ui');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 4177;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshotSize = {width: 720, height: 1280};

const scenes = [
  ['01-chat-execution', 'chat'],
  ['02-drawer-sessions', 'drawer'],
  ['03-composer-workflow', 'composer'],
  ['04-git-menu', 'git-menu'],
  ['05-file-preview', 'file-preview']
];

function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      execFileSync('curl', ['-fsS', url], {stdio: 'ignore'});
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

mkdirSync(outputDir, {recursive: true});
rmSync(outputDir, {recursive: true, force: true});
mkdirSync(outputDir, {recursive: true});

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--config', 'client/vite.config.js'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe']
});

server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  waitForServer(baseUrl);
  for (const theme of ['dark', 'light']) {
    for (const [name, scene] of scenes) {
      const output = path.join(outputDir, `real-ui-${name}-${theme}.png`);
      const params = new URLSearchParams({
        scene,
        theme,
        path: '/Users/demo/Projects/CodexMobile/README.md'
      });
      execFileSync(chrome, [
        '--headless=new',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--window-size=${screenshotSize.width},${screenshotSize.height}`,
        `--screenshot=${output}`,
        `${baseUrl}/demo/screenshots?${params.toString()}`
      ], {stdio: 'inherit'});
      if (!existsSync(output)) {
        throw new Error(`Missing screenshot ${output}`);
      }
    }
  }
  console.log(`Wrote ${scenes.length * 2} real UI screenshots to ${outputDir}`);
} finally {
  server.kill('SIGTERM');
}
