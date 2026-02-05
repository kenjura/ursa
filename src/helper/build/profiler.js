// Performance profiling utilities for build process

/**
 * Timer utility for profiling code sections
 */
export class Timer {
  constructor(name) {
    this.name = name;
    this.startTime = Date.now();
    this.marks = [];
  }
  
  /**
   * Mark an intermediate point in the timer
   * @param {string} label - Label for this mark
   */
  mark(label) {
    this.marks.push({
      label,
      time: Date.now(),
      elapsed: Date.now() - this.startTime
    });
  }
  
  /**
   * Stop the timer and return the elapsed time
   * @returns {number} Elapsed time in milliseconds
   */
  stop() {
    this.endTime = Date.now();
    this.elapsed = this.endTime - this.startTime;
    return this.elapsed;
  }
  
  /**
   * Get formatted elapsed time string
   * @returns {string} Formatted time (e.g., "1.23s" or "456ms")
   */
  format() {
    const ms = this.elapsed ?? (Date.now() - this.startTime);
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(2)}s`;
    }
    return `${ms}ms`;
  }
  
  /**
   * Get a summary of all marks
   * @returns {string} Summary string
   */
  summary() {
    if (this.marks.length === 0) {
      return `${this.name}: ${this.format()}`;
    }
    
    const parts = [`${this.name} total: ${this.format()}`];
    let prevTime = this.startTime;
    
    for (const mark of this.marks) {
      const delta = mark.time - prevTime;
      const deltaStr = delta >= 1000 ? `${(delta / 1000).toFixed(2)}s` : `${delta}ms`;
      parts.push(`  → ${mark.label}: ${deltaStr}`);
      prevTime = mark.time;
    }
    
    return parts.join('\n');
  }
}

/**
 * Build profiler for tracking all phases of the build process
 */
export class BuildProfiler {
  constructor() {
    this.phases = new Map();
    this.buildStart = Date.now();
    this.currentPhase = null;
  }
  
  /**
   * Start timing a build phase
   * @param {string} name - Phase name
   * @returns {Timer} The timer for this phase
   */
  startPhase(name) {
    const timer = new Timer(name);
    this.phases.set(name, timer);
    this.currentPhase = name;
    return timer;
  }
  
  /**
   * End the current phase
   * @param {string} name - Phase name (optional, uses current if not specified)
   * @returns {number} Elapsed time in milliseconds
   */
  endPhase(name) {
    const phaseName = name ?? this.currentPhase;
    const timer = this.phases.get(phaseName);
    if (timer) {
      return timer.stop();
    }
    return 0;
  }
  
  /**
   * Get the timer for a phase
   * @param {string} name - Phase name
   * @returns {Timer|undefined}
   */
  getPhase(name) {
    return this.phases.get(name);
  }
  
  /**
   * Get total elapsed build time
   * @returns {number} Milliseconds since build started
   */
  totalElapsed() {
    return Date.now() - this.buildStart;
  }
  
  /**
   * Format total elapsed time
   * @returns {string} Formatted time
   */
  formatTotal() {
    const ms = this.totalElapsed();
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(2)}s`;
    }
    return `${ms}ms`;
  }
  
  /**
   * Generate a full profiling report
   * @returns {string} Formatted report
   */
  report() {
    const lines = [
      '',
      '════════════════════════════════════════════════════════════════════════════════',
      '                         BUILD PERFORMANCE REPORT',
      '════════════════════════════════════════════════════════════════════════════════',
      ''
    ];
    
    // Sort phases by start time
    const sortedPhases = Array.from(this.phases.entries())
      .sort((a, b) => a[1].startTime - b[1].startTime);
    
    // Calculate total and find the longest phase name for formatting
    let total = 0;
    let maxNameLen = 0;
    for (const [name, timer] of sortedPhases) {
      const elapsed = timer.elapsed ?? (Date.now() - timer.startTime);
      total += elapsed;
      maxNameLen = Math.max(maxNameLen, name.length);
    }
    
    // Add each phase with a bar chart
    const barWidth = 30; // Narrower bar for better readability
    for (const [name, timer] of sortedPhases) {
      const elapsed = timer.elapsed ?? (Date.now() - timer.startTime);
      const percentage = total > 0 ? (elapsed / total) * 100 : 0;
      const barLength = Math.round((percentage / 100) * barWidth);
      const bar = '█'.repeat(barLength) + '░'.repeat(barWidth - barLength);
      const timeStr = elapsed >= 1000 ? `${(elapsed / 1000).toFixed(2)}s` : `${elapsed}ms`;
      
      lines.push(`${name.padEnd(maxNameLen + 2)} ${bar} ${timeStr.padStart(8)} (${percentage.toFixed(1).padStart(5)}%)`);
    }
    
    lines.push('');
    lines.push(`${'TOTAL'.padEnd(maxNameLen + 2)} ${'─'.repeat(barWidth)} ${this.formatTotal().padStart(8)}`);
    lines.push('');
    lines.push('════════════════════════════════════════════════════════════════════════════════');
    lines.push('');
    
    return lines.join('\n');
  }
}

// Singleton profiler instance for the build
let currentProfiler = null;

/**
 * Get or create the current build profiler
 * @param {boolean} reset - If true, create a new profiler
 * @returns {BuildProfiler}
 */
export function getProfiler(reset = false) {
  if (!currentProfiler || reset) {
    currentProfiler = new BuildProfiler();
  }
  return currentProfiler;
}

/**
 * Quick timing helper for async functions
 * @param {string} name - Operation name
 * @param {Function} fn - Async function to time
 * @returns {Promise<any>} Result of the function
 */
export async function timeAsync(name, fn) {
  const start = Date.now();
  const result = await fn();
  const elapsed = Date.now() - start;
  const timeStr = elapsed >= 1000 ? `${(elapsed / 1000).toFixed(2)}s` : `${elapsed}ms`;
  console.log(`⏱️  ${name}: ${timeStr}`);
  return result;
}
