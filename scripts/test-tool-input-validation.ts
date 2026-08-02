import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { PhotoshopMCPServer } from '../src/core/server.js';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';

const TEST_TOOL_NAME = 'test_schema_validation';

type TestServerInternals = PhotoshopMCPServer & {
  toolRegistry: ToolRegistry;
  inputSchemaValidator: AjvJsonSchemaValidator;
  registerToolDefinition(definition: ToolDefinition): void;
};

function createTestServer(): TestServerInternals {
  // Exercise the real registration method without constructing the production
  // server (which would register every Photoshop tool or start a bridge).
  const server = Object.create(PhotoshopMCPServer.prototype) as TestServerInternals;
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
  return server;
}

function resultEnvelope(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((content) => content.type === 'text')?.text;
  assert.equal(typeof text, 'string');
  return JSON.parse(text as string) as { code?: string; ok?: boolean; message?: string };
}

const inputSchema = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    amount: { type: 'number', minimum: 0, maximum: 10 },
    mode: { type: 'string', enum: ['fast', 'safe'] },
    nested: {
      type: 'object',
      properties: { note: { type: 'string' } },
    },
  },
  required: ['label', 'amount', 'mode'],
};
const originalSchema = JSON.stringify(inputSchema);

let handlerCalls = 0;
let transportCalls = 0;
let receivedArgs: Record<string, unknown> | undefined;
const testServer = createTestServer();
testServer.registerToolDefinition({
  tool: {
    name: TEST_TOOL_NAME,
    description: 'Focused schema validation regression tool',
    inputSchema,
  },
  handler: async (args) => {
    handlerCalls += 1;
    transportCalls += 1;
    receivedArgs = args;
    return { content: [{ type: 'text' as const, text: 'handler reached' }] };
  },
});

const registeredTool = testServer.toolRegistry.list().find((tool) => tool.name === TEST_TOOL_NAME);
assert.ok(registeredTool, 'registered test tool should be listed');
const registeredSchema = registeredTool.inputSchema as Record<string, unknown>;

const validArgs = {
  label: 'example',
  amount: 5,
  mode: 'fast',
  nested: { note: 'kept', extraNestedField: true },
};
const validResult = await testServer.toolRegistry.execute(TEST_TOOL_NAME, validArgs);
assert.equal(validResult.isError, undefined);
assert.equal(handlerCalls, 1, 'valid arguments should reach the handler');
assert.equal(transportCalls, 1, 'valid arguments should reach transport execution');
assert.equal(receivedArgs, validArgs, 'valid arguments must preserve object identity');

const invalidCases: Array<{ name: string; args: Record<string, unknown> }> = [
  {
    name: 'numeric code-shaped string',
    args: { label: 'example', amount: '5', mode: 'fast' },
  },
  {
    name: 'enum escape',
    args: { label: 'example', amount: 5, mode: 'turbo' },
  },
  {
    name: 'missing required field',
    args: { amount: 5, mode: 'fast' },
  },
  {
    name: 'out-of-range number',
    args: { label: 'example', amount: 11, mode: 'fast' },
  },
  {
    name: 'NaN',
    args: { label: 'example', amount: Number.NaN, mode: 'fast' },
  },
  {
    name: 'Infinity',
    args: { label: 'example', amount: Number.POSITIVE_INFINITY, mode: 'fast' },
  },
  {
    name: 'unknown root field',
    args: { label: 'example', amount: 5, mode: 'fast', unexpected: true },
  },
];

for (const invalidCase of invalidCases) {
  const beforeHandlerCalls = handlerCalls;
  const beforeTransportCalls = transportCalls;
  const result = await testServer.toolRegistry.execute(TEST_TOOL_NAME, invalidCase.args);

  assert.equal(handlerCalls, beforeHandlerCalls, `${invalidCase.name} must not reach handler`);
  assert.equal(
    transportCalls,
    beforeTransportCalls,
    `${invalidCase.name} must not reach transport`
  );
  assert.equal(result.isError, true, `${invalidCase.name} should return an error result`);

  const envelope = resultEnvelope(result);
  assert.equal(envelope.ok, false, `${invalidCase.name} should return a normal error envelope`);
  assert.equal(
    envelope.code,
    'invalid_tool_arguments',
    `${invalidCase.name} should be classified as invalid_tool_arguments`
  );
  assert.match(envelope.message ?? '', /^Invalid tool arguments:/);
}

assert.equal(JSON.stringify(inputSchema), originalSchema, 'caller schema must not be mutated');
assert.equal(registeredSchema.additionalProperties, false, 'root object schema must be closed');
const registeredProperties = registeredSchema.properties as Record<string, unknown>;
const registeredNested = registeredProperties.nested as Record<string, unknown>;
assert.equal(
  registeredNested.additionalProperties,
  undefined,
  'nested object schemas must remain open'
);

console.log('tool input validation regression: all assertions passed');
