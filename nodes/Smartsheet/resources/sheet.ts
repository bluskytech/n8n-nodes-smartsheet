import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { ExecutionCache } from '../shared/context';
import { getDestination, getLocatorId } from '../shared/context';
import {
	copyIncludeOptions,
	destinationProperties,
	returnAllProperties,
	sheetLocator,
	simplifyProperty,
} from '../shared/descriptions';
import { smartsheetApiRequest, smartsheetApiRequestAllItems } from '../shared/transport';
import type { RowValueSource, SmartsheetColumn, SmartsheetRow } from '../shared/utils';
import { simplifyRow, toExecutionData } from '../shared/utils';

const show = (...operations: string[]) => ({ resource: ['sheet'], operation: operations });

export const columnTypeOptions = [
	{ name: 'Checkbox', value: 'CHECKBOX' },
	{ name: 'Contact List', value: 'CONTACT_LIST' },
	{ name: 'Date', value: 'DATE' },
	{ name: 'Date/Time', value: 'DATETIME' },
	{ name: 'Dropdown (Multi Select)', value: 'MULTI_PICKLIST' },
	{ name: 'Dropdown (Single Select)', value: 'PICKLIST' },
	{ name: 'Duration', value: 'DURATION' },
	{ name: 'Multi Contact List', value: 'MULTI_CONTACT_LIST' },
	{ name: 'Text/Number', value: 'TEXT_NUMBER' },
];

export const sheetDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['sheet'] } },
		options: [
			{ name: 'Copy', value: 'copy', action: 'Copy a sheet' },
			{ name: 'Create', value: 'create', action: 'Create a sheet' },
			{ name: 'Delete', value: 'delete', action: 'Delete a sheet' },
			{
				name: 'Export',
				value: 'export',
				action: 'Export a sheet as a file',
				description: 'Download the sheet as PDF, Excel or CSV',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a sheet',
				description: 'Get a sheet with its rows',
			},
			{ name: 'Get Many', value: 'getAll', action: 'Get many sheets' },
			{ name: 'Move', value: 'move', action: 'Move a sheet' },
			{ name: 'Rename', value: 'rename', action: 'Rename a sheet' },
		],
		default: 'get',
	},
	{
		...sheetLocator,
		displayOptions: { show: show('get', 'copy', 'move', 'rename', 'delete', 'export') },
	},

	// ---- get
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('get') },
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
			},
			{
				displayName: 'Column IDs',
				name: 'columnIds',
				type: 'string',
				default: '',
				description: 'Comma-separated column IDs to limit the cells returned',
			},
			{
				displayName: 'Include',
				name: 'include',
				type: 'multiOptions',
				options: [
					{ name: 'Attachments', value: 'attachments' },
					{ name: 'Cross Sheet References', value: 'crossSheetReferences' },
					{ name: 'Discussions (Comments)', value: 'discussions' },
					{ name: 'Filters', value: 'filters' },
					{ name: 'Format', value: 'format' },
					{ name: 'Object Value', value: 'objectValue' },
					{ name: 'Owner Info', value: 'ownerInfo' },
					{ name: 'Row Permalink', value: 'rowPermalink' },
					{ name: 'Source', value: 'source' },
					{ name: 'Summary', value: 'summary' },
					{ name: 'Writer Info', value: 'writerInfo' },
				],
				default: [],
			},
			{
				displayName: 'Max Rows',
				name: 'pageSize',
				type: 'number',
				default: 0,
				description: 'Limit the number of rows returned (0 returns all rows)',
			},
			{
				displayName: 'Row IDs',
				name: 'rowIds',
				type: 'string',
				default: '',
				description: 'Comma-separated row IDs to limit the rows returned',
			},
			{
				displayName: 'Rows Modified Since',
				name: 'rowsModifiedSince',
				type: 'dateTime',
				default: '',
			},
			simplifyProperty(show('get')),
		],
	},

	// ---- getAll
	...returnAllProperties(show('getAll')),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('getAll') },
		options: [
			{
				displayName: 'Include',
				name: 'include',
				type: 'multiOptions',
				options: [
					{ name: 'Owner Info', value: 'ownerInfo' },
					{ name: 'Sheet Version', value: 'sheetVersion' },
					{ name: 'Source', value: 'source' },
				],
				default: [],
			},
			{
				displayName: 'Modified Since',
				name: 'modifiedSince',
				type: 'dateTime',
				default: '',
				description: 'Only return sheets modified at or after this time',
			},
		],
	},

	// ---- create
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('create') },
	},
	...destinationProperties('location', show('create')),
	{
		displayName: 'Columns',
		name: 'columnsUi',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Column',
		default: { columnValues: [{ title: 'Primary Column', type: 'TEXT_NUMBER', primary: true }] },
		description: 'Exactly one column must be marked as primary',
		displayOptions: { show: show('create') },
		options: [
			{
				name: 'columnValues',
				displayName: 'Column',
				values: [
					{ displayName: 'Title', name: 'title', type: 'string', default: '', required: true },
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						options: columnTypeOptions,
						default: 'TEXT_NUMBER',
					},
					{
						displayName: 'Primary',
						name: 'primary',
						type: 'boolean',
						default: false,
						description: 'Whether this is the primary column (must be Text/Number)',
					},
					{
						displayName: 'Dropdown Options',
						name: 'options',
						type: 'string',
						default: '',
						description: 'Comma-separated values for dropdown columns',
					},
				],
			},
		],
	},

	// ---- copy / move / rename
	{
		displayName: 'New Name',
		name: 'newName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('copy', 'rename') },
	},
	...destinationProperties('destination', show('copy', 'move')),
	{
		displayName: 'Include',
		name: 'include',
		type: 'multiOptions',
		options: copyIncludeOptions,
		default: [
			'data',
			'attachments',
			'discussions',
			'cellLinks',
			'forms',
			'rules',
			'ruleRecipients',
		],
		description: 'What to copy along with the sheet structure',
		displayOptions: { show: show('copy') },
	},

	// ---- export
	{
		displayName: 'Format',
		name: 'format',
		type: 'options',
		options: [
			{ name: 'CSV', value: 'csv' },
			{ name: 'Excel (XLSX)', value: 'excel' },
			{ name: 'PDF', value: 'pdf' },
		],
		default: 'excel',
		displayOptions: { show: show('export') },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
		displayOptions: { show: show('export') },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('export') },
		options: [
			{
				displayName: 'Paper Size (PDF)',
				name: 'paperSize',
				type: 'options',
				options: [
					{ name: 'A3', value: 'A3' },
					{ name: 'A4', value: 'A4' },
					{ name: 'Legal', value: 'LEGAL' },
					{ name: 'Letter', value: 'LETTER' },
					{ name: 'Wide', value: 'WIDE' },
				],
				default: 'A4',
			},
		],
	},
];

export async function executeSheet(
	this: IExecuteFunctions,
	operation: string,
	i: number,
	cache: ExecutionCache,
): Promise<INodeExecutionData[]> {
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const qs: IDataObject = {};
		const include = (options.include as string[]) ?? [];
		if (include.length) qs.include = include.join(',');
		if (options.modifiedSince) {
			qs.modifiedSince = new Date(options.modifiedSince as string).toISOString();
		}
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const sheets = await smartsheetApiRequestAllItems.call(this, '/sheets', qs, limit);
		return toExecutionData(sheets, i);
	}

	if (operation === 'create') {
		const name = this.getNodeParameter('name', i) as string;
		const columnsUi = this.getNodeParameter('columnsUi.columnValues', i, []) as IDataObject[];
		const columns = columnsUi.map((c) => {
			const column: IDataObject = { title: c.title, type: c.type };
			if (c.primary) column.primary = true;
			const options = String(c.options ?? '')
				.split(',')
				.map((o) => o.trim())
				.filter((o) => o);
			if (options.length && (c.type === 'PICKLIST' || c.type === 'MULTI_PICKLIST')) {
				column.options = options;
			}
			return column;
		});
		if (columns.filter((c) => c.primary).length !== 1) {
			throw new NodeOperationError(this.getNode(), 'Exactly one column must be primary', {
				itemIndex: i,
			});
		}
		const { destinationType, destinationId } = getDestination(this, 'location', i);
		const endpoint =
			destinationType === 'home'
				? '/sheets'
				: destinationType === 'folder'
					? `/folders/${destinationId}/sheets`
					: `/workspaces/${destinationId}/sheets`;
		const response = (await smartsheetApiRequest.call(this, 'POST', endpoint, {
			name,
			columns,
		})) as { result?: IDataObject };
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	const sheetId = getLocatorId(this, 'sheetId', i);

	if (operation === 'get') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const qs: IDataObject = {};
		const include = (options.include as string[]) ?? [];
		if (include.length) qs.include = include.join(',');
		if (options.rowIds) qs.rowIds = String(options.rowIds).replace(/\s/g, '');
		if (options.columnIds) qs.columnIds = String(options.columnIds).replace(/\s/g, '');
		if (options.rowsModifiedSince) {
			qs.rowsModifiedSince = new Date(options.rowsModifiedSince as string).toISOString();
		}
		if (options.pageSize) {
			qs.pageSize = options.pageSize;
			qs.page = 1;
		}
		const sheet = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}`,
			undefined,
			qs,
		)) as IDataObject & { rows?: SmartsheetRow[]; columns?: SmartsheetColumn[] };
		if (options.simplify !== false) {
			const source = (options.valueSource as RowValueSource) ?? 'value';
			sheet.rows = (sheet.rows ?? []).map((row) =>
				simplifyRow(row, sheet.columns ?? [], source),
			) as unknown as SmartsheetRow[];
		}
		return toExecutionData(sheet, i);
	}

	if (operation === 'copy' || operation === 'move') {
		const { destinationType, destinationId } = getDestination(this, 'destination', i);
		const body: IDataObject = { destinationType };
		if (destinationId) body.destinationId = destinationId;
		const qs: IDataObject = {};
		if (operation === 'copy') {
			body.newName = this.getNodeParameter('newName', i) as string;
			const include = this.getNodeParameter('include', i, []) as string[];
			if (include.length) qs.include = include.join(',');
		}
		const response = (await smartsheetApiRequest.call(
			this,
			'POST',
			`/sheets/${sheetId}/${operation}`,
			body,
			qs,
		)) as { result?: IDataObject };
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	if (operation === 'rename') {
		const name = this.getNodeParameter('newName', i) as string;
		const response = (await smartsheetApiRequest.call(this, 'PUT', `/sheets/${sheetId}`, {
			name,
		})) as { result?: IDataObject };
		cache.invalidate(sheetId);
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	if (operation === 'delete') {
		await smartsheetApiRequest.call(this, 'DELETE', `/sheets/${sheetId}`);
		return toExecutionData({ success: true, sheetId: Number(sheetId) }, i);
	}

	if (operation === 'export') {
		const format = this.getNodeParameter('format', i) as string;
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const formats: Record<string, { accept: string; ext: string }> = {
			csv: { accept: 'text/csv', ext: 'csv' },
			excel: { accept: 'application/vnd.ms-excel', ext: 'xlsx' },
			pdf: { accept: 'application/pdf', ext: 'pdf' },
		};
		const { accept, ext } = formats[format];
		const qs: IDataObject = {};
		if (format === 'pdf' && options.paperSize) qs.paperSize = options.paperSize;
		const meta = (await smartsheetApiRequest.call(this, 'GET', `/sheets/${sheetId}`, undefined, {
			pageSize: 1,
		})) as { name: string };
		const buffer = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}`,
			undefined,
			qs,
			{ headers: { Accept: accept }, encoding: 'arraybuffer', json: false },
		)) as Buffer;
		const fileName = `${meta.name}.${ext}`;
		const binary = await this.helpers.prepareBinaryData(Buffer.from(buffer), fileName, accept);
		return [
			{
				json: { sheetId: Number(sheetId), name: meta.name, fileName, format },
				binary: { [binaryPropertyName]: binary },
				pairedItem: { item: i },
			},
		];
	}

	throw new NodeOperationError(this.getNode(), `Unknown sheet operation "${operation}"`);
}
