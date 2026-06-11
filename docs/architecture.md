# Architecture

Repository layout and module responsibilities.

← Back to [README](../README.md)

```
photoshop-mcp/
├── src/
│   ├── core/              # MCP server core
│   │   ├── server.ts      # Main MCP server
│   │   ├── session.ts     # Session management
│   │   └── tool-registry.ts  # Tool registration system
│   ├── platform/          # Platform-specific detection & execution
│   │   ├── detector.ts    # Main detector
│   │   ├── connection.ts  # Connection manager
│   │   ├── windows-detector.ts  # Windows registry detection
│   │   ├── windows-executor.ts  # Windows COM automation
│   │   ├── macos-detector.ts    # macOS Spotlight detection
│   │   └── macos-executor.ts    # macOS AppleScript execution
│   ├── api/              # Photoshop API abstractions
│   │   ├── photoshop-api.ts    # API factory
│   │   ├── batch-play.ts       # UXP batchPlay helpers (legacy)
│   │   └── extendscript.ts     # ExtendScript snippets library
│   ├── tools/            # MCP tool implementations (80 tools: 68 atomic + 12 recipe)
│   │   ├── document-tools.ts        # Document operations
│   │   ├── layer-tools.ts           # Layer creation/deletion
│   │   ├── layer-properties-tools.ts # Opacity, blend modes, etc.
│   │   ├── layer-transform-tools.ts  # Scale, rotate, move
│   │   ├── image-tools.ts           # Resize, crop
│   │   ├── image-placement-tools.ts # Place/open images
│   │   ├── filter-tools.ts          # Blur, sharpen, noise
│   │   ├── adjustment-tools.ts      # Color adjustments
│   │   ├── text-tools.ts            # Text formatting
│   │   ├── selection-tools.ts       # Selections & subject isolation
│   │   ├── mask-tools.ts            # Gradient mask blending
│   │   ├── state-tools.ts           # State, preview, capabilities
│   │   ├── action-tools.ts          # Actions & custom scripts
│   │   └── recipes/                 # 12 outcome-oriented recipe tools
│   └── utils/            # Utilities
│       └── logger.ts     # Logging system (stderr-based)
└── examples/             # Configuration examples
    ├── cursor-config.json
    └── claude-desktop-config.json
```
