import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../utils/logger.js';
import { capture, onMcpClientConnected, onMcpClientDisconnected, recordMcpToolCall } from '../analytics/index.js';
import { ToolRegistry, ToolDefinition } from './tool-registry.js';
import { PromptRegistry } from './prompt-registry.js';
import { Session } from './session.js';
import { wrapToolHandler } from '../errors/envelope.js';
import { buildPhotoshopInstructions } from '../prompts/instructions.js';
import { registerPhotoshopPrompts } from '../prompts/registry.js';
import { createDocumentTools } from '../tools/document-tools.js';
import { createLayerTools } from '../tools/layer-tools.js';
import { createImageTools } from '../tools/image-tools.js';
import { createImagePlacementTools } from '../tools/image-placement-tools.js';
import { createLayerTransformTools } from '../tools/layer-transform-tools.js';
import { createLayerPropertiesTools } from '../tools/layer-properties-tools.js';
import { createFilterTools } from '../tools/filter-tools.js';
import { createFilterGalleryTools } from '../tools/filter-gallery-tools.js';
import { createHeavyFilterTools } from '../tools/heavy-filter-tools.js';
import { createTransformExtraTools } from '../tools/transform-extra-tools.js';
import { createAdjustmentTools } from '../tools/adjustment-tools.js';
import { createAdjustmentLayerTools } from '../tools/adjustment-layer-tools.js';
import { createTextTools } from '../tools/text-tools.js';
import { createLayerStyleTools } from '../tools/layer-style-tools.js';
import { createSmartObjectTools } from '../tools/smart-object-tools.js';
import { createSelectionTools } from '../tools/selection-tools.js';
import { createMaskTools } from '../tools/mask-tools.js';
import { createActionTools } from '../tools/action-tools.js';
import { createHistoryTools } from '../tools/history-tools.js';
import { createLayerOrderingTools } from '../tools/layer-ordering-tools.js';
import { createStateTools } from '../tools/state-tools.js';
import { createRecipeTools } from '../tools/recipes/index.js';
import { createGenerativeTools } from '../tools/generative-tools.js';
import { createNeuralTools } from '../tools/neural-tools.js';
import { ensureUxpBridgeServer } from '../platform/uxp-bridge-server.js';
import { TransportRouter } from '../transport/index.js';

export interface PhotoshopMCPServerOptions {
  serverVersion: string;
}

export class PhotoshopMCPServer {
  private server: Server;
  private logger: Logger;
  private toolRegistry: ToolRegistry;
  private promptRegistry: PromptRegistry;
  private session: Session;

  constructor(options: PhotoshopMCPServerOptions) {
    this.logger = new Logger('PhotoshopMCPServer');
    this.toolRegistry = new ToolRegistry();
    this.promptRegistry = new PromptRegistry();
    this.session = new Session();

    this.server = new Server(
      {
        name: 'photoshop-mcp',
        version: options.serverVersion,
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
        instructions: buildPhotoshopInstructions(),
      }
    );

    registerPhotoshopPrompts(this.promptRegistry);
    this.registerTools();
    this.setupHandlers();
  }

  private registerToolDefinition(definition: ToolDefinition): void {
    this.toolRegistry.register(definition.tool.name, {
      tool: definition.tool,
      handler: wrapToolHandler(definition.tool.name, definition.handler),
    });
  }

  private registerToolDefinitions(definitions: ToolDefinition[]): void {
    definitions.forEach((def) => this.registerToolDefinition(def));
  }

  private registerTools() {
    this.registerToolDefinition({
      tool: {
        name: 'photoshop_ping',
        description:
          'Verify Photoshop is installed and reachable on this machine.\n\n' +
          'Use when: once at session start if connection status is unknown.\n' +
          'Do NOT use when: on every tool call — call once, then use photoshop_get_state.\n\n' +
          'Returns: connection success or failure message.\n' +
          'Preconditions: none. Side effects: may trigger Photoshop detection.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => this.pingPhotoshop(),
    });

    this.registerToolDefinition({
      tool: {
        name: 'photoshop_get_version',
        description:
          'Return the detected Photoshop version string.\n\n' +
          'Use when: user asks about compatibility or before version-gated features.\n' +
          'Do NOT use when: you need feature flags — prefer photoshop_get_capabilities.\n\n' +
          'Returns: version string.\n' +
          'Preconditions: none. Side effects: none.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => this.getVersion(),
    });

    // Single injection point (transport-layer.md §4.4): one TransportRouter over
    // the session's PhotoshopConnection flows into every create*Tools factory in
    // place of the raw connection. The router owns backend selection, per-command
    // pins, and the one global command queue (§4.3/§6.2); tools are transport-agnostic.
    const transport = new TransportRouter(this.session.getConnection());

    void ensureUxpBridgeServer().catch((err) => {
      this.logger.debug('UXP bridge server not started:', err);
    });

    this.registerToolDefinitions(createDocumentTools(transport));
    this.registerToolDefinitions(createLayerTools(transport));
    this.registerToolDefinitions(createImageTools(transport));
    this.registerToolDefinitions(createImagePlacementTools(transport));
    this.registerToolDefinitions(createLayerTransformTools(transport));
    this.registerToolDefinitions(createLayerPropertiesTools(transport));
    this.registerToolDefinitions(createFilterTools(transport));
    this.registerToolDefinitions(createFilterGalleryTools(transport));
    this.registerToolDefinitions(createHeavyFilterTools(transport));
    this.registerToolDefinitions(createTransformExtraTools(transport));
    this.registerToolDefinitions(createAdjustmentTools(transport));
    this.registerToolDefinitions(createAdjustmentLayerTools(transport));
    this.registerToolDefinitions(createTextTools(transport));
    this.registerToolDefinitions(createLayerStyleTools(transport));
    this.registerToolDefinitions(createSmartObjectTools(transport));
    this.registerToolDefinitions(createSelectionTools(transport));
    this.registerToolDefinitions(createMaskTools(transport));
    this.registerToolDefinitions(createActionTools(transport));
    this.registerToolDefinitions(createHistoryTools(transport));
    this.registerToolDefinitions(createLayerOrderingTools(transport));
    this.registerToolDefinitions(createStateTools(transport));
    this.registerToolDefinitions(createGenerativeTools(transport));
    this.registerToolDefinitions(createNeuralTools(transport));
    this.registerToolDefinitions(createRecipeTools(transport));

    this.logger.info(
      `Registered ${this.toolRegistry.count()} tools and ${this.promptRegistry.count()} prompts`
    );
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.debug('Listing available tools');
      return { tools: this.toolRegistry.list() };
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      this.logger.debug('Listing available prompts');
      return { prompts: this.promptRegistry.list() };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const name = request.params.name;
      const args = (request.params.arguments as Record<string, string>) || {};
      this.logger.debug(`Prompt requested: ${name}`);
      capture('mcp_prompt_requested', {
        prompt_name: name,
        event_source: 'mcp',
      });
      return await this.promptRegistry.get(name, args);
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const started = Date.now();
      this.logger.debug(`Tool called: ${toolName}`);

      try {
        const args = (request.params.arguments as Record<string, unknown>) || {};
        const result = await this.toolRegistry.execute(toolName, args);
        this.session.updateActivity();
        return result;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Tool not found:')) {
          recordMcpToolCall({
            toolName,
            ok: false,
            errorCode: 'tool_not_found',
            durationMs: Date.now() - started,
          });
        }
        throw error;
      }
    });
  }

  private async pingPhotoshop() {
    const connection = this.session.getConnection();
    const isConnected = await connection.ping();
    return {
      content: [
        {
          type: 'text' as const,
          text: isConnected
            ? 'Successfully connected to Photoshop'
            : 'Failed to connect to Photoshop',
        },
      ],
    };
  }

  private async getVersion() {
    const connection = this.session.getConnection();
    const version = await connection.getVersion();
    return {
      content: [
        {
          type: 'text' as const,
          text: `Photoshop version: ${version}`,
        },
      ],
    };
  }

  isPhotoshopConnected(): boolean {
    return this.session.getConnectionStatus();
  }

  getToolCount(): number {
    return this.toolRegistry.count();
  }

  async getPhotoshopVersion(): Promise<string | undefined> {
    if (!this.session.getConnectionStatus()) return undefined;

    try {
      const version = await this.session.getConnection().getVersion();
      if (!version || version === 'Unknown') return undefined;
      return version;
    } catch {
      return undefined;
    }
  }

  async start() {
    await this.session.initialize();

    this.server.oninitialized = () => {
      onMcpClientConnected(this.server.getClientVersion());
    };
    this.server.onclose = () => {
      onMcpClientDisconnected();
    };

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.logger.info('MCP Server connected via stdio');
  }

  async stop() {
    await this.session.disconnect();
    this.logger.info('MCP Server stopped');
  }
}
