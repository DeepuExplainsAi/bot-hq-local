import { spawn } from 'node:child_process';

/**
 * Desktop mode: open a visible terminal window on this computer running `command` (a sign-in the user
 * finishes by hand). Replaces the terminal that the cloud version opened on the bot's remote screen.
 */
export async function openLocalTerminal(command: string, title: string): Promise<void> {
  const run = (cmd: string, args: string[], opts: Parameters<typeof spawn>[2] = {}) =>
    new Promise<void>((resolve, reject) => {
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });
      p.once('error', reject);
      p.once('spawn', () => { p.unref(); resolve(); });
    });

  if (process.platform === 'win32') {
    // `start` opens a new console window; /k keeps it open after the command ends.
    return run('cmd.exe', ['/d', '/c', 'start', `"${title.replace(/["%]/g, '')}"`, 'cmd.exe', '/k', command], { windowsVerbatimArguments: true, windowsHide: false });
  }
  if (process.platform === 'darwin') {
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return run('osascript', ['-e', `tell application "Terminal" to do script "${esc(command)}"`, '-e', 'tell application "Terminal" to activate']);
  }
  const keep = `${command}; echo; read -r -p "Press Enter to close" _`;
  for (const [bin, args] of [
    ['x-terminal-emulator', ['-e', 'bash', '-c', keep]],
    ['gnome-terminal', ['--title', title, '--', 'bash', '-c', keep]],
    ['konsole', ['-e', 'bash', '-c', keep]],
    ['xterm', ['-T', title, '-e', 'bash', '-c', keep]],
  ] as [string, string[]][]) {
    try { return await run(bin, args); } catch { /* not installed: try the next */ }
  }
  throw new Error('No terminal program found. Install one (for example gnome-terminal or xterm) and try again.');
}
