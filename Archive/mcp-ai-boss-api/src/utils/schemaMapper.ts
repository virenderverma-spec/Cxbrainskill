import { OpenAPIV3 } from 'openapi-types';

export interface MCPToolSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  description?: string;
  items?: any;
  enum?: any[];
}

/**
 * Map OpenAPI schema to MCP tool input schema
 */
export class SchemaMapper {
  /**
   * Convert OpenAPI schema to MCP tool schema
   */
  mapToMCPSchema(
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined,
    openAPISpec?: OpenAPIV3.Document
  ): MCPToolSchema {
    if (!schema) {
      return { type: 'object' };
    }

    // Handle $ref
    if ('$ref' in schema) {
      if (openAPISpec) {
        const refSchema = this.resolveRef(schema.$ref, openAPISpec);
        if (refSchema) {
          return this.mapToMCPSchema(refSchema, openAPISpec);
        }
      }
      return { type: 'object' };
    }

    const openApiSchema = schema as OpenAPIV3.SchemaObject;

    // Handle different types
    switch (openApiSchema.type) {
      case 'string':
        return {
          type: 'string',
          description: openApiSchema.description,
          enum: openApiSchema.enum,
        };

      case 'number':
      case 'integer':
        return {
          type: 'number',
          description: openApiSchema.description,
        };

      case 'boolean':
        return {
          type: 'boolean',
          description: openApiSchema.description,
        };

      case 'array':
        return {
          type: 'array',
          description: openApiSchema.description,
          items: openApiSchema.items
            ? this.mapToMCPSchema(openApiSchema.items, openAPISpec)
            : { type: 'string' },
        };

      case 'object':
        const properties: Record<string, any> = {};
        const required: string[] = [];

        if (openApiSchema.properties) {
          for (const [key, value] of Object.entries(openApiSchema.properties)) {
            properties[key] = this.mapToMCPSchema(value, openAPISpec);
          }
        }

        if (openApiSchema.required) {
          required.push(...openApiSchema.required);
        }

        return {
          type: 'object',
          description: openApiSchema.description,
          properties,
          required: required.length > 0 ? required : undefined,
        };

      default:
        return {
          type: 'object',
          description: openApiSchema.description,
        };
    }
  }

  /**
   * Resolve $ref reference
   */
  private resolveRef(
    ref: string,
    spec: OpenAPIV3.Document
  ): OpenAPIV3.SchemaObject | null {
    if (!ref.startsWith('#/components/schemas/')) {
      return null;
    }

    const schemaName = ref.replace('#/components/schemas/', '');
    return (spec.components?.schemas?.[schemaName] as OpenAPIV3.SchemaObject) || null;
  }

  /**
   * Map OpenAPI parameter to MCP tool parameter
   */
  mapParameter(parameter: OpenAPIV3.ParameterObject): {
    name: string;
    schema: MCPToolSchema;
    required: boolean;
    description?: string;
    location: string;
  } {
    const schema = this.mapToMCPSchema(parameter.schema);
    
    return {
      name: parameter.name,
      schema,
      required: parameter.required || false,
      description: parameter.description,
      location: parameter.in,
    };
  }

  /**
   * Map request body to MCP tool schema
   */
  mapRequestBody(requestBody: OpenAPIV3.RequestBodyObject): MCPToolSchema | null {
    const content = requestBody.content;
    if (!content) return null;

    // Prefer application/json
    const jsonContent = content['application/json'];
    if (jsonContent?.schema) {
      return this.mapToMCPSchema(jsonContent.schema);
    }

    // Fallback to first content type
    const firstContent = Object.values(content)[0];
    if (firstContent?.schema) {
      return this.mapToMCPSchema(firstContent.schema);
    }

    return null;
  }
}

