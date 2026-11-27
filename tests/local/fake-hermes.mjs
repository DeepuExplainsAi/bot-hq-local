// Stand-in for `hermes gateway run`: answers /health and /v1/models on API_SERVER_PORT, like the real API server does.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// Like Hermes, take the API server settings from $HERMES_HOME/.env.
const dotenv = Object.fromEntries(fs.readFileSync(path.join(process.env.HERMES_HOME, '.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const port = Number(dotenv.API_SERVER_PORT);
const key = dotenv.API_SERVER_KEY ?? '';
if (process.argv[2] !== 'gateway' || !port) { console.error('fake-hermes: expected `gateway run` and API_SERVER_PORT in .env'); process.exit(2); }

const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};

// Like an agent that uses its `hq` tools: calls the app's MCP server with the url and key from this gateway's config.
async function callHq(tool, args) {
  const cfg = fs.readFileSync(path.join(process.env.HERMES_HOME, 'config.yaml'), 'utf8');
  const url = cfg.match(/url: (\S+\/mcp\/\S+)/)[1];
  const auth = cfg.match(/Authorization: (?:"|')?(Bearer \S+?)(?:"|')?\s*$/m)[1];
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }) });
  return r.text();
}

http.createServer((req, res) => {
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/health') return json(200, { status: 'ok', version: 'fake-1' });
  if (req.headers.authorization !== `Bearer ${key}`) return json(401, { error: 'bad key' });
  if (req.url === '/v1/models') return json(200, { data: [{ id: 'fake' }] });
  if (req.method === 'POST' && req.url === '/v1/responses') {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', async () => {
      const input = String(JSON.parse(raw).input ?? '');
      let extra = '';
      const make = input.match(/CREATE_ROUTINE (\S+) (\d+)/);
      if (make) extra = ` ${await callHq('create_routine', { name: make[1], prompt: `say tick ${make[2]}`, schedule: '*/2 * * * * *' }).catch((e) => `hq call failed: ${e.message}`)}`;
      sse(res, [{ type: 'response.output_text.delta', delta: `Echo: ${input}${extra}` }, { type: 'response.completed', response: {} }]);
    });
    return;
  }
  json(404, {});
}).listen(port, '127.0.0.1');
// Lets the test see which home and ports the server gave this gateway.
console.log(JSON.stringify({ home: process.env.HERMES_HOME, port, host: dotenv.API_SERVER_HOST, pid: process.pid }));
