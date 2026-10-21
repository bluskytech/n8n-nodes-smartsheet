import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { ExecutionCache } from '../shared/context';
import { getLocatorId } from '../shared/context';
import { returnAllProperties, sheetLocator } from '../shared/descriptions';
import { smartsheetApiRequest, smartsheetApiRequestAllItems } from '../shared/transport';
import { toExecutionData } from '../shared/utils';
import { columnTypeOptions } from './sheet';

const show = (...operations: string[]) => ({ resource: ['column'], operation: operations });

const columnPicker: INodeProperties = {
	displayName: 'Column Name or ID',
	name: 'columnId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getColumns', loadOptionsDependsOn: ['sheetId.value'] },
	default: '',
	required: true,
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
};

const editableFields: INodeProperties[] = [
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		default: '',
	},
	{
		displayName: 'Dropdown Options',
		name: 'options',
		type: 'string',
		default: '',
		description: 'Comma-separated values for dropdown columns',
	},
	{
		displayName: 'Hidden',
		name: 'hidden',
		type: 'boolean',
		default: false,
	},
	{
		displayName: 'Index (Position)',
		name: 'index',
		type: 'number',
		default: 0,
		description: 'Zero-based column position',
	},
	{
		displayName: 'Locked',
		name: 'locked',
		type: 'boolean',
		default: false,
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		options: columnTypeOptions,
		default: 'TEXT_NUMBER',
	},
	{
		displayName: 'Validation',
		name: 'validation',
		type: 'boolean',
		default: false,
		description: 'Whether to restrict cell values to the column type',
	},
	{
		displayName: 'Width',
		name: 'width',
		type: 'number',
		default: 150,
	},
];

export const columnDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['column'] } },
		options: [
			{ name: 'Create', value: 'create', action: 'Add a column' },
			{ name: 'Delete', value: 'delete', action: 'Delete a column' },
			{ name: 'Get', value: 'get', action: 'Get a column' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many columns' },
			{ name: 'Update', value: 'update', action: 'Update a column' },
		],
		default: 'getAll',
	},
	{ ...sheetLocator, displayOptions: { show: { resource: ['column'] } } },
	{ ...columnPicker, displayOptions: { show: show('get', 'update', 'delete') } },
	...returnAllProperties(show('getAll')),
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('create') },
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		options: columnTypeOptions,
		default: 'TEXT_NUMBER',
		displayOptions: { show: show('create') },
	},
	{
		displayName: 'Index (Position)',
		name: 'index',
		type: 'number',
		default: 0,
		required: true,
		description: 'Zero-based position of the new column',
		displayOptions: { show: show('create') },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show('create') },
		options: editableFields.filter((f) => !['title', 'type', 'index'].includes(f.name)),
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show('update') },
		options: editableFields,
	},
];

function normalizeOptions(fields: IDataObject): IDataObject {
	const body: IDataObject = { ...fields };
	if (typeof body.options === 'string') {
		const list = body.options
			.split(',')
			.map((o) => o.trim())
			.filter((o) => o);
		if (list.length) body.options = list;
		else delete body.options;
	}
	return body;
}

export async function executeColumn(
	this: IExecuteFunctions,
	operation: string,
	i: number,
	cache: ExecutionCache,
): Promise<INodeExecutionData[]> {
	const sheetId = getLocatorId(this, 'sheetId', i);

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const columns = await smartsheetApiRequestAllItems.call(
			this,
			`/sheets/${sheetId}/columns`,
			{},
			limit,
		);
		return toExecutionData(columns, i);
	}

	if (operation === 'create') {
		const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const body = normalizeOptions({
			title: this.getNodeParameter('title', i),
			type: this.getNodeParameter('type', i),
			index: this.getNodeParameter('index', i),
			...additional,
		});
		const response = (await smartsheetApiRequest.call(this, 'POST', `/sheets/${sheetId}/columns`, [
			body,
		])) as { result?: IDataObject[] };
		cache.invalidate(sheetId);
		return toExecutionData(response.result ?? [], i);
	}

	const columnId = String(this.getNodeParameter('columnId', i)).trim();

	if (operation === 'get') {
		const column = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/columns/${columnId}`,
		)) as IDataObject;
		return toExecutionData(column, i);
	}

	if (operation === 'update') {
		const body = normalizeOptions(this.getNodeParameter('updateFields', i, {}) as IDataObject);
		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
				itemIndex: i,
			});
		}
		const response = (await smartsheetApiRequest.call(
			this,
			'PUT',
			`/sheets/${sheetId}/columns/${columnId}`,
			body,
		)) as { result?: IDataObject };
		cache.invalidate(sheetId);
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	if (operation === 'delete') {
		await smartsheetApiRequest.call(this, 'DELETE', `/sheets/${sheetId}/columns/${columnId}`);
		cache.invalidate(sheetId);
		return toExecutionData({ success: true, columnId: Number(columnId) }, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown column operation "${operation}"`);
}
