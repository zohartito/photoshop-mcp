import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { prefixExtendScriptBom } from '../utils/extendscript-file.js';
import { parseExtendScriptPayload } from '../utils/extendscript-result.js';
import { Logger } from '../utils/logger.js';
import { ScriptExecutor } from './script-executor.js';

const execFileAsync = promisify(execFile);

interface QueuedScript {
  script: string;
  deadline: number;
  settled: boolean;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class WindowsExecutor implements ScriptExecutor {
  private logger: Logger;
  private scriptQueue: QueuedScript[] = [];
  private isProcessing = false;

  constructor() {
    this.logger = new Logger('WindowsExecutor');
  }

  async execute(script: string, timeout: number = 30000): Promise<unknown> {
    if (!Number.isFinite(timeout) || timeout <= 0) {
      return Promise.reject(new Error('Script execution timeout must be a positive finite number'));
    }
    return new Promise((resolve, reject) => {
      const task: QueuedScript = {
        script,
        deadline: Date.now() + timeout,
        settled: false,
        resolve,
        reject,
      };
      const timeoutId = setTimeout(() => {
        if (task.settled) return;
        task.settled = true;
        const index = this.scriptQueue.indexOf(task);
        if (index >= 0) this.scriptQueue.splice(index, 1);
        reject(new Error('Script execution timeout'));
      }, timeout);
      const originalResolve = task.resolve;
      const originalReject = task.reject;
      task.resolve = (result) => {
        clearTimeout(timeoutId);
        if (!task.settled) {
          task.settled = true;
          originalResolve(result);
        }
      };
      task.reject = (error) => {
        clearTimeout(timeoutId);
        if (!task.settled) {
          task.settled = true;
          originalReject(error);
        }
      };
      this.scriptQueue.push(task);

      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.scriptQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.scriptQueue.length > 0) {
      const task = this.scriptQueue.shift();
      if (task) {
        try {
          if (task.settled || Date.now() >= task.deadline) {
            task.reject(new Error('Script execution timeout'));
            continue;
          }
          const result = await this.executeScript(task.script, task.deadline - Date.now());
          task.resolve(result);
        } catch (error) {
          task.reject(error instanceof Error ? error : new Error(String(error)));
          this.logger.error('Script execution failed:', error);
        }
      }
    }

    this.isProcessing = false;
  }

  private async executeScript(script: string, timeout: number): Promise<unknown> {
    // For Windows, we'll use a combination of VBScript/JScript to communicate with Photoshop via COM
    // Write script to temporary file
    const tempScriptPath = join(tmpdir(), `photoshop-script-${Date.now()}.jsx`);

    try {
      await writeFile(tempScriptPath, prefixExtendScriptBom(script), 'utf8');

      // Use VBScript to execute the JSX script via COM
      const vbsScript = this.createVBSWrapper(tempScriptPath);
      const vbsPath = join(tmpdir(), `photoshop-vbs-${Date.now()}.vbs`);

      await writeFile(vbsPath, vbsScript, 'utf8');

      try {
        // Execute VBScript
        const { stdout, stderr } = await execFileAsync('cscript', ['//nologo', vbsPath], {
          timeout,
          windowsHide: true,
        });

        if (stderr) {
          this.logger.warn('Script execution warning:', stderr);
        }

        // Parse result
        return this.parseResult(stdout);
      } finally {
        // Cleanup VBS file
        await unlink(vbsPath).catch(() => {});
      }
    } finally {
      // Cleanup JSX file
      await unlink(tempScriptPath).catch(() => {});
    }
  }

  private createVBSWrapper(jsxPath: string): string {
    return `
On Error Resume Next
Dim photoshopApp
Set photoshopApp = CreateObject("Photoshop.Application")

If Err.Number <> 0 Then
    WScript.Echo "ERROR: Failed to connect to Photoshop - " & Err.Description
    WScript.Quit 1
End If

' Execute the JSX script
Dim result
result = photoshopApp.DoJavaScript("$.evalFile('" & Replace("${jsxPath}", "\\", "\\\\") & "')")

If Err.Number <> 0 Then
    WScript.Echo "ERROR: " & Err.Description
    WScript.Quit 1
Else
    WScript.Echo result
End If
`.trim();
  }

  private parseResult(output: string): unknown {
    const trimmed = output.trim();

    // Check for error
    if (trimmed.startsWith('ERROR:')) {
      throw new Error(trimmed.substring(6).trim());
    }

    return parseExtendScriptPayload(trimmed);
  }

  async isPhotoshopRunning(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq Photoshop.exe'], {
        windowsHide: true,
      });
      return stdout.toLowerCase().includes('photoshop.exe');
    } catch {
      return false;
    }
  }

  async launchPhotoshop(photoshopPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.info(`Launching Photoshop: ${photoshopPath}`);

      const child = spawn(photoshopPath, [], {
        detached: true,
        stdio: 'ignore',
      });

      child.unref();

      // Wait a bit for Photoshop to start
      setTimeout(() => {
        resolve();
      }, 5000);

      child.on('error', (error) => {
        reject(new Error(`Failed to launch Photoshop: ${error.message}`));
      });
    });
  }
}
