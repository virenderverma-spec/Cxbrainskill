import { OpenAPIParser, ParsedEndpoint } from '../utils/openapiParser.js';
import { SchemaMapper } from '../utils/schemaMapper.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { OpenAPIV3 } from 'openapi-types';

export interface GeneratedTool extends Tool {
  endpoint: ParsedEndpoint;
  handler: string;
}

export class ToolGenerator {
  private parser: OpenAPIParser;
  private mapper: SchemaMapper;

  constructor(openAPISpecPath?: string) {
    this.parser = new OpenAPIParser(openAPISpecPath);
    this.mapper = new SchemaMapper();
  }

  /**
   * Generate all MCP tools from OpenAPI spec
   */
  generateAllTools(): GeneratedTool[] {
    const endpoints = this.parser.parseEndpoints();
    return endpoints.map((endpoint) => this.generateTool(endpoint));
  }

  /**
   * Generate MCP tool from OpenAPI endpoint
   */
  generateTool(endpoint: ParsedEndpoint): GeneratedTool {
    const operationId = this.sanitizeOperationId(endpoint.operationId);
    const description = this.buildDescription(endpoint);
    const inputSchema = this.buildInputSchema(endpoint);

    return {
      name: operationId,
      description,
      inputSchema,
      endpoint,
      handler: operationId,
    };
  }

  /**
   * Sanitize operation ID for MCP tool name
   */
  private sanitizeOperationId(operationId: string): string {
    return operationId
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }

  /**
   * Build tool description from OpenAPI operation
   */
  private buildDescription(endpoint: ParsedEndpoint): string {
    const parts: string[] = [];

    if (endpoint.operation.summary) {
      parts.push(endpoint.operation.summary);
    }

    if (endpoint.operation.description) {
      parts.push(endpoint.operation.description);
    }

    if (parts.length === 0) {
      parts.push(`${endpoint.method} ${endpoint.path}`);
    }

    // Add tags
    if (endpoint.tags.length > 0) {
      parts.push(`\nTags: ${endpoint.tags.join(', ')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Build input schema for MCP tool
   */
  private buildInputSchema(endpoint: ParsedEndpoint): Tool['inputSchema'] {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Add path parameters
    for (const param of endpoint.parameters) {
      if (param.in === 'path') {
        const mapped = this.mapper.mapParameter(param);
        properties[mapped.name] = mapped.schema;
        if (mapped.required) {
          required.push(mapped.name);
        }
      }
    }

    // Add query parameters
    for (const param of endpoint.parameters) {
      if (param.in === 'query') {
        const mapped = this.mapper.mapParameter(param);
        properties[mapped.name] = mapped.schema;
        if (mapped.required) {
          required.push(mapped.name);
        }
      }
    }

    // Add request body
    if (endpoint.requestBody) {
      const bodySchema = this.mapper.mapRequestBody(endpoint.requestBody);
      if (bodySchema) {
        if (bodySchema.type === 'object' && bodySchema.properties) {
          // Merge body properties
          Object.assign(properties, bodySchema.properties);
          if (bodySchema.required) {
            required.push(...bodySchema.required);
          }
        } else {
          // Body is a single value
          properties.body = bodySchema;
        }
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  /**
   * Get tools by tag
   */
  getToolsByTag(tag: string): GeneratedTool[] {
    const endpoints = this.parser.getEndpointsByTag(tag);
    return endpoints.map((endpoint) => this.generateTool(endpoint));
  }

  /**
   * Get all tags
   */
  getTags(): string[] {
    return this.parser.getTags();
  }
}


