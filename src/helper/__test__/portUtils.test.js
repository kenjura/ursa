import net from "net";
import { jest } from "@jest/globals";
import { isPortAvailable, resolvePort } from "../portUtils.js";

/** Hold a port for the duration of `fn`. */
async function withPortHeld(port, fn) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  try {
    return await fn();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** A port pair (n, n+1) that is currently free, so tests do not fight the machine. */
async function findFreePair(start = 39000) {
  for (let p = start; p < start + 400; p += 2) {
    if ((await isPortAvailable(p)) && (await isPortAvailable(p + 1))) return p;
  }
  throw new Error("no free port pair for test");
}

describe("resolvePort", () => {
  let logSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  it("returns the requested port when it and its ws port are free", async () => {
    const port = await findFreePair();
    await expect(resolvePort(port, { strict: true })).resolves.toBe(port);
  });

  describe("strict", () => {
    it("throws rather than moving when the HTTP port is taken", async () => {
      const port = await findFreePair();
      await withPortHeld(port, async () => {
        await expect(resolvePort(port, { strict: true })).rejects.toThrow(
          /already in use[\s\S]*--strict-port/
        );
      });
    });

    /*
     * The WS port is the trap: ursa serves hot-reload on port+1, so a port pair
     * is only usable if BOTH halves are free. A caller that checked only the
     * HTTP port would call this fine and then die with EADDRINUSE later.
     */
    it("throws when only the WEBSOCKET port is taken", async () => {
      const port = await findFreePair();
      await withPortHeld(port + 1, async () => {
        await expect(resolvePort(port, { strict: true })).rejects.toThrow(
          /WebSocket port/
        );
      });
    });
  });

  describe("non-interactive", () => {
    /*
     * The regression that motivated this: `ursa serve` running as one process
     * of a parallel `pnpm dev`. Prompting there hangs the whole dev command,
     * because sibling processes share stdin and nobody is reading this one.
     */
    it("falls back without prompting when stdin is not a TTY", async () => {
      const port = await findFreePair();
      const resolved = await withPortHeld(port, () =>
        resolvePort(port, { interactive: false })
      );
      expect(resolved).not.toBe(port);
      expect(typeof resolved).toBe("number");
    });

    it("says loudly which port it moved to", async () => {
      const port = await findFreePair();
      const resolved = await withPortHeld(port, () =>
        resolvePort(port, { interactive: false })
      );
      const said = logSpy.mock.calls.flat().join("\n");
      expect(said).toContain(String(resolved));
      expect(said).toMatch(/not a TTY/);
      // The whole point of being loud: whoever pointed at the old port must act.
      expect(said).toMatch(/must be updated|--strict-port/);
    });

    it("prefers strict over falling back when both are in play", async () => {
      const port = await findFreePair();
      await withPortHeld(port, async () => {
        await expect(
          resolvePort(port, { strict: true, interactive: false })
        ).rejects.toThrow(/--strict-port/);
      });
    });
  });
});
