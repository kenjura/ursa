/**
 * Worker pool for parallel markdown/wikitext parsing
 * Uses Node.js worker_threads to parallelize CPU-bound parsing operations
 */
import { Worker } from 'worker_threads';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Number of workers - default to CPU count minus 1, minimum 1
const DEFAULT_POOL_SIZE = Math.max(1, os.cpus().length - 1);

// Worker pool instance (singleton)
let workerPool = null;

/**
 * Promise-based task that can be resolved when worker completes
 */
class ParseTask {
  constructor(id, content, type, dirName, baseName) {
    this.id = id;
    this.content = content;
    this.type = type;
    this.dirname = dirName;
    this.basename = baseName;
    this.resolve = null;
    this.reject = null;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

/**
 * Worker wrapper with task queue
 */
class PooledWorker {
  constructor(workerPath) {
    this.worker = new Worker(workerPath);
    this.busy = false;
    this.currentTask = null;
    
    this.worker.on('message', (result) => {
      if (this.currentTask) {
        if (result.error) {
          this.currentTask.reject(new Error(result.error));
        } else {
          this.currentTask.resolve(result.result);
        }
        this.currentTask = null;
        this.busy = false;
      }
    });
    
    this.worker.on('error', (error) => {
      if (this.currentTask) {
        this.currentTask.reject(error);
        this.currentTask = null;
        this.busy = false;
      }
    });
  }
  
  /**
   * Execute a parsing task
   * @param {ParseTask} task - Task to execute
   * @returns {Promise} Promise that resolves with the result
   */
  execute(task) {
    this.busy = true;
    this.currentTask = task;
    this.worker.postMessage({
      id: task.id,
      content: task.content,
      type: task.type,
      dirname: task.dirname,
      basename: task.basename
    });
    return task.promise;
  }
  
  terminate() {
    return this.worker.terminate();
  }
}

/**
 * Worker pool for parallel parsing
 */
class ParserWorkerPool {
  constructor(size = DEFAULT_POOL_SIZE) {
    this.workers = [];
    this.taskQueue = [];
    this.taskIdCounter = 0;
    this.initialized = false;
    this.poolSize = size;
  }
  
  /**
   * Initialize the worker pool
   */
  async initialize() {
    if (this.initialized) return;
    
    const workerPath = join(__dirname, 'parseWorker.cjs');
    
    for (let i = 0; i < this.poolSize; i++) {
      try {
        const worker = new PooledWorker(workerPath);
        this.workers.push(worker);
      } catch (e) {
        console.warn(`Failed to create worker ${i}: ${e.message}`);
      }
    }
    
    this.initialized = true;
    
    if (this.workers.length === 0) {
      console.warn('⚠️  No workers could be created - falling back to main thread parsing');
    }
  }
  
  /**
   * Get an available worker or null if all busy
   */
  getAvailableWorker() {
    return this.workers.find(w => !w.busy) || null;
  }
  
  /**
   * Process queued tasks when workers become available
   */
  processQueue() {
    while (this.taskQueue.length > 0) {
      const worker = this.getAvailableWorker();
      if (!worker) break;
      
      const task = this.taskQueue.shift();
      worker.execute(task).finally(() => {
        // Process more tasks when this one completes
        this.processQueue();
      });
    }
  }
  
  /**
   * Parse content using a worker thread
   * @param {string} content - Content to parse
   * @param {string} type - File type (.md or .txt)
   * @param {string} dirName - Directory name
   * @param {string} baseName - Base name of file
   * @returns {Promise<string|null>} Parsed HTML or null if worker can't handle it
   */
  async parse(content, type, dirName, baseName) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // If no workers available, return null to indicate fallback needed
    if (this.workers.length === 0) {
      return null;
    }
    
    const task = new ParseTask(
      this.taskIdCounter++,
      content,
      type,
      dirName,
      baseName
    );
    
    const worker = this.getAvailableWorker();
    if (worker) {
      // Trigger queue processing when this task completes, so queued tasks
      // get dispatched to the now-free worker
      worker.execute(task).finally(() => this.processQueue());
      return task.promise;
    } else {
      // Queue the task
      this.taskQueue.push(task);
      this.processQueue();
      return task.promise;
    }
  }
  
  /**
   * Terminate all workers
   */
  async terminate() {
    await Promise.all(this.workers.map(w => w.terminate()));
    this.workers = [];
    this.initialized = false;
  }
  
  /**
   * Get pool statistics
   */
  getStats() {
    return {
      poolSize: this.poolSize,
      activeWorkers: this.workers.length,
      busyWorkers: this.workers.filter(w => w.busy).length,
      queuedTasks: this.taskQueue.length
    };
  }
}

/**
 * Get or create the singleton worker pool
 * @param {number} size - Pool size (only used on first call)
 * @returns {ParserWorkerPool}
 */
export function getParserPool(size = DEFAULT_POOL_SIZE) {
  if (!workerPool) {
    workerPool = new ParserWorkerPool(size);
  }
  return workerPool;
}

/**
 * Terminate the worker pool (call on shutdown)
 */
export async function terminateParserPool() {
  if (workerPool) {
    await workerPool.terminate();
    workerPool = null;
  }
}

/**
 * Parse content using worker pool with fallback
 * @param {string} content - Content to parse
 * @param {string} type - File type (.md or .txt)
 * @param {string} dirName - Directory name
 * @param {string} baseName - Base name of file
 * @param {Function} fallbackFn - Fallback function if worker can't handle it
 * @returns {Promise<string>} Parsed HTML
 */
export async function parseWithWorker(content, type, dirName, baseName, fallbackFn) {
  const pool = getParserPool();
  
  try {
    const result = await pool.parse(content, type, dirName, baseName);
    
    // If result is null, worker couldn't handle it (e.g., wikitext)
    if (result === null) {
      return fallbackFn();
    }
    
    return result;
  } catch (e) {
    // On error, fallback to main thread
    console.warn(`Worker parsing failed, falling back: ${e.message}`);
    return fallbackFn();
  }
}
