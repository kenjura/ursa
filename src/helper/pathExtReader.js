import { extname } from "path";

export function hasExt(pathname) {
  const ext = extname(pathname);
  console.log({
    pathname,
    ext,
    result: ext === "" || ext === "." ? false : true,
  });
  if (ext === "" || ext === ".") return false;
  else return true;
}
