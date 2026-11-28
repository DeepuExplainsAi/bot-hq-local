// electron-builder never copies a "node_modules" folder through extraResources, so the server's
// dependencies are copied here, next to the server. The build fails if they are not there.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const resources = packager.platform.name === 'mac'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  const from = path.resolve(__dirname, '..', 'build', 'stage', 'node_modules');
  const to = path.join(resources, 'bothq', 'node_modules');
  fs.cpSync(from, to, { recursive: true });
  const probe = path.join(to, '@hono', 'node-server', 'package.json');
  if (!fs.existsSync(probe)) throw new Error(`server dependencies missing after pack: ${probe}`);
};
