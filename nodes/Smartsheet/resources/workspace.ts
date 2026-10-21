import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { getLocatorId } from '../shared/context';
import { copyIncludeOptions, returnAllProperties, workspaceLocator } from '../shared/descriptions';
import { smartsheetApiRequest, smartsheetApiRequestAllItems } from '../shared/transport';
import { toExecutionData } from '../shared/utils';

const show = (...operations: string[]) => ({ resource: ['workspace'], operation: operations });

export const workspaceDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['workspace'] } },
		options: [
			{ name: 'Copy', value: 'copy', action: 'Copy a workspace' },
			{ name: 'Create', value: 'create', action: 'Create a workspace' },
			{ name: 'Delete', value: 'delete', action: 'Delete a workspace' },
			{
				name: 'Get',
				value: 'get',
				action: 'Get a workspace',
				description: 'Get a workspace and list its contents',
			},
			{ name: 'Get Many', value: 'getAll', action: 'Get many workspaces' },
			{ name: 'Rename', value: 'rename', action: 'Rename a workspace' },
		],
		default: 'getAll',
	},
	{ ...workspaceLocator, displayOptions: { show: show('get', 'copy', 'rename', 'delete') } },
	...returnAllProperties(show('getAll')),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('create') },
	},
	{
		displayName: 'New Name',
		name: 'newName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('copy', 'rename') },
	},
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
		displayOptions: { show: show('copy') },
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
				displayName: 'Load All Nested Contents',
				name: 'loadAll',
				type: 'boolean',
				default: false,
				description: 'Whether to include the contents of nested folders as well',
			},
		],
	},
];

export async function executeWorkspace(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const workspaces = await smartsheetApiRequestAllItems.call(this, '/workspaces', {}, limit);
		return toExecutionData(workspaces, i);
	}

	if (operation === 'create') {
		const name = this.getNodeParameter('name', i) as string;
		const response = (await smartsheetApiRequest.call(this, 'POST', '/workspaces', {
			name,
		})) as { result?: IDataObject };
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	const workspaceId = getLocatorId(this, 'workspaceId', i);

	if (operation === 'get') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const workspace = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/workspaces/${workspaceId}`,
			undefined,
			{ loadAll: options.loadAll === true ? 'true' : undefined },
		)) as IDataObject;
		return toExecutionData(workspace, i);
	}

	if (operation === 'copy') {
		const newName = this.getNodeParameter('newName', i) as string;
		const include = this.getNodeParameter('include', i, []) as string[];
		const response = (await smartsheetApiRequest.call(
			this,
			'POST',
			`/workspaces/${workspaceId}/copy`,
			{ newName },
			{ include: include.join(',') },
		)) as { result?: IDataObject };
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	if (operation === 'rename') {
		const name = this.getNodeParameter('newName', i) as string;
		const response = (await smartsheetApiRequest.call(this, 'PUT', `/workspaces/${workspaceId}`, {
			name,
		})) as { result?: IDataObject };
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	if (operation === 'delete') {
		await smartsheetApiRequest.call(this, 'DELETE', `/workspaces/${workspaceId}`);
		return toExecutionData({ success: true, workspaceId: Number(workspaceId) }, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown workspace operation "${operation}"`);
}
