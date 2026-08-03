import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

import { PhotoshopMCPServer } from '../src/core/server.js';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import { createActionTools } from '../src/tools/action-tools.js';
import type { TransportRouter } from '../src/transport/index.js';

const REMOVED_TOOL_NAME = 'photoshop_execute_script';
const RECORDED_ACTION_TOOL_NAME = 'photoshop_play_action';

type RegistrationHarness = {
  toolRegistry: ToolRegistry;
  inputSchemaValidator: AjvJsonSchemaValidator;
  registerToolDefinition(definition: ToolDefinition): void;
  registerToolDefinitions(definitions: ToolDefinition[]): void;
};

const transportCalls: string[] = [];
const transport = {
  runScript: async (script: string) => {
    transportCalls.push(script);
    return { ok: true };
  },
} as unknown as TransportRouter;

// Exercise the production action-tool factory through the same registration
// methods that server.ts uses, without creating a Photoshop session.
const server = Object.create(PhotoshopMCPServer.prototype) as RegistrationHarness;
server.toolRegistry = new ToolRegistry();
server.inputSchemaValidator = new AjvJsonSchemaValidator(
  new Ajv({
    allErrors: true,
    strict: false,
    strictNumbers: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  })
);
server.registerToolDefinitions(createActionTools(transport));

const catalog = server.toolRegistry.list();
assert.ok(
  catalog.some((tool) => tool.name === RECORDED_ACTION_TOOL_NAME),
  'recorded Photoshop Actions must remain in the public catalog'
);
assert.ok(
  server.toolRegistry.get(RECORDED_ACTION_TOOL_NAME),
  'recorded Photoshop Actions must remain directly addressable'
);

assert.equal(
  catalog.some((tool) => tool.name === REMOVED_TOOL_NAME),
  false,
  'arbitrary caller-supplied scripts must not be advertised in the public catalog'
);
assert.equal(
  server.toolRegistry.get(REMOVED_TOOL_NAME),
  undefined,
  'arbitrary caller-supplied scripts must not have a registered handler'
);
await assert.rejects(
  () => server.toolRegistry.execute(REMOVED_TOOL_NAME, { code: 'app.beep();' }),
  /Tool not found: photoshop_execute_script/,
  'direct lookup must not reach a removed raw-script handler'
);
assert.equal(
  transportCalls.length,
  0,
  'a removed raw-script definition must not reach the Photoshop transport'
);

await server.toolRegistry.execute(RECORDED_ACTION_TOOL_NAME, {
  actionName: 'Recorded Action',
  actionSetName: 'Trusted Action Set',
});
assert.equal(transportCalls.length, 1, 'recorded Photoshop Actions must remain executable');
assert.match(transportCalls[0], /app\.doAction\("Recorded Action", "Trusted Action Set"\)/);

console.log('Custom script disablement regression: all assertions passed');
