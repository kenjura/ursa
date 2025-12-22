// Progress reporter for build

export class ProgressReporter {
  constructor() {
    this.lines = {};
    this.isTTY = process.stdout.isTTY;
  }
  status(name, message) {
    if (this.isTTY) {
      const line = `${name}: ${message}`;
      this.lines[name] = line;
      process.stdout.write(`\r\x1b[K${line}`);
    }
  }
  done(name, message) {
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[K${name}: ${message}\n`);
    } else {
      console.log(`${name}: ${message}`);
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
  clear() {
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[K`);
    }
  }
}
