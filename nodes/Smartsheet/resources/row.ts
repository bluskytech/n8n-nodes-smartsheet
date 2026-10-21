import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	ResourceMapperValue,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { ExecutionCache, SheetMeta } from '../shared/context';
import { getLocatorId } from '../shared/context';
import {
	destinationSheetLocator,
	returnAllProperties,
	sheetLocator,
	simplifyProperty,
} from '../shared/descriptions';
import { smartsheetApiRequest } from '../shared/transport';
import type { RowValueSource, SmartsheetColumn, SmartsheetRow } from '../shared/utils';
import {
	buildCells,
	cellValueOf,
	matchesFilter,
	parseIdList,
	simplifyRow,
	toExecutionData,
} from '../shared/utils';

const show = (...operations: string[]) => ({ resource: ['row'], operation: operations });

const rowIncludeOptions = [
	{ name: 'Attachments', value: 'attachments' },
	{ name: 'Columns', value: 'columns' },
	{ name: 'Discussions (Comments)', value: 'discussions' },
	{ name: 'Format', value: 'format' },
	{ name: 'Object Value', value: 'objectValue' },
	{ name: 'Row Permalink', value: 'rowPermalink' },
	{ name: 'Writer Info', value: 'writerInfo' },
];

const valueSourceOption: INodeProperties = {
	displayName: 'Cell Value Source',
	name: 'valueSource',
	type: 'options',
	options: [
		{
			name: 'Value (Raw)',
			value: 'value',
			description: 'Numbers stay numbers, dates are ISO strings, contacts are email addresses',
		},
		{
			name: 'Display Value',
			value: 'displayValue',
			description: 'The formatted text exactly as shown in Smartsheet',
		},
	],
	default: 'value',
	description: 'Which cell representation to use when simplifying rows',
};

const strictOption: INodeProperties = {
	displayName: 'Strict Validation',
	name: 'strict',
	type: 'boolean',
	default: false,
	description:
		'Whether Smartsheet should reject values that do not match the column type or picklist (off lets free text into picklists and date columns)',
};

function mapperProperty(mode: 'add' | 'update' | 'upsert', operation: string): INodeProperties {
	return {
		displayName: 'Columns',
		name: 'columns',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['sheetId.value'],
			resourceMapper: {
				resourceMapperMethod: 'getRowMappingColumns',
				mode,
				fieldWords: { singular: 'column', plural: 'columns' },
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: true,
				matchingFieldsLabels: {
					title: 'Column to Match On',
					description:
						'Use "Row ID" to target a row directly, or any other column to find the row whose value matches',
					hint: 'Matching on a column other than Row ID scans the sheet, so it is slower on large sheets',
				},
			},
		},
		displayOptions: { show: show(operation) },
	};
}

export const rowDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['row'] } },
		options: [
			{
				name: 'Add',
				value: 'create',
				action: 'Add a row',
				description: 'Add a new row to a sheet',
			},
			{ name: 'Copy', value: 'copy', action: 'Copy rows to another sheet' },
			{
				name: 'Create or Update',
				value: 'upsert',
				action: 'Create or update a row',
				description: 'Create a new record, or update the current one if it already exists (upsert)',
			},
			{ name: 'Delete', value: 'delete', action: 'Delete rows' },
			{ name: 'Get', value: 'get', action: 'Get a row' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many rows' },
			{ name: 'Move', value: 'move', action: 'Move rows to another sheet' },
			{
				name: 'Search',
				value: 'search',
				action: 'Find rows',
				description: 'Find rows by a column value or by full text search',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a row',
				description: 'Update a row found by ID or by a column value',
			},
		],
		default: 'create',
	},
	{
		...sheetLocator,
		displayOptions: { show: { resource: ['row'] } },
	},

	// ---- create / update / upsert
	mapperProperty('add', 'create'),
	mapperProperty('update', 'update'),
	mapperProperty('upsert', 'upsert'),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('create', 'upsert') },
		options: [
			{
				displayName: 'Position',
				name: 'position',
				type: 'options',
				options: [
					{ name: 'Bottom of Sheet', value: 'toBottom' },
					{ name: 'Top of Sheet', value: 'toTop' },
					{ name: 'Below Sibling Row', value: 'sibling' },
					{ name: 'Child of Parent Row', value: 'parent' },
				],
				default: 'toBottom',
				description: 'Where to place a newly added row',
			},
			{
				displayName: 'Parent Row ID',
				name: 'parentId',
				type: 'string',
				default: '',
				description: 'Used when Position is "Child of Parent Row"',
			},
			{
				displayName: 'Sibling Row ID',
				name: 'siblingId',
				type: 'string',
				default: '',
				description: 'Used when Position is "Below Sibling Row"',
			},
			simplifyProperty(show('create', 'upsert')),
			strictOption,
			{
				displayName: 'Update All Matches',
				name: 'updateAll',
				type: 'boolean',
				default: false,
				description:
					'Whether to update every row that matches the column value (upsert only). Off updates only the first match.',
			},
			valueSourceOption,
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('update') },
		options: [
			simplifyProperty(show('update')),
			strictOption,
			{
				displayName: 'Update All Matches',
				name: 'updateAll',
				type: 'boolean',
				default: false,
				description:
					'Whether to update every row that matches the column value. Off updates only the first match.',
			},
			valueSourceOption,
		],
	},

	// ---- get
	{
		displayName: 'Row ID',
		name: 'rowId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('get') },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('get') },
		options: [
			{
				displayName: 'Include',
				name: 'include',
				type: 'multiOptions',
				options: rowIncludeOptions,
				default: [],
				description: 'Extra row data to include in the response',
			},
			simplifyProperty(show('get')),
			valueSourceOption,
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
				options: rowIncludeOptions.filter((o) => o.value !== 'columns'),
				default: [],
			},
			{
				displayName: 'Rows Modified Since',
				name: 'rowsModifiedSince',
				type: 'dateTime',
				default: '',
				description: 'Only return rows modified at or after this time',
			},
			simplifyProperty(show('getAll')),
			valueSourceOption,
		],
	},

	// ---- search
	{
		displayName: 'Search By',
		name: 'searchBy',
		type: 'options',
		options: [
			{
				name: 'Column Value',
				value: 'columnValue',
				description: 'Find rows where a column matches a value (exact, contains, etc.)',
			},
			{
				name: 'Full Text',
				value: 'text',
				description: 'Smartsheet full-text search across the whole sheet',
			},
		],
		default: 'columnValue',
		displayOptions: { show: show('search') },
	},
	{
		displayName: 'Column Name or ID',
		name: 'columnId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getColumns', loadOptionsDependsOn: ['sheetId.value'] },
		default: '',
		required: true,
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: { ...show('search'), searchBy: ['columnValue'] } },
	},
	{
		displayName: 'Condition',
		name: 'operator',
		type: 'options',
		options: [
			{ name: 'Contains', value: 'contains' },
			{ name: 'Does Not Contain', value: 'notContains' },
			{ name: 'Ends With', value: 'endsWith' },
			{ name: 'Equals', value: 'equals' },
			{ name: 'Is Empty', value: 'isEmpty' },
			{ name: 'Is Not Empty', value: 'isNotEmpty' },
			{ name: 'Not Equals', value: 'notEquals' },
			{ name: 'Starts With', value: 'startsWith' },
		],
		default: 'equals',
		displayOptions: { show: { ...show('search'), searchBy: ['columnValue'] } },
	},
	{
		displayName: 'Value',
		name: 'value',
		type: 'string',
		default: '',
		displayOptions: {
			show: { ...show('search'), searchBy: ['columnValue'] },
			hide: { operator: ['isEmpty', 'isNotEmpty'] },
		},
	},
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		default: '',
		required: true,
		description: 'Text to search for. Use double quotes for an exact phrase.',
		displayOptions: { show: { ...show('search'), searchBy: ['text'] } },
	},
	...returnAllProperties(show('search')),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('search') },
		options: [
			{
				displayName: 'Case Insensitive',
				name: 'caseInsensitive',
				type: 'boolean',
				default: true,
				description: 'Whether column value comparisons ignore letter case',
			},
			simplifyProperty(show('search')),
			valueSourceOption,
		],
	},

	// ---- delete / copy / move
	{
		displayName: 'Row IDs',
		name: 'rowIds',
		type: 'string',
		default: '',
		required: true,
		description: 'One or more row IDs, comma-separated',
		placeholder: 'e.g. 4567890123456789, 5678901234567890',
		displayOptions: { show: show('delete', 'copy', 'move') },
	},
	{
		...destinationSheetLocator,
		displayOptions: { show: show('copy', 'move') },
	},
	{
		displayName: 'Include',
		name: 'include',
		type: 'multiOptions',
		options: [
			{ name: 'Attachments', value: 'attachments' },
			{ name: 'Child Rows', value: 'children' },
			{ name: 'Discussions (Comments)', value: 'discussions' },
		],
		default: [],
		description: 'Related data to carry along with the rows',
		displayOptions: { show: show('copy') },
	},
	{
		displayName: 'Include',
		name: 'include',
		type: 'multiOptions',
		options: [
			{ name: 'Attachments', value: 'attachments' },
			{ name: 'Discussions (Comments)', value: 'discussions' },
		],
		default: [],
		description:
			'Related data to carry along with the rows (child rows always move with their parent)',
		displayOptions: { show: show('move') },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('delete') },
		options: [
			{
				displayName: 'Ignore Rows Not Found',
				name: 'ignoreRowsNotFound',
				type: 'boolean',
				default: true,
				description: 'Whether to succeed even if some of the row IDs no longer exist',
			},
		],
	},
];

function outputRows(
	rows: SmartsheetRow[],
	columns: SmartsheetColumn[],
	options: IDataObject,
	itemIndex: number,
	meta: SheetMeta,
): INodeExecutionData[] {
	const simplify = options.simplify !== false;
	const source = (options.valueSource as RowValueSource) ?? 'value';
	const data = simplify
		? rows.map((row) => ({
				sheetId: meta.sheetId,
				sheetName: meta.sheetName,
				...simplifyRow(row, columns, source),
			}))
		: rows;
	return toExecutionData(data, itemIndex);
}

async function fetchAllRows(
	ctx: IExecuteFunctions,
	sheetId: string,
	qs: IDataObject = {},
): Promise<SmartsheetRow[]> {
	const sheet = (await smartsheetApiRequest.call(ctx, 'GET', `/sheets/${sheetId}`, undefined, {
		...qs,
	})) as { rows?: SmartsheetRow[] };
	return sheet.rows ?? [];
}

/**
 * Read the column mapper. In "Map Automatically" mode the incoming item's keys
 * (column titles, or column IDs) are used as the values.
 */
function mappedValues(
	ctx: IExecuteFunctions,
	itemIndex: number,
	columns: SmartsheetColumn[],
): ResourceMapperValue {
	const mapper = ctx.getNodeParameter('columns', itemIndex) as ResourceMapperValue;
	if (mapper?.mappingMode === 'autoMapInputData') {
		const input = ctx.getInputData()[itemIndex].json;
		const byTitle = new Map(columns.map((c) => [c.title.toLowerCase(), String(c.id)]));
		const byId = new Set(columns.map((c) => String(c.id)));
		const value: Record<string, string | number | boolean | null> = {};
		for (const [key, raw] of Object.entries(input)) {
			if (raw === undefined || (raw !== null && typeof raw === 'object' && !Array.isArray(raw))) {
				continue;
			}
			const id = byId.has(key) ? key : byTitle.get(key.toLowerCase());
			if (id) value[id] = raw as string | number | boolean | null;
		}
		const rowId = input.__rowId ?? input.rowId ?? input.id;
		if (rowId !== undefined && rowId !== null) value.__rowId = String(rowId);
		return { ...mapper, value };
	}
	if (!mapper || !mapper.value) {
		throw new NodeOperationError(ctx.getNode(), 'No column values were provided', { itemIndex });
	}
	return mapper;
}

async function findMatchingRows(
	ctx: IExecuteFunctions,
	sheetId: string,
	mapper: ResourceMapperValue,
	itemIndex: number,
): Promise<{ rowIds: number[]; matchedOnId: boolean }> {
	const matchColumn = mapper.matchingColumns?.[0];
	const values = mapper.value ?? {};
	if (!matchColumn) {
		throw new NodeOperationError(ctx.getNode(), 'Choose a column to match on', { itemIndex });
	}
	if (matchColumn === '__rowId') {
		const rowId = Number(values.__rowId);
		if (!rowId) {
			throw new NodeOperationError(ctx.getNode(), 'Row ID is required when matching on Row ID', {
				itemIndex,
			});
		}
		return { rowIds: [rowId], matchedOnId: true };
	}
	const expected = values[matchColumn];
	if (expected === undefined || expected === null || expected === '') {
		throw new NodeOperationError(ctx.getNode(), 'A value for the matching column is required', {
			itemIndex,
		});
	}
	const rows = await fetchAllRows(ctx, sheetId);
	const columnId = Number(matchColumn);
	const rowIds = rows
		.filter((row) => matchesFilter(cellValueOf(row, columnId), String(expected), 'equals', false))
		.map((row) => row.id);
	return { rowIds, matchedOnId: false };
}

function cellsFromMapper(
	mapper: ResourceMapperValue,
	columns: SmartsheetColumn[],
	strict: boolean,
	excludeMatch: boolean,
) {
	const values: Record<string, unknown> = { ...(mapper.value ?? {}) };
	delete values.__rowId;
	if (excludeMatch) {
		for (const key of mapper.matchingColumns ?? []) delete values[key];
	}
	return buildCells(columns, values, strict);
}

async function addRow(
	ctx: IExecuteFunctions,
	sheetId: string,
	columns: SmartsheetColumn[],
	mapper: ResourceMapperValue,
	options: IDataObject,
): Promise<SmartsheetRow[]> {
	const cells = cellsFromMapper(mapper, columns, options.strict === true, false);
	const row: IDataObject = { cells };
	const position = (options.position as string) ?? 'toBottom';
	if (position === 'toTop') row.toTop = true;
	else if (position === 'parent' && options.parentId) row.parentId = Number(options.parentId);
	else if (position === 'sibling' && options.siblingId) row.siblingId = Number(options.siblingId);
	else row.toBottom = true;
	const response = (await smartsheetApiRequest.call(ctx, 'POST', `/sheets/${sheetId}/rows`, [
		row,
	])) as { result?: SmartsheetRow[] };
	return response.result ?? [];
}

async function updateRows(
	ctx: IExecuteFunctions,
	sheetId: string,
	columns: SmartsheetColumn[],
	mapper: ResourceMapperValue,
	rowIds: number[],
	options: IDataObject,
	matchedOnId: boolean,
): Promise<SmartsheetRow[]> {
	const cells = cellsFromMapper(mapper, columns, options.strict === true, !matchedOnId);
	if (cells.length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'Map at least one column to update');
	}
	const body = rowIds.map((id) => ({ id, cells }));
	const response = (await smartsheetApiRequest.call(
		ctx,
		'PUT',
		`/sheets/${sheetId}/rows`,
		body,
	)) as { result?: SmartsheetRow[] };
	return response.result ?? [];
}

export async function executeRow(
	this: IExecuteFunctions,
	operation: string,
	i: number,
	cache: ExecutionCache,
): Promise<INodeExecutionData[]> {
	const sheetId = getLocatorId(this, 'sheetId', i);
	const meta = await cache.getSheetMeta(this, sheetId);

	if (operation === 'create') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const columns = await cache.getColumns(this, sheetId);
		const rows = await addRow(this, sheetId, columns, mappedValues(this, i, columns), options);
		return outputRows(rows, columns, options, i, meta);
	}

	if (operation === 'update' || operation === 'upsert') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const columns = await cache.getColumns(this, sheetId);
		const mapper = mappedValues(this, i, columns);
		const { rowIds, matchedOnId } = await findMatchingRows(this, sheetId, mapper, i);
		if (rowIds.length === 0) {
			if (operation === 'upsert') {
				const rows = await addRow(this, sheetId, columns, mapper, options);
				return outputRows(rows, columns, options, i, meta);
			}
			throw new NodeOperationError(this.getNode(), 'No row matched the given value', {
				itemIndex: i,
			});
		}
		const targets = options.updateAll === true ? rowIds : rowIds.slice(0, 1);
		const rows = await updateRows(this, sheetId, columns, mapper, targets, options, matchedOnId);
		return outputRows(rows, columns, options, i, meta);
	}

	if (operation === 'get') {
		const rowId = String(this.getNodeParameter('rowId', i)).trim();
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const include = (options.include as string[]) ?? [];
		const row = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/rows/${rowId}`,
			undefined,
			{ include: include.join(',') },
		)) as SmartsheetRow;
		const columns = await cache.getColumns(this, sheetId);
		return outputRows([row], columns, options, i, meta);
	}

	if (operation === 'getAll') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const qs: IDataObject = {};
		const include = (options.include as string[]) ?? [];
		if (include.length) qs.include = include.join(',');
		if (options.rowsModifiedSince) {
			qs.rowsModifiedSince = new Date(options.rowsModifiedSince as string).toISOString();
		}
		if (!returnAll) {
			qs.pageSize = this.getNodeParameter('limit', i) as number;
			qs.page = 1;
		}
		const rows = await fetchAllRows(this, sheetId, qs);
		const columns = await cache.getColumns(this, sheetId);
		return outputRows(rows, columns, options, i, meta);
	}

	if (operation === 'search') {
		const searchBy = this.getNodeParameter('searchBy', i) as string;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
		const columns = await cache.getColumns(this, sheetId);

		let rows: SmartsheetRow[];
		if (searchBy === 'columnValue') {
			const columnId = Number(this.getNodeParameter('columnId', i));
			const operator = this.getNodeParameter('operator', i) as string;
			const value =
				operator === 'isEmpty' || operator === 'isNotEmpty'
					? ''
					: String(this.getNodeParameter('value', i, ''));
			const caseInsensitive = options.caseInsensitive !== false;
			const all = await fetchAllRows(this, sheetId);
			rows = all.filter((row) =>
				matchesFilter(cellValueOf(row, columnId), value, operator, caseInsensitive),
			);
		} else {
			const query = String(this.getNodeParameter('query', i));
			const response = (await smartsheetApiRequest.call(
				this,
				'GET',
				`/search/sheets/${sheetId}`,
				undefined,
				{ query },
			)) as { results?: IDataObject[] };
			const rowIds = Array.from(
				new Set(
					(response.results ?? [])
						.filter((r) => r.objectType === 'row')
						.map((r) => Number(r.objectId)),
				),
			);
			rows = rowIds.length ? await fetchAllRows(this, sheetId, { rowIds: rowIds.join(',') }) : [];
		}
		return outputRows(rows.slice(0, limit), columns, options, i, meta);
	}

	if (operation === 'delete') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const rowIds = parseIdList(this.getNodeParameter('rowIds', i));
		if (rowIds.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Provide at least one row ID', { itemIndex: i });
		}
		const deleted: number[] = [];
		for (let start = 0; start < rowIds.length; start += 400) {
			const chunk = rowIds.slice(start, start + 400);
			const response = (await smartsheetApiRequest.call(
				this,
				'DELETE',
				`/sheets/${sheetId}/rows`,
				undefined,
				{
					ids: chunk.join(','),
					ignoreRowsNotFound: options.ignoreRowsNotFound !== false,
				},
			)) as { result?: number[] };
			deleted.push(...(response.result ?? chunk));
		}
		return toExecutionData({ success: true, deletedRowIds: deleted }, i);
	}

	if (operation === 'copy' || operation === 'move') {
		const rowIds = parseIdList(this.getNodeParameter('rowIds', i));
		const destinationSheetId = Number(getLocatorId(this, 'destinationSheetId', i));
		const include = this.getNodeParameter('include', i, []) as string[];
		const response = (await smartsheetApiRequest.call(
			this,
			'POST',
			`/sheets/${sheetId}/rows/${operation}`,
			{ rowIds, to: { sheetId: destinationSheetId } },
			{ include: include.join(',') },
		)) as IDataObject;
		return toExecutionData(response, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown row operation "${operation}"`);
}
