import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { AuthHandler } from './auth.js';

export interface APIRequest {
  method: string;
  path: string;
  params?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
}

export interface APIResponse {
  status: number;
  data: any;
  headers: Record<string, string>;
}

export class APIClient {
  private client: AxiosInstance;
  private authHandler: AuthHandler;
  private baseURL: string;

  constructor() {
    this.baseURL =
      process.env.AI_BOSS_API_BASE_URL || 'https://boss-api.rockstar-automations.com';
    this.authHandler = new AuthHandler();

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: this.authHandler.getAuthHeaders(),
    });

    // Add request interceptor for logging (to stderr only, not stdout)
    this.client.interceptors.request.use(
      (config) => {
        // Don't log to stdout in stdio mode - it breaks JSON-RPC protocol
        return config;
      },
      (error) => {
        // Log errors to stderr only
        process.stderr.write(`[API Request Error] ${error}\n`);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        return response;
      },
      (error) => {
        // Log errors to stderr only (not stdout)
        process.stderr.write(`[API Response Error] ${error.response?.status} - ${error.message}\n`);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Make API request
   */
  async request(req: APIRequest): Promise<APIResponse> {
    const config: AxiosRequestConfig = {
      method: req.method.toLowerCase() as any,
      url: req.path,
      params: req.params,
      data: req.body,
      headers: {
        ...this.authHandler.getAuthHeaders(),
        ...req.headers,
      },
    };

    try {
      const response = await this.client.request(config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers as Record<string, string>,
      };
    } catch (error: any) {
      if (error.response) {
        // API responded with error
        throw {
          status: error.response.status,
          message: error.response.data?.message || error.message,
          data: error.response.data,
        };
      } else {
        // Network or other error
        throw {
          status: 0,
          message: error.message || 'Network error',
          data: null,
        };
      }
    }
  }

  /**
   * Build path with path parameters
   */
  buildPath(template: string, params: Record<string, any>): string {
    let path = template;
    
    // Replace path parameters
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`{${key}}`, String(value));
      path = path.replace(`:${key}`, String(value));
    }

    return path;
  }

  /**
   * Get base URL
   */
  getBaseURL(): string {
    return this.baseURL;
  }
}


