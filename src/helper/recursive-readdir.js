import { resolve } from 'path';
import { readdir } from 'fs/promises';

export async function recurse(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    const res = resolve(dir, dirent.name);
    return dirent.isDirectory() ? recurse(res) : res;
  }));
  return Array.prototype.concat(...files);
}