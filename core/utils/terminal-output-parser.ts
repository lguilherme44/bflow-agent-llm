/**
 * Utilities for parsing terminal output from common tools (node --test, tsc).
 */

export interface TestFailure {
  testName: string;
  error?: string;
  location?: string;
}

export interface BuildDiagnostic {
  filepath: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

export class TerminalOutputParser {
  /**
   * Parses output from 'node --test' (default reporter).
   */
  static parseTestFailures(stdout: string, stderr: string): TestFailure[] {
    const failures: TestFailure[] = [];
    const combined = stdout + '\n' + stderr;
    
    // Look for patterns like:
    // ✖ test name (1.23ms)
    //   AssertionError [ERR_ASSERTION]: ...
    //       at ... (filepath:line:col)
    
    const lines = combined.split('\n');
    let currentFailure: TestFailure | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Match "✖ Test Name (duration)"
      const startMatch = line.match(/✖\s+(.+?)\s+\(/);
      if (startMatch) {
        if (currentFailure) failures.push(currentFailure);
        currentFailure = { testName: startMatch[1].trim() };
        continue;
      }

      if (currentFailure) {
        // Try to find the error message
        if (line.includes('AssertionError') || line.includes('Error:')) {
          currentFailure.error = line.trim();
        }
        
        // Try to find the location
        const locMatch = line.match(/at\s+.+?\((.+?):(\d+):(\d+)\)/);
        if (locMatch && !currentFailure.location) {
          currentFailure.location = `${locMatch[1]}:${locMatch[2]}`;
        }
      }
    }
    
    if (currentFailure) failures.push(currentFailure);
    return failures;
  }

  /**
   * Parses TSC diagnostics.
   */
  static parseBuildDiagnostics(stdout: string, stderr: string): BuildDiagnostic[] {
    const diagnostics: BuildDiagnostic[] = [];
    const combined = stdout + '\n' + stderr;
    
    // Look for patterns like:
    // src/file.ts(10,5): error TS2322: Type 'string' is not assignable...
    
    const lines = combined.split('\n');
    for (const line of lines) {
      const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
      if (match) {
        diagnostics.push({
          filepath: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          code: match[4],
          message: match[5].trim()
        });
      }
    }
    
    return diagnostics;
  }

  /**
   * Suggests files related to the failures.
   */
  static suggestFiles(failures: TestFailure[] | BuildDiagnostic[]): string[] {
    const files = new Set<string>();
    for (const f of failures) {
      if ('filepath' in f) {
        files.add(f.filepath);
      } else if (f.location) {
        const path = f.location.split(':')[0];
        if (path) files.add(path);
      }
    }
    return Array.from(files);
  }
}
