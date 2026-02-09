import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { MCPServerCore } from './mcpServerCore.js';

// Initialize server core (singleton)
let serverCore: MCPServerCore | null = null;

/**
 * Initialize or get the server core instance
 */
async function getServerCore(): Promise<MCPServerCore> {
  if (!serverCore) {
    serverCore = new MCPServerCore();
    await serverCore.initialize();
  }
  return serverCore;
}

/**
 * Lambda handler for API Gateway
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[Lambda] Event:', JSON.stringify(event, null, 2));

  // Set longer timeout for Lambda
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    // Handle CORS preflight FIRST (before any processing)
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
        body: '',
      };
    }

    const server = await getServerCore();

    // Parse JSON-RPC request from API Gateway
    let request: any;
    
    // Handle different event sources
    if (event.body) {
      try {
        request = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (e) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: 'Parse error',
              data: 'Invalid JSON in request body',
            },
          }),
        };
      }
    } else {
      // Handle query parameters or direct method call
      const method = event.pathParameters?.method || event.queryStringParameters?.method;
      if (method === 'list' || event.path === '/tools' || event.path === '/tools/list') {
        request = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        };
      } else {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32600,
              message: 'Invalid Request',
              data: 'Request body is required',
            },
          }),
        };
      }
    }

    // Process the MCP request
    const response = await server.processRequest(request);

    // Return JSON-RPC response (response already includes jsonrpc, id, result/error)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: JSON.stringify(response),
    };
  } catch (error: any) {
    console.error('[Lambda] Error:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message || 'Unknown error',
        },
      }),
    };
  }
};

