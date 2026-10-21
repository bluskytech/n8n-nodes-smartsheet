import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { sheetLocator } from '../Smartsheet/shared/descriptions';
import { getColumnsOptions, searchSheets } from '../Smartsheet/shared/methods';
import {
	smartsheetApiRequest,
	smartsheetApiRequestAllItems,
	toNodeError,
} from '../Smartsheet/shared/transport';
import type { RowValueSource, SmartsheetColumn, SmartsheetRow } from '../Smartsheet/shared/utils';
import { simplifyRow } from '../Smartsheet/shared/utils';

interface SmartsheetEvent {
	objectType: string;
	eventType: string;
	id?: number;
	rowId?: number;
	columnId?: number;
	userId?: number;
	timestamp?: string;
}

interface SmartsheetCallback {
	nonce?: string;
	timestamp?: string;
	webhookId?: number;
	scope?: string;
	scopeObjectId?: number;
	events?: SmartsheetEvent[];
	newWebhookStatus?: string;
}

interface WebhookRecord {
	id: number;
	name: string;
	callbackUrl: string;
	status: string;
	enabled: boolean;
	sharedSecret?: string;
	disabledDetails?: string;
}

const EVENT_OPTIONS = [
	{ name: 'Attachment Added', value: 'attachment.created' },
	{ name: 'Attachment Deleted', value: 'attachment.deleted' },
	{ name: 'Cell Updated', value: 'cell.updated', description: 'One event per changed cell' },
	{ name: 'Column Added', value: 'column.created' },
	{ name: 'Column Deleted', value: 'column.deleted' },
	{ name: 'Column Updated', value: 'column.updated' },
	{ name: 'Comment Added', value: 'comment.created' },
	{ name: 'Comment Deleted', value: 'comment.deleted' },
	{ name: 'Comment Thread Started', value: 'discussion.created' },
	{ name: 'Row Added', value: 'row.created' },
	{ name: 'Row Deleted', value: 'row.deleted' },
	{ name: 'Row Updated', value: 'row.updated', description: 'One event per changed row' },
	{
		name: 'Sheet Updated',
		value: 'sheet.updated',
		description: 'Sheet-level changes such as rename',
	},
];

export class SmartsheetTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Smartsheet Trigger',
		name: 'smartsheetTrigger',
		icon: {
			light: 'file:../../icons/smartsheet.svg',
			dark: 'file:../../icons/smartsheet.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["events"].join(", ") }}',
		description: 'Starts the workflow when something changes in a Smartsheet sheet',
		defaults: { name: 'Smartsheet Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'smartsheetApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			sheetLocator,
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: EVENT_OPTIONS,
				default: ['row.created', 'row.updated'],
				required: true,
				description: 'Which changes should start the workflow',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Cell Value Source',
						name: 'valueSource',
						type: 'options',
						options: [
							{ name: 'Value (Raw)', value: 'value' },
							{ name: 'Display Value', value: 'displayValue' },
						],
						default: 'value',
						description: 'Which cell representation to use when simplifying rows',
					},
					{
						displayName: 'Ignore Changes Made by This Credential',
						name: 'ignoreOwn',
						type: 'boolean',
						default: false,
						description:
							'Whether to skip events caused by the user that owns the access token. Prevents loops when the same workflow writes back to the sheet.',
					},
					{
						displayName: 'Resolve Event Data',
						name: 'resolve',
						type: 'boolean',
						default: true,
						description:
							'Whether to fetch the full row, comment, attachment or column for each event. Smartsheet webhooks only carry IDs.',
					},
					{
						displayName: 'Simplify Rows',
						name: 'simplify',
						type: 'boolean',
						default: true,
						description: 'Whether to return rows as flat objects keyed by column title',
					},
					{
						displayName: 'Watch Column Names or IDs',
						name: 'columnIds',
						type: 'multiOptions',
						typeOptions: {
							loadOptionsMethod: 'getColumns',
							loadOptionsDependsOn: ['sheetId.value'],
						},
						default: [],
						description:
							'Only report cell changes in these columns. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},
		],
	};

	methods = {
		listSearch: { searchSheets },
		loadOptions: { getColumns: getColumnsOptions },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const callbackUrl = this.getNodeWebhookUrl('default') as string;

				let webhook: WebhookRecord | undefined;
				if (staticData.webhookId) {
					try {
						webhook = (await smartsheetApiRequest.call(
							this,
							'GET',
							`/webhooks/${staticData.webhookId as number}`,
						)) as WebhookRecord;
					} catch {
						webhook = undefined;
					}
				}
				if (!webhook || webhook.callbackUrl !== callbackUrl) {
					const all = (await smartsheetApiRequestAllItems.call(
						this,
						'/webhooks',
					)) as unknown as WebhookRecord[];
					webhook = all.find((w) => w.callbackUrl === callbackUrl);
				}
				if (!webhook) {
					delete staticData.webhookId;
					delete staticData.sharedSecret;
					return false;
				}
				if (webhook.callbackUrl !== callbackUrl) return false;
				// Re-enable a webhook that Smartsheet disabled (e.g. callback failures).
				if (!webhook.enabled || webhook.status !== 'ENABLED') {
					try {
						webhook = await enableWebhook.call(this, webhook.id);
					} catch {
						// Could not re-enable in place: recreate it.
						await deleteWebhook.call(this, webhook.id);
						delete staticData.webhookId;
						delete staticData.sharedSecret;
						return false;
					}
				}
				staticData.webhookId = webhook.id;
				if (webhook.sharedSecret) staticData.sharedSecret = webhook.sharedSecret;
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const callbackUrl = this.getNodeWebhookUrl('default') as string;
				const sheetId = this.getNodeParameter('sheetId', undefined, {
					extractValue: true,
				}) as string;
				const options = this.getNodeParameter('options', {}) as IDataObject;

				if (!callbackUrl.startsWith('https://')) {
					throw new NodeOperationError(
						this.getNode(),
						`Smartsheet requires an HTTPS callback URL, but the webhook URL is ${callbackUrl}. Set WEBHOOK_URL on your n8n instance to its public HTTPS address.`,
					);
				}

				// Remove stale webhooks that point at this same URL.
				const existing = (await smartsheetApiRequestAllItems.call(
					this,
					'/webhooks',
				)) as unknown as WebhookRecord[];
				for (const stale of existing.filter((w) => w.callbackUrl === callbackUrl)) {
					await deleteWebhook.call(this, stale.id);
				}

				const workflowName = this.getWorkflow().name ?? 'workflow';
				const body: IDataObject = {
					name: `n8n: ${workflowName} / ${this.getNode().name}`.slice(0, 100),
					callbackUrl,
					scope: 'sheet',
					scopeObjectId: Number(sheetId),
					events: ['*.*'],
					version: 1,
				};
				const watch = (options.columnIds as string[]) ?? [];
				if (watch.length) body.subscope = { columnIds: watch.map((c) => Number(c)) };

				const created = (await smartsheetApiRequest.call(this, 'POST', '/webhooks', body)) as {
					result: WebhookRecord;
				};
				const webhookId = created.result.id;
				staticData.webhookId = webhookId;
				staticData.sharedSecret = created.result.sharedSecret;

				let enabled: WebhookRecord;
				try {
					enabled = await enableWebhook.call(this, webhookId);
				} catch (error) {
					await deleteWebhook.call(this, webhookId);
					delete staticData.webhookId;
					delete staticData.sharedSecret;
					throw toNodeError(this.getNode(), error);
				}
				if (enabled.sharedSecret) staticData.sharedSecret = enabled.sharedSecret;

				if (options.ignoreOwn === true) {
					const me = (await smartsheetApiRequest.call(this, 'GET', '/users/me')) as { id: number };
					staticData.ownUserId = me.id;
				} else {
					delete staticData.ownUserId;
				}

				// Remember the sheet name as a fallback for callbacks where the lookup fails.
				try {
					const sheet = (await smartsheetApiRequest.call(
						this,
						'GET',
						`/sheets/${sheetId}`,
						undefined,
						{
							pageSize: 1,
						},
					)) as { name?: string; permalink?: string };
					staticData.sheetName = sheet.name;
					staticData.sheetPermalink = sheet.permalink;
				} catch {
					delete staticData.sheetName;
					delete staticData.sheetPermalink;
				}
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (staticData.webhookId) {
					await deleteWebhook.call(this, staticData.webhookId as number);
				}
				delete staticData.webhookId;
				delete staticData.sharedSecret;
				delete staticData.ownUserId;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const headers = this.getHeaderData();

		// 1. Verification handshake: echo the challenge back.
		const challenge = headers['smartsheet-hook-challenge'];
		if (challenge) {
			const value = Array.isArray(challenge) ? challenge[0] : challenge;
			res.setHeader('Smartsheet-Hook-Response', value);
			res.status(200).json({ smartsheetHookResponse: value });
			return { noWebhookResponse: true };
		}

		const staticData = this.getWorkflowStaticData('node');
		const body = this.getBodyData() as SmartsheetCallback;

		// 2. Signature check when Smartsheet gave us a shared secret.
		const secret = staticData.sharedSecret as string | undefined;
		const signature = headers['smartsheet-hmac-sha256'];
		const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
		if (secret && rawBody) {
			const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
			const given = String(Array.isArray(signature) ? signature[0] : (signature ?? ''));
			const valid =
				given.length === expected.length &&
				timingSafeEqual(Buffer.from(given), Buffer.from(expected));
			if (!valid) {
				res.status(401).json({ error: 'Invalid Smartsheet signature' });
				return { noWebhookResponse: true };
			}
		}

		// 3. Status-change notifications carry no events.
		if (body.newWebhookStatus || !Array.isArray(body.events) || body.events.length === 0) {
			return { webhookResponse: { received: true } };
		}

		const selected = new Set(this.getNodeParameter('events', []) as string[]);
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const ownUserId = staticData.ownUserId as number | undefined;
		const sheetId = String(
			body.scopeObjectId ?? this.getNodeParameter('sheetId', undefined, { extractValue: true }),
		);

		const events = body.events
			.filter((event) => {
				if (!selected.has(`${event.objectType}.${event.eventType}`)) return false;
				if (ownUserId && event.userId === ownUserId) return false;
				return true;
			})
			.sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')));
		if (events.length === 0) return { webhookResponse: { received: true, matched: 0 } };

		// Cell events that belong to the same change as a row event share its row ID and timestamp.
		const changedColumnsByRow = new Map<string, number[]>();
		for (const event of body.events) {
			if (event.objectType === 'cell' && event.rowId && event.columnId) {
				const key = `${event.rowId}:${event.timestamp ?? ''}`;
				const list = changedColumnsByRow.get(key) ?? [];
				list.push(event.columnId);
				changedColumnsByRow.set(key, list);
			}
		}

		const resolve = options.resolve !== false;
		const simplify = options.simplify !== false;
		const source = (options.valueSource as RowValueSource) ?? 'value';
		let columns: SmartsheetColumn[] = [];
		const rowCache = new Map<number, SmartsheetRow | null>();

		const loadColumns = async () => {
			if (columns.length === 0) {
				columns = (await smartsheetApiRequestAllItems.call(
					this,
					`/sheets/${sheetId}/columns`,
				)) as unknown as SmartsheetColumn[];
			}
			return columns;
		};
		const loadRow = async (rowId: number) => {
			if (rowCache.has(rowId)) return rowCache.get(rowId) ?? null;
			try {
				const row = (await smartsheetApiRequest.call(
					this,
					'GET',
					`/sheets/${sheetId}/rows/${rowId}`,
					undefined,
					{ include: 'rowPermalink' },
				)) as SmartsheetRow;
				rowCache.set(rowId, row);
				return row;
			} catch {
				rowCache.set(rowId, null);
				return null;
			}
		};

		// Sheet name for downstream steps: live lookup, falling back to what activation stored.
		let sheetName = staticData.sheetName as string | undefined;
		let sheetPermalink = staticData.sheetPermalink as string | undefined;
		try {
			const sheet = (await smartsheetApiRequest.call(this, 'GET', `/sheets/${sheetId}`, undefined, {
				pageSize: 1,
			})) as { name?: string; permalink?: string };
			sheetName = sheet.name ?? sheetName;
			sheetPermalink = sheet.permalink ?? sheetPermalink;
		} catch {
			// keep the stored values
		}

		const output: IDataObject[] = [];
		for (const event of events) {
			const item: IDataObject = {
				event: `${event.objectType}.${event.eventType}`,
				objectType: event.objectType,
				eventType: event.eventType,
				sheetId: Number(sheetId),
				sheetName,
				sheetPermalink,
				webhookId: body.webhookId,
				timestamp: event.timestamp,
				userId: event.userId,
			};
			if (event.rowId !== undefined) item.rowId = event.rowId;
			if (event.columnId !== undefined) item.columnId = event.columnId;
			if (event.id !== undefined) item.objectId = event.id;

			if (resolve) {
				try {
					await attachDetails.call(this, item, event, {
						sheetId,
						loadColumns,
						loadRow,
						simplify,
						source,
						changedColumnsByRow,
					});
				} catch (error) {
					item.resolveError = (error as Error).message;
				}
			}
			output.push(item);
		}

		return {
			workflowData: [this.helpers.returnJsonArray(output)],
		};
	}
}

interface ResolveContext {
	sheetId: string;
	loadColumns: () => Promise<SmartsheetColumn[]>;
	loadRow: (rowId: number) => Promise<SmartsheetRow | null>;
	simplify: boolean;
	source: RowValueSource;
	changedColumnsByRow: Map<string, number[]>;
}

async function attachDetails(
	this: IWebhookFunctions,
	item: IDataObject,
	event: SmartsheetEvent,
	ctx: ResolveContext,
): Promise<void> {
	const { sheetId } = ctx;
	const rowId = event.rowId ?? (event.objectType === 'row' ? event.id : undefined);

	if (event.objectType === 'row' || event.objectType === 'cell') {
		if (event.eventType === 'deleted' && event.objectType === 'row') return;
		if (!rowId) return;
		const columns = await ctx.loadColumns();
		const row = await ctx.loadRow(rowId);
		if (row) {
			item.row = ctx.simplify ? simplifyRow(row, columns, ctx.source) : row;
		}
		if (!row) item.resolveError = 'Row no longer exists';
		if (event.objectType === 'row' && event.eventType === 'updated') {
			const changed = Array.from(
				new Set(ctx.changedColumnsByRow.get(`${rowId}:${event.timestamp ?? ''}`) ?? []),
			);
			item.changedColumns = changed.map(
				(id) => columns.find((c) => c.id === id)?.title ?? String(id),
			);
		}
		if (event.objectType === 'cell' && event.columnId) {
			const column = columns.find((c) => c.id === event.columnId);
			item.columnTitle = column?.title;
			const cell = row?.cells?.find((c) => c.columnId === event.columnId);
			item.newValue = (cell?.value ?? cell?.displayValue ?? null) as IDataObject[string];
			item.newDisplayValue = cell?.displayValue ?? null;
		}
		return;
	}

	if (event.objectType === 'comment' && event.id && event.eventType !== 'deleted') {
		item.comment = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/comments/${event.id}`,
		)) as IDataObject;
		if (rowId) {
			const columns = await ctx.loadColumns();
			const row = await ctx.loadRow(rowId);
			if (row) item.row = ctx.simplify ? simplifyRow(row, columns, ctx.source) : row;
		}
		return;
	}

	if (event.objectType === 'discussion' && event.id && event.eventType !== 'deleted') {
		item.discussion = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/discussions/${event.id}`,
			undefined,
			{ include: 'comments' },
		)) as IDataObject;
		if (rowId) {
			const columns = await ctx.loadColumns();
			const row = await ctx.loadRow(rowId);
			if (row) item.row = ctx.simplify ? simplifyRow(row, columns, ctx.source) : row;
		}
		return;
	}

	if (event.objectType === 'attachment' && event.id && event.eventType !== 'deleted') {
		item.attachment = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/attachments/${event.id}`,
		)) as IDataObject;
		return;
	}

	if (event.objectType === 'column' && event.id && event.eventType !== 'deleted') {
		item.column = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/columns/${event.id}`,
		)) as IDataObject;
		return;
	}

	if (event.objectType === 'sheet') {
		item.sheet = (await smartsheetApiRequest.call(this, 'GET', `/sheets/${sheetId}`, undefined, {
			pageSize: 1,
		})) as IDataObject;
		delete (item.sheet as IDataObject).rows;
	}
}

async function enableWebhook(this: IHookFunctions, webhookId: number): Promise<WebhookRecord> {
	const response = (await smartsheetApiRequest.call(this, 'PUT', `/webhooks/${webhookId}`, {
		enabled: true,
	})) as { result: WebhookRecord };
	const webhook = response.result;
	if (webhook.status !== 'ENABLED') {
		throw new NodeOperationError(
			this.getNode(),
			`Smartsheet could not enable the webhook (status ${webhook.status}${webhook.disabledDetails ? `: ${webhook.disabledDetails}` : ''}). Smartsheet must be able to reach ${webhook.callbackUrl} over HTTPS.`,
		);
	}
	return webhook;
}

async function deleteWebhook(this: IHookFunctions, webhookId: number): Promise<void> {
	try {
		await smartsheetApiRequest.call(this, 'DELETE', `/webhooks/${webhookId}`);
	} catch (error) {
		const status = Number((error as { httpCode?: string }).httpCode ?? 0);
		if (status === 404) return;
		throw toNodeError(this.getNode(), error);
	}
}
