import { exec } from 'node:child_process';
import os from 'node:os';

/**
 * Open a file or URL in the default system browser
 */
export function openInBrowser(targetPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let command = '';
    const platform = os.platform();

    if (platform === 'darwin') {
      command = `open "${targetPath}"`;
    } else if (platform === 'win32') {
      command = `start "" "${targetPath}"`;
    } else {
      command = `xdg-open "${targetPath}"`;
    }

    exec(command, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}
