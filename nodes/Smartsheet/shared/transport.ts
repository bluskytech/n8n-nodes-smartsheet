import type {
	INode,
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export type SmartsheetContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

const DEFAULT_BASE_URL = 'https://api.smartsheet.com/2.0';

export async function getBaseUrl(this: SmartsheetContext): Promise<string> {
	const credentials = await this.getCredentials('smartsheetApi');
	const region = (credentials.region as string) || DEFAULT_BASE_URL;
	return region.replace(/\/+$/, '');
}

/**
 * Perform an authenticated request against the Smartsheet REST API.
 * Retries on 429 (rate limit) and 503 with a short back-off.
 */
export async function smartsheetApiRequest<T = unknown>(
	this: SmartsheetContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject | IDataObject[] | Buffer | undefined = undefined,
	qs: IDataObject = {},
	extra: Partial<IHttpRequestOptions> = {},
): Promise<T> {
	const baseURL = await getBaseUrl.call(this);
	const options: IHttpRequestOptions = {
		method,
		url: `${baseURL}${endpoint}`,
		qs,
		json: true,
		headers: { 'Content-Type': 'application/json' },
		...extra,
	};
	if (body !== undefined && !(Array.isArray(body) && body.length === 0)) {
		options.body = body;
	}
	// Smartsheet rejects empty query params such as include=''
	for (const key of Object.keys(options.qs ?? {})) {
		const value = (options.qs as IDataObject)[key];
		if (value === undefined || value === null || value === '')
			delete (options.qs as IDataObject)[key];
	}

	const maxAttempts = 4;
	for (let attempt = 1; ; attempt++) {
		try {
			return (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'smartsheetApi',
				options,
			)) as T;
		} catch (error) {
			const status = Number(
				(error as { httpCode?: string }).httpCode ??
					(error as { statusCode?: number }).statusCode ??
					(error as { response?: { status?: number } }).response?.status ??
					0,
			);
			if ((status === 429 || status === 503) && attempt < maxAttempts) {
				await sleep(1000 * attempt * attempt);
				continue;
			}
			const smartsheetMessage = extractSmartsheetMessage(error);
			if (error instanceof NodeApiError || error instanceof NodeOperationError) {
				if (smartsheetMessage) {
					error.message = `Smartsheet: ${smartsheetMessage}`;
					error.description = `${method} ${endpoint}`;
				}
				throw toNodeError(this.getNode(), error);
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: smartsheetMessage ? `Smartsheet: ${smartsheetMessage}` : undefined,
				description: `${method} ${endpoint}`,
			});
		}
	}
}

/**
 * Fetch every page of a Smartsheet list endpoint using page/pageSize
 * (Smartsheet has deprecated includeAll on several endpoints).
 */
export async function smartsheetApiRequestAllItems(
	this: SmartsheetContext,
	endpoint: string,
	qs: IDataObject = {},
	limit?: number,
): Promise<IDataObject[]> {
	const pageSize = 100;
	const items: IDataObject[] = [];
	let page = 1;
	for (;;) {
		const response = (await smartsheetApiRequest.call(this, 'GET', endpoint, undefined, {
			...qs,
			page,
			pageSize,
		})) as { data?: IDataObject[]; totalPages?: number };
		const data = response.data ?? [];
		items.push(...data);
		if (limit !== undefined && items.length >= limit) return items.slice(0, limit);
		const totalPages = response.totalPages ?? 1;
		if (page >= totalPages || data.length === 0) break;
		page++;
	}
	return items;
}

/** Normalize any caught error into one of n8n's error classes so it can be re-thrown. */
export function toNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeOperationError(node, error as Error, { itemIndex });
}

function extractSmartsheetMessage(error: unknown): string | undefined {
	const candidates: unknown[] = [];
	const e = error as {
		response?: { data?: unknown; body?: unknown };
		cause?: { response?: { data?: unknown; body?: unknown } };
		description?: unknown;
	};
	candidates.push(
		e.response?.data,
		e.response?.body,
		e.cause?.response?.data,
		e.cause?.response?.body,
	);
	for (let candidate of candidates) {
		if (typeof candidate === 'string') {
			try {
				candidate = JSON.parse(candidate);
			} catch {
				continue;
			}
		}
		const message = (candidate as { message?: unknown } | undefined)?.message;
		if (typeof message === 'string' && message) {
			const code = (candidate as { errorCode?: unknown }).errorCode;
			return code ? `${message} (error ${code as number})` : message;
		}
	}
	return undefined;
}
