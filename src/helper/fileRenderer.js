
import { markdownToHtml } from "./markdownHelper.cjs";


export function renderFile({ fileContents, type }) {
    switch (type) {
        case '.md': return markdownToHtml(fileContents);
    }
}