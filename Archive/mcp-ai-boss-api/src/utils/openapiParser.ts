import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIV3 } from 'openapi-types';

export interface ParsedEndpoint {
  path: string;
  method: string;
  operation: OpenAPIV3.OperationObject;
  operationId: string;
  tags: string[];
  parameters: OpenAPIV3.ParameterObject[];
  requestBody?: OpenAPIV3.RequestBodyObject;
  responses: OpenAPIV3.ResponsesObject;
  security?: OpenAPIV3.SecurityRequirementObject[];
}

export class OpenAPIParser {
  private spec: OpenAPIV3.Document;

  constructor(specPath?: string) {
    const defaultPath = path.join(
      process.cwd(),
      '..',
      'AI-BOSS-API',
      'generated',
      'openapi.json'
    );
    const specPathToUse = specPath || defaultPath;
    
    if (!fs.existsSync(specPathToUse)) {
      throw new Error(`OpenAPI spec not found at: ${specPathToUse}`);
    }

    const specContent = fs.readFileSync(specPathToUse, 'utf-8');
    this.spec = JSON.parse(specContent) as OpenAPIV3.Document;
  }

  /**
   * Parse all endpoints from OpenAPI spec
   */
  parseEndpoints(): ParsedEndpoint[] {
    const endpoints: ParsedEndpoint[] = [];

    if (!this.spec.paths) {
      return endpoints;
    }

    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      if (!pathItem) continue;

      const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
      
      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;

        const operationId = operation.operationId || this.generateOperationId(path, method);
        const tags = operation.tags || ['default'];
        const parameters = (operation.parameters || []) as OpenAPIV3.ParameterObject[];
        const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined;
        const responses = operation.responses || {};
        const security = operation.security || this.spec.security || [];

        endpoints.push({
          path,
          method: method.toUpperCase(),
          operation,
          operationId,
          tags,
          parameters,
          requestBody,
          responses,
          security,
        });
      }
    }

    return endpoints;
  }

  /**
   * Get all unique tags from the spec
   */
  getTags(): string[] {
    const tags = new Set<string>();
    
    for (const endpoint of this.parseEndpoints()) {
      endpoint.tags.forEach(tag => tags.add(tag));
    }

    return Array.from(tags).sort();
  }

  /**
   * Get endpoints by tag
   */
  getEndpointsByTag(tag: string): ParsedEndpoint[] {
    return this.parseEndpoints().filter(ep => ep.tags.includes(tag));
  }

  /**
   * Generate operation ID from path and method
   */
  private generateOperationId(path: string, method: string): string {
    const pathParts = path
      .replace(/[{}]/g, '')
      .split('/')
      .filter(p => p)
      .map(p => p.replace(/[^a-zA-Z0-9]/g, '_'));
    
    const methodPrefix = method.toLowerCase();
    const pathSuffix = pathParts.join('_');
    
    return `${methodPrefix}_${pathSuffix}`;
  }

  /**
   * Get schema reference
   */
  getSchema(ref: string): OpenAPIV3.SchemaObject | null {
    if (!ref.startsWith('#/components/schemas/')) {
      return null;
    }

    const schemaName = ref.replace('#/components/schemas/', '');
    return (this.spec.components?.schemas?.[schemaName] as OpenAPIV3.SchemaObject) || null;
  }

  /**
   * Resolve schema (handles $ref)
   */
  resolveSchema(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): OpenAPIV3.SchemaObject {
    if ('$ref' in schema) {
      const resolved = this.getSchema(schema.$ref);
      return resolved || { type: 'object' };
    }
    return schema;
  }
}


