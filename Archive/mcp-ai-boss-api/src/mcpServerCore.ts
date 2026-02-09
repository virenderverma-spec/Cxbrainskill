import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolGenerator, GeneratedTool } from './tools/generator.js';
import { ToolExecutor } from './tools/executor.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Core MCP Server logic that can work with both stdio and HTTP transports
 */
export class MCPServerCore {
  private server: Server;
  private toolGenerator!: ToolGenerator;
  private toolExecutor!: ToolExecutor;
  private tools: Map<string, GeneratedTool>;
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'ai-boss-api',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.tools = new Map();
  }

  /**
   * Initialize the server (load OpenAPI spec, generate tools)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    // Try to find OpenAPI spec in common locations
    let openAPIPath = process.env.OPENAPI_SPEC_PATH;
    if (!openAPIPath) {
      const possiblePaths = [
        // Lambda package root
        path.join(process.cwd(), 'openapi.json'),
        // Local development
        path.join(process.cwd(), '..', 'AI-BOSS-API', 'generated', 'openapi.json'),
        path.join(process.cwd(), 'AI-BOSS-API', 'generated', 'openapi.json'),
        path.join(__dirname, '..', '..', 'AI-BOSS-API', 'generated', 'openapi.json'),
        // Lambda layer or other locations
        path.join('/opt', 'openapi.json'),
      ];
      
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          openAPIPath = possiblePath;
          break;
        }
      }
    }
    
    if (!openAPIPath || !fs.existsSync(openAPIPath)) {
      throw new Error(
        `OpenAPI spec not found. Set OPENAPI_SPEC_PATH environment variable or ensure openapi.json exists in one of: ${JSON.stringify([
          path.join(process.cwd(), 'openapi.json'),
          path.join(process.cwd(), '..', 'AI-BOSS-API', 'generated', 'openapi.json'),
        ])}`
      );
    }
    
    this.toolGenerator = new ToolGenerator(openAPIPath);
    this.toolExecutor = new ToolExecutor();

    // Generate tools from OpenAPI spec
    this.loadTools();

    // Setup handlers
    this.setupHandlers();

    // Error handling
    this.server.onerror = (error) => {
      // Log errors to stderr only
      process.stderr.write(`[MCP Error] ${error}\n`);
    };

    this.initialized = true;
  }

  /**
   * Load tools from OpenAPI spec
   */
  private loadTools(): void {
    try {
      const generatedTools = this.toolGenerator.generateAllTools();
      
      for (const tool of generatedTools) {
        this.tools.set(tool.name, tool);
      }

      // Don't log to stdout in stdio mode - it breaks JSON-RPC protocol
    } catch (error: any) {
      // Log errors to stderr only
      process.stderr.write(`[MCP Server] Failed to load tools: ${error.message}\n`);
      throw error;
    }
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolList: Tool[] = Array.from(this.tools.values()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      return {
        tools: toolList,
      };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }

      // Don't log to stdout in stdio mode - it breaks JSON-RPC protocol

      const result = await this.toolExecutor.execute(tool, args || {});

      if (result.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: result.error?.message || 'Unknown error',
                  status: result.error?.status,
                  details: result.error?.details,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Process a JSON-RPC request (for HTTP/Lambda)
   */
  async processRequest(request: any): Promise<any> {
    await this.initialize();
    
    const { method, params, id } = request;
    
    try {
      // Handle initialize
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'ai-boss-api',
              version: '1.0.0',
            },
          },
        };
      }
      
      // Handle tools/list
      if (method === 'tools/list') {
        const toolList: Tool[] = Array.from(this.tools.values()).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
        
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: toolList,
          },
        };
      }
      
      // Handle tools/call
      if (method === 'tools/call') {
        const { name, arguments: args } = params;
        
        const tool = this.tools.get(name);
        if (!tool) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Tool not found: ${name}`,
            },
          };
        }
        
        // Don't log to stdout in stdio mode - it breaks JSON-RPC protocol
        
        const result = await this.toolExecutor.execute(tool, args || {});
        
        if (result.success) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result.data, null, 2),
                },
              ],
            },
          };
        } else {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: result.error?.message || 'Unknown error',
                      status: result.error?.status,
                      details: result.error?.details,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            },
          };
        }
      }
      
      // Unknown method
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
    } catch (error: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message || 'Unknown error',
        },
      };
    }
  }

  /**
   * Get the server instance (for stdio transport)
   */
  getServer(): Server {
    return this.server;
  }

  /**
   * Get number of loaded tools
   */
  getToolCount(): number {
    return this.tools.size;
  }
}

