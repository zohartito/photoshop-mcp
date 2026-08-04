import { Logger } from '../utils/logger.js';
import { PhotoshopConnection } from '../platform/connection.js';

export type APIType = 'UXP' | 'ExtendScript';

export interface PhotoshopAPI {
  /**
   * Execute a script using the appropriate API
   */
  executeScript(script: string, timeoutMs?: number): Promise<unknown>;

  /**
   * Get the API type being used
   */
  getAPIType(): APIType;
}

export class PhotoshopAPIFactory {
  private logger: Logger;
  private connection: PhotoshopConnection;

  constructor(connection: PhotoshopConnection) {
    this.logger = new Logger('PhotoshopAPIFactory');
    this.connection = connection;
  }

  async createAPI(): Promise<PhotoshopAPI> {
    const info = this.connection.getPhotoshopInfo();

    if (!info) {
      throw new Error('Photoshop info not available. Please detect Photoshop first.');
    }

    // Determine which API to use based on version
    const apiType = this.determineAPIType(info.version);

    this.logger.info(`Creating ${apiType} API for Photoshop version ${info.version}`);

    if (apiType === 'UXP') {
      return new UXPPhotoshopAPI(this.connection);
    } else {
      return new ExtendScriptPhotoshopAPI(this.connection);
    }
  }

  private determineAPIType(version: string): APIType {
    // Windows COM script execution uses the legacy ExtendScript runtime.
    // UXP is only available for plugins, not for external script execution
    // Therefore, we always use ExtendScript for external automation

    this.logger.debug(
      `Using ExtendScript for version ${version} (UXP not available for external scripting)`
    );
    return 'ExtendScript';
  }
}

/**
 * UXP-based API for modern Photoshop (23.5+)
 * NOTE: UXP is not available for external Windows COM script execution.
 * This class is kept for future plugin-based implementation
 */
class UXPPhotoshopAPI implements PhotoshopAPI {
  private connection: PhotoshopConnection;

  constructor(connection: PhotoshopConnection) {
    this.connection = connection;
  }

  async executeScript(script: string, timeoutMs?: number): Promise<unknown> {
    // UXP cannot be executed externally via Windows COM.
    // Fall back to ExtendScript
    return await this.connection.executeScript(script, timeoutMs);
  }

  getAPIType(): APIType {
    return 'UXP';
  }
}

/**
 * ExtendScript-based API for legacy Photoshop (< 23.5)
 */
class ExtendScriptPhotoshopAPI implements PhotoshopAPI {
  private connection: PhotoshopConnection;

  constructor(connection: PhotoshopConnection) {
    this.connection = connection;
  }

  async executeScript(script: string, timeoutMs?: number): Promise<unknown> {
    // Wrap script in error handling
    const wrappedScript = this.wrapInErrorHandling(script);
    return await this.connection.executeScript(wrappedScript, timeoutMs);
  }

  private wrapInErrorHandling(script: string): string {
    // ExtendScript has no JSON object, so data-only JSON serialization is
    // implemented in the wrapper. Errors are surfaced with an "ERROR:"
    // prefix that platform executors translate back into thrown Errors.
    //
    // Ruler and type units are temporarily forced to pixels/points so that
    // every DOM API that accepts plain numbers (translate, textItem.size,
    // textItem.position, doc.crop bounds, etc.) behaves consistently
    // regardless of the user's Photoshop preferences. The user's original
    // preferences are restored in the finally block.
    return String.raw`
(function() {
  function __mcpJsonQuote(value) {
    var text = String(value);
    var out = '"';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var code = text.charCodeAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === '\\') out += '\\\\';
      else if (code === 8) out += '\\b';
      else if (code === 9) out += '\\t';
      else if (code === 10) out += '\\n';
      else if (code === 12) out += '\\f';
      else if (code === 13) out += '\\r';
      else if (code < 32 || code === 0x2028 || code === 0x2029) {
        var hex = code.toString(16);
        while (hex.length < 4) hex = '0' + hex;
        out += '\\u' + hex;
      } else {
        out += ch;
      }
    }
    return out + '"';
  }

  function __mcpJsonStringify(value, stack, depth) {
    if (value === null) return 'null';
    var kind = typeof value;
    if (kind === 'string') return __mcpJsonQuote(value);
    if (kind === 'number') return isFinite(value) ? String(value) : 'null';
    if (kind === 'boolean') return value ? 'true' : 'false';
    if (kind === 'undefined' || kind === 'function') return undefined;
    if (depth > 32) throw new Error('Result exceeds JSON depth limit');
    for (var seen = 0; seen < stack.length; seen++) {
      if (stack[seen] === value) throw new Error('Result contains a circular reference');
    }

    stack.push(value);
    try {
      var parts = [];
      var encoded;
      if (value instanceof Array) {
        for (var index = 0; index < value.length; index++) {
          encoded = __mcpJsonStringify(value[index], stack, depth + 1);
          parts.push(typeof encoded === 'undefined' ? 'null' : encoded);
        }
        return '[' + parts.join(',') + ']';
      }

      for (var key in value) {
        if (typeof value.hasOwnProperty === 'function' && !value.hasOwnProperty(key)) continue;
        encoded = __mcpJsonStringify(value[key], stack, depth + 1);
        if (typeof encoded !== 'undefined') {
          parts.push(__mcpJsonQuote(key) + ':' + encoded);
        }
      }
      return '{' + parts.join(',') + '}';
    } finally {
      stack.pop();
    }
  }

  var __originalRulerUnits = null;
  var __originalTypeUnits = null;
  var __origDialogs = null;
  var __origAlert = null;
  var __origConfirm = null;
  var __origPrompt = null;
  try { __originalRulerUnits = app.preferences.rulerUnits; } catch (e) {}
  try { __originalTypeUnits = app.preferences.typeUnits; } catch (e) {}
  try { __origDialogs = app.displayDialogs; } catch (e) {}
  try { app.displayDialogs = DialogModes.NO; } catch (e) {}
  if (typeof alert !== 'undefined') {
    __origAlert = alert;
    alert = function(msg) { $.writeln('[MCP] ' + msg); };
  }
  if (typeof confirm !== 'undefined') {
    __origConfirm = confirm;
    confirm = function() { $.writeln('[MCP] confirm suppressed'); return true; };
  }
  if (typeof prompt !== 'undefined') {
    __origPrompt = prompt;
    prompt = function(msg, def) {
      $.writeln('[MCP] prompt suppressed: ' + msg);
      return def || '';
    };
  }

  try {
    try { app.preferences.rulerUnits = Units.PIXELS; } catch (e) {}
    try { app.preferences.typeUnits = TypeUnits.POINTS; } catch (e) {}

    var result = (function() {
      ${script}
    })();
    if (typeof result === 'object' && result !== null) {
      return __mcpJsonStringify(result, [], 0);
    }
    return String(result);
  } catch (error) {
    return 'ERROR: ' + (error.message || String(error));
  } finally {
    try { if (__originalRulerUnits !== null) app.preferences.rulerUnits = __originalRulerUnits; } catch (e) {}
    try { if (__originalTypeUnits !== null) app.preferences.typeUnits = __originalTypeUnits; } catch (e) {}
    try { if (__origDialogs !== null) app.displayDialogs = __origDialogs; } catch (e) {}
    if (__origAlert !== null) { alert = __origAlert; }
    if (__origConfirm !== null) { confirm = __origConfirm; }
    if (__origPrompt !== null) { prompt = __origPrompt; }
  }
})();
    `.trim();
  }

  getAPIType(): APIType {
    return 'ExtendScript';
  }
}
