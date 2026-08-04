import { Logger } from '../utils/logger.js';
import { ScriptExecutor } from './script-executor.js';

/**
 * macOS ExtendScript execution is intentionally unavailable.
 *
 * The former implementation generated AppleScript and then asked `osascript` to
 * evaluate JSX. That is not a safe serialization boundary for a discovered app
 * identity and a pathname. Do not restore it without a reviewed, non-source-code
 * Photoshop automation transport with cancellation semantics.
 */
export const MACOS_EXECUTOR_DISABLED_MESSAGE =
  'macOS Photoshop script execution is security-disabled pending a reviewed non-AppleScript transport.';

export class MacOSExecutor implements ScriptExecutor {
  private readonly logger = new Logger('MacOSExecutor');

  setAppName(_appName: string): void {
    // Retained only for PhotoshopConnection compatibility. App identities are
    // deliberately never interpolated into or passed to an AppleScript runner.
  }

  async execute(_script: string, _timeout = 30_000): Promise<unknown> {
    throw new Error(MACOS_EXECUTOR_DISABLED_MESSAGE);
  }

  async isPhotoshopRunning(): Promise<boolean> {
    return false;
  }

  async launchPhotoshop(_photoshopPath: string): Promise<void> {
    this.logger.warn(MACOS_EXECUTOR_DISABLED_MESSAGE);
    throw new Error(MACOS_EXECUTOR_DISABLED_MESSAGE);
  }

  async executeViaDoShellScript(_script: string): Promise<unknown> {
    throw new Error(MACOS_EXECUTOR_DISABLED_MESSAGE);
  }
}
