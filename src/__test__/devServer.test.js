import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import WebSocket from "ws";
import { createDevServer, HOT_RELOAD_PATH } from "../devServer.js";

let tempDir, dev;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ursa-dev-"));
  await mkdir(join(tempDir, "docs"), { recursive: true });
  await writeFile(join(tempDir, "index.html"), "<html><body>home</body></html>");
  await writeFile(join(tempDir, "docs", "a.html"), "<html><body>A</body></html>");
  dev = createDevServer({
    outputDir: tempDir,
    port: 0,
    host: "127.0.0.1",
    log: () => {},
    mount: (app) => app.get("/extra", (req, res) => res.send("mounted")),
  });
  await dev.listen();
});

afterEach(async () => {
  await dev.close();
  await rm(tempDir, { recursive: true, force: true });
});

const url = (path) => `http://127.0.0.1:${dev.port}${path}`;

it("serves pages by extensionless URL with the hot reload script injected", async () => {
  const res = await fetch(url("/docs/a"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const html = await res.text();
  expect(html).toContain("A");
  expect(html).toContain(HOT_RELOAD_PATH);
});

it("serves mounted routes ahead of the site", async () => {
  expect(await (await fetch(url("/extra"))).text()).toBe("mounted");
});

it("404s missing pages with a page that reloads when they appear", async () => {
  const res = await fetch(url("/nope"));
  expect(res.status).toBe(404);
  expect(await res.text()).toContain(HOT_RELOAD_PATH);
});

it("tracks the page each browser reports viewing, over the same port", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${dev.port}${HOT_RELOAD_PATH}`);
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "url", url: "/docs/a" }));
  for (let i = 0; i < 50 && dev.viewedOutputs().length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  expect(dev.viewedOutputs()).toEqual(["docs/a.html"]);
  ws.close();
});
