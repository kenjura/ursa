import { transformAsync } from "@babel/core";
import { readFile } from "fs/promises";
import { outputFile } from "fs-extra";
import recurse from "recursive-readdir";

const options = {
  presets: [
    [
      "@babel/preset-env",
      {
        modules: false,
      },
    ],
    "@babel/preset-react",
  ],
};

export async function transformAllJSXInDirectory(dir) {
  const allFiles = await recurse(dir);
  const allJSXFiles = allFiles.filter((file) => file.slice(-4) === ".jsx");
  return Promise.all(
    allJSXFiles.map(async (file) => {
      const fileContents = await readFile(file, "utf-8");
      const { code } = await transformAsync(fileContents, options);
      const newFilename = file.replace(".jsx", ".js");
      return outputFile(newFilename, code);
    })
  );
}
