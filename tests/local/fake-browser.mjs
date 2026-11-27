// Stands in for a bot's browser in the smoke test: the DevTools endpoints the server uses, with one picture
// and a log of the input it receives. Started like the real one (env BOTHQ_CDP_PORT, BOTHQ_BROWSER_PROFILE).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const port = Number(process.env.BOTHQ_CDP_PORT);
const log = path.join(process.env.BOTHQ_BROWSER_PROFILE, 'input.log');
const W = 64, H = 48;
// Not a decodable picture: a JPEG start, a frame header with the size, an end. Enough to pass through the relay.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, H >> 8, H & 255, W >> 8, W & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/json/version') return res.end(JSON.stringify({ Browser: 'fake/1' }));
  if (req.url === '/json/list') return res.end(JSON.stringify([{ type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/1` }]));
  res.statusCode = 404; res.end('{}');
});
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    const reply = (result = {}) => ws.send(JSON.stringify({ id: m.id, result }));
    if (m.method.startsWith('Input.')) { fs.appendFileSync(log, JSON.stringify({ method: m.method, ...m.params }) + '\n'); return reply(); }
    if (m.method === 'Page.captureScreenshot') return reply({ data: jpeg.toString('base64') });
    reply();
    if (m.method === 'Page.startScreencast') setTimeout(() => ws.send(JSON.stringify({ method: 'Page.screencastFrame', params: { data: jpeg.toString('base64'), sessionId: 1, metadata: {} } })), 100);
  });
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
