import { open } from "node:fs/promises";

export async function fileExists(path) {
  let filehandle = null;
  try {
    filehandle = await open(path, "r+");
    return true;
  } catch (err) {
    return false;
  } finally {
    filehandle?.close();
  }
}
