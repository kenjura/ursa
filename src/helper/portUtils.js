import net from 'net';
import readline from 'readline';

/**
 * Check if a specific port is available.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

/**
 * Find the closest available port to the preferred port.
 * Searches both upward and downward from the preferred port, returning
 * the closest available one.
 * @param {number} preferred - The preferred port number
 * @param {number} [maxDistance=100] - Maximum distance to search from preferred port
 * @returns {Promise<number|null>} The closest available port, or null if none found
 */
export async function findClosestAvailablePort(preferred, maxDistance = 100) {
  for (let offset = 1; offset <= maxDistance; offset++) {
    const candidates = [];
    if (preferred + offset <= 65535) candidates.push(preferred + offset);
    if (preferred - offset >= 1024) candidates.push(preferred - offset);

    // Check both candidates (up and down) in parallel
    const results = await Promise.all(
      candidates.map(async (port) => ({
        port,
        available: await isPortAvailable(port),
      }))
    );

    // Return the first available candidate (lower offset = closer)
    // Since we push +offset first, it's preferred over -offset at the same distance
    const found = results.find((r) => r.available);
    if (found) return found.port;
  }
  return null;
}

/**
 * Find the closest port P such that both P (HTTP) and P+1 (WebSocket) are
 * available. Searches both upward and downward from the preferred port.
 * @param {number} preferred - The preferred port number
 * @param {number} [maxDistance=100] - Maximum distance to search from preferred port
 * @returns {Promise<number|null>} The closest available port pair base, or null if none found
 */
export async function findClosestAvailablePortPair(preferred, maxDistance = 100) {
  for (let offset = 1; offset <= maxDistance; offset++) {
    const candidates = [];
    if (preferred + offset <= 65534) candidates.push(preferred + offset);
    if (preferred - offset >= 1024) candidates.push(preferred - offset);

    // Check both candidates (up and down) in parallel
    const results = await Promise.all(
      candidates.map(async (port) => ({
        port,
        available: (await isPortAvailable(port)) && (await isPortAvailable(port + 1)),
      }))
    );

    // Return the first available candidate (lower offset = closer)
    // Since we push +offset first, it's preferred over -offset at the same distance
    const found = results.find((r) => r.available);
    if (found) return found.port;
  }
  return null;
}

/**
 * Prompt the user via stdin to confirm using an alternative port.
 * @param {number} originalPort
 * @param {number} alternativePort
 * @returns {Promise<boolean>} True if user accepts the alternative port
 */
function promptUser(originalPort, alternativePort) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      `⚠️  Port ${originalPort} is already in use. Use port ${alternativePort} instead? (Y/n) `,
      (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
      }
    );
  });
}

/**
 * Resolve an available port for the server. If the requested port is occupied,
 * find the closest available port and prompt the user to accept it.
 *
 * Also checks wsPort (port + 1) availability since the WebSocket server needs it.
 *
 * ## Why `strict` and the TTY check exist
 *
 * `ursa serve` is increasingly run as one process among several — a `pnpm dev`
 * that starts an app, an API and this wiki in parallel. Two things go wrong
 * there that do not go wrong at an interactive terminal:
 *
 * 1. **The prompt has nobody to answer it.** Sibling processes share stdin, so
 *    the question either hangs the whole dev command or eats a keystroke meant
 *    for another process. Hence: never prompt when stdin is not a TTY.
 * 2. **A different port is not automatically a good outcome.** Whatever embeds
 *    the wiki — an iframe, a proxy, a link — was configured with the port that
 *    was asked for. Silently serving on another one produces a broken embed
 *    with no error anywhere. Hence `strict`: fail loudly instead.
 *
 * @param {number} port - The desired port
 * @param {object} [options]
 * @param {boolean} [options.strict=false] - Fail rather than use another port
 * @param {boolean} [options.interactive] - Defaults to whether stdin is a TTY
 * @returns {Promise<number>} The port to use
 * @throws {Error} If no port is available, or `strict` and the port is taken
 */
export async function resolvePort(port, options = {}) {
  const { strict = false, interactive = Boolean(process.stdin.isTTY) } = options;

  const httpAvailable = await isPortAvailable(port);
  const wsAvailable = await isPortAvailable(port + 1);

  if (httpAvailable && wsAvailable) {
    return port;
  }

  const reason = !httpAvailable
    ? `Port ${port} is already in use`
    : `WebSocket port ${port + 1} is already in use (ursa serves hot-reload there)`;

  if (strict) {
    throw new Error(
      `${reason}. Refusing to use a different port because --strict-port was ` +
        `given. Free the port, or pass --port <n> to choose another deliberately.`
    );
  }

  console.log(`\n⚠️  ${reason}.`);
  console.log(`🔍 Searching for an available port...`);

  // The alternative must have both its HTTP port and its WebSocket port (port + 1) free
  const alternative = await findClosestAvailablePortPair(port);

  if (!alternative) {
    throw new Error(
      `Could not find an available port pair (HTTP + WebSocket) near ${port}. Please free up a port and try again.`
    );
  }

  if (!interactive) {
    // Nobody can answer the prompt; asking would hang. Be loud instead, since
    // anything pointed at the original port is now pointed at nothing.
    console.log(
      `⚠️  stdin is not a TTY, so using port ${alternative} without asking.\n` +
        `   Anything configured for port ${port} must be updated, or pass ` +
        `--strict-port to fail instead.`
    );
    return alternative;
  }

  const accepted = await promptUser(port, alternative);
  if (!accepted) {
    console.log('👋 Server startup cancelled.');
    process.exit(0);
  }

  return alternative;
}
