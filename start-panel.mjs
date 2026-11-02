// start-panel.mjs — 独立起 workmem 面板（不依赖 DSH）。
// 用法：node start-panel.mjs [port]
// 数据根：环境变量 WORKMEM_ROOT，默认 ~/.workmem；端口默认 8795，只绑 127.0.0.1。
import { startPanelServer } from './lib/panel/server.mjs';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataRoot = process.env.WORKMEM_ROOT || join(homedir(), '.workmem');
const port = Number(process.argv[2] || process.env.WORKMEM_PANEL_PORT || 8795);

const { url } = await startPanelServer(dataRoot, {
  port,
  host: '127.0.0.1',
  panelDir: resolve(here, 'panel')
});
console.log(`[workmem-panel] ${url}  dataRoot=${dataRoot}`);
