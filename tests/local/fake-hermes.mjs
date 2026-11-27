// Stand-in for `hermes gateway run`: answers /health and /v1/models on API_SERVER_PORT, like the real API server does.
import http from 'node:http';

const port = Number(process.env.API_SERVER_PORT);
const key = process.env.API_SERVER_KEY ?? '';
if (process.argv[2] !== 'gateway' || !port) { console.error('fake-hermes: expected `gateway run` and API_SERVER_PORT'); process.exit(2); }

http.createServer((req, res) => {
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/health') return json(200, { status: 'ok', version: 'fake-1' });
  if (req.headers.authorization !== `Bearer ${key}`) return json(401, { error: 'bad key' });
  if (req.url === '/v1/models') return json(200, { data: [{ id: 'fake' }] });
  json(404, {});
}).listen(port, '127.0.0.1');
// Lets the test see which home and ports the server gave this gateway.
console.log(JSON.stringify({ home: process.env.HERMES_HOME, port, host: process.env.API_SERVER_HOST, pid: process.pid }));
