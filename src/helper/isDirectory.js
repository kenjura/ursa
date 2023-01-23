import { lstat } from "fs/promises";

export async function isDirectory(pathname) {
  const stats = await lstat(pathname);
  try {
    return stats.isDirectory();
  } catch (err) {
    console.error(`isDirectory > failed to stat ${pathname}:`, err);
  }
}
