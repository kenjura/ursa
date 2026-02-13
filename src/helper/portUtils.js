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
 * @param {number} port - The desired port
 * @returns {Promise<number>} The port to use (original or user-accepted alternative)
 * @throws {Error} If no available port is found or user declines the alternative
 */
export async function resolvePort(port) {
  const httpAvailable = await isPortAvailable(port);
  const wsAvailable = await isPortAvailable(port + 1);

  if (httpAvailable && wsAvailable) {
    return port;
  }

  const reason = !httpAvailable
    ? `Port ${port} is already in use`
    : `WebSocket port ${port + 1} is already in use`;

  console.log(`\n⚠️  ${reason}.`);
  console.log(`🔍 Searching for an available port...`);

  const alternative = await findClosestAvailablePort(port);

  if (!alternative) {
    throw new Error(
      `Could not find an available port near ${port}. Please free up a port and try again.`
    );
  }

  // Also verify the ws port for the alternative
  const altWsAvailable = await isPortAvailable(alternative + 1);
  if (!altWsAvailable) {
    // Try again, skipping this one
    const secondTry = await findClosestAvailablePort(alternative + 1);
    if (!secondTry) {
      throw new Error(
        `Could not find an available port pair (HTTP + WebSocket) near ${port}.`
      );
    }
    const accepted = await promptUser(port, secondTry);
    if (!accepted) {
      console.log('👋 Server startup cancelled.');
      process.exit(0);
    }
    return secondTry;
  }

  const accepted = await promptUser(port, alternative);
  if (!accepted) {
    console.log('👋 Server startup cancelled.');
    process.exit(0);
  }

  return alternative;
}
