// Progress reporter for build

export class ProgressReporter {
  constructor() {
    this.lines = {};
    this.isTTY = process.stdout.isTTY;
    this.timers = new Map();
    this.buildStart = Date.now();
  }
  
  /**
   * Start timing a phase
   * @param {string} name - Phase name
   */
  startTimer(name) {
    this.timers.set(name, Date.now());
  }
  
  /**
   * Stop timing a phase and return formatted elapsed time
   * @param {string} name - Phase name
   * @returns {string} Formatted elapsed time
   */
  stopTimer(name) {
    const start = this.timers.get(name);
    if (!start) return '0ms';
    const elapsed = Date.now() - start;
    this.timers.delete(name);
    return this.formatTime(elapsed);
  }
  
  /**
   * Get elapsed time since build started
   * @returns {string} Formatted elapsed time
   */
  elapsed() {
    return this.formatTime(Date.now() - this.buildStart);
  }
  
  /**
   * Format milliseconds to a readable string
   * @param {number} ms - Milliseconds
   * @returns {string} Formatted time
   */
  formatTime(ms) {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(2)}s`;
    }
    return `${ms}ms`;
  }
  
  status(name, message) {
    if (this.isTTY) {
      const line = `${name}: ${message}`;
      this.lines[name] = line;
      process.stdout.write(`\r\x1b[K${line}`);
    }
  }
  done(name, message) {
    const timeStr = this.timers.has(name) ? ` [${this.stopTimer(name)}]` : '';
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[K${name}: ${message}${timeStr}\n`);
    } else {
      console.log(`${name}: ${message}${timeStr}`);
    }
    delete this.lines[name];
  }
  log(message) {
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[K${message}\n`);
    } else {
      console.log(message);
    }
  }
  
  /**
   * Log with timing prefix showing elapsed time since build start
   * @param {string} message - Message to log
   */
  logTimed(message) {
    const elapsed = this.elapsed();
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[K[${elapsed}] ${message}\n`);
    } else {
      console.log(`[${elapsed}] ${message}`);
    }
  }
  
  clear() {
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[K`);
    }
  }
}
