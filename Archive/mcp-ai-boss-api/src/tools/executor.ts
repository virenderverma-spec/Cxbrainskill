import { APIClient, APIRequest } from '../handlers/apiClient.js';
import { GeneratedTool } from './generator.js';

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: {
    message: string;
    status?: number;
    details?: any;
  };
}

export class ToolExecutor {
  private apiClient: APIClient;

  constructor() {
    this.apiClient = new APIClient();
  }

  /**
   * Execute a tool with given arguments
   */
  async execute(
    tool: GeneratedTool,
    args: Record<string, any>
  ): Promise<ToolExecutionResult> {
    try {
      // Separate path params, query params, and body
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      let body: any = undefined;

      // Extract path parameters
      for (const param of tool.endpoint.parameters) {
        if (param.in === 'path' && args[param.name] !== undefined) {
          pathParams[param.name] = args[param.name];
        }
      }

      // Extract query parameters
      for (const param of tool.endpoint.parameters) {
        if (param.in === 'query' && args[param.name] !== undefined) {
          queryParams[param.name] = args[param.name];
        }
      }

      // Extract body (if present)
      if (tool.endpoint.requestBody) {
        // Check if there's a 'body' key
        if (args.body !== undefined) {
          body = args.body;
        } else {
          // Otherwise, collect all non-path, non-query params as body
          const bodyParams: Record<string, any> = {};
          const pathParamNames = new Set(
            tool.endpoint.parameters
              .filter(p => p.in === 'path')
              .map(p => p.name)
          );
          const queryParamNames = new Set(
            tool.endpoint.parameters
              .filter(p => p.in === 'query')
              .map(p => p.name)
          );

          for (const [key, value] of Object.entries(args)) {
            if (!pathParamNames.has(key) && !queryParamNames.has(key)) {
              bodyParams[key] = value;
            }
          }

          if (Object.keys(bodyParams).length > 0) {
            body = bodyParams;
          }
        }
      }

      // Build path with parameters
      const path = this.apiClient.buildPath(tool.endpoint.path, pathParams);

      // Create API request
      const request: APIRequest = {
        method: tool.endpoint.method,
        path,
        params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
        body: body !== undefined ? body : undefined,
      };

      // Execute request
      const response = await this.apiClient.request(request);

      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: error.message || 'Unknown error',
          status: error.status,
          details: error.data,
        },
      };
    }
  }
}


