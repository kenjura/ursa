import { transformAsync } from "@babel/core";
import { readFile } from "fs/promises";
import { outputFile } from "fs-extra";
import recurse from "recursive-readdir";

const options = {
  presets: ["@babel/preset-env", "@babel/preset-react"],
};

export async function transformAllJSXInDirectory(dir) {
  const allFiles = await recurse(dir);
  const allJSXFiles = allFiles.filter((file) => file.slice(-4) === ".jsx");
  return Promise.all(
    allJSXFiles.map(async (file) => {
      const fileContents = await readFile(file, "utf-8");
      const { code, map, ast } = await transformAsync(fileContents, options);
      const newFilename = file.replace(".jsx", ".js");
      const mapFilename = file.replace(".jsx", ".js.map");
      return Promise.all([
        outputFile(newFilename, code),
        outputFile(mapFilename, map),
      ]);
    })
  );
}
