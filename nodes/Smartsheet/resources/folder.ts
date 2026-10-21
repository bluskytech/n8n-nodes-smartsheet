import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { getDestination, getLocatorId } from '../shared/context';
import {
	copyIncludeOptions,
	destinationProperties,
	folderLocator,
	returnAllProperties,
} from '../shared/descriptions';
import { smartsheetApiRequest, smartsheetApiRequestAllItems } from '../shared/transport';
import { toExecutionData } from '../shared/utils';

const show = (...operations: string[]) => ({ resource: ['folder'], operation: operations });

export const folderDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['folder'] } },
		options: [
			{
				name: 'Copy',
				value: 'copy',
				action: 'Copy a folder',
				description: 'Copy a folder and everything inside it',
			},
			{ name: 'Create', value: 'create', action: 'Create a folder' },
			{ name: 'Delete', value: 'delete', action: 'Delete a folder' },
			{
				name: 'Get',
				value: 'get',
				action: 'Get a folder',
				description: 'Get a folder and list its contents',
			},
			{ name: 'Get Many', value: 'getAll', action: 'Get many folders' },
			{ name: 'Move', value: 'move', action: 'Move a folder' },
			{ name: 'Rename', value: 'rename', action: 'Rename a folder' },
		],
		default: 'create',
	},
	{ ...folderLocator, displayOptions: { show: show('get', 'copy', 'move', 'rename', 'delete') } },

	// create / getAll: where
	...destinationProperties('location', show('create', 'getAll')),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('create') },
	},
	...returnAllProperties(show('getAll')),

	// copy / move / rename
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
		description: 'What to copy along with the folder structure',
		displayOptions: { show: show('copy') },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('copy') },
		options: [
			{
				displayName: 'Skip Remap',
				name: 'skipRemap',
				type: 'multiOptions',
				options: [
					{ name: 'Cell Links', value: 'cellLinks' },
					{ name: 'Reports', value: 'reports' },
					{ name: 'Sheet Hyperlinks', value: 'sheetHyperlinks' },
					{ name: 'Sights (Dashboards)', value: 'sights' },
				],
				default: [],
				description:
					'References that should keep pointing at the original sheets instead of the copies',
			},
		],
	},
];

export async function executeFolder(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'create' || operation === 'getAll') {
		const { destinationType, destinationId } = getDestination(this, 'location', i);
		const endpoint =
			destinationType === 'home'
				? '/home/folders'
				: destinationType === 'folder'
					? `/folders/${destinationId}/folders`
					: `/workspaces/${destinationId}/folders`;
		if (operation === 'create') {
			const name = this.getNodeParameter('name', i) as string;
			const response = (await smartsheetApiRequest.call(this, 'POST', endpoint, { name })) as {
				result?: IDataObject;
			};
			return toExecutionData(response.result ?? (response as IDataObject), i);
		}
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const folders = await smartsheetApiRequestAllItems.call(this, endpoint, {}, limit);
		return toExecutionData(folders, i);
	}

	const folderId = getLocatorId(this, 'folderId', i);

	if (operation === 'get') {
		const folder = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/folders/${folderId}`,
		)) as IDataObject;
		return toExecutionData(folder, i);
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
			const options = this.getNodeParameter('options', i, {}) as IDataObject;
			const skipRemap = (options.skipRemap as string[]) ?? [];
			if (skipRemap.length) qs.skipRemap = skipRemap.join(',');
		}
		const response = (await smartsheetApiRequest.call(
			this,
			'POST',
			`/folders/${folderId}/${operation}`,
			body,
			qs,
		)) as { result?: IDataObject };
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	if (operation === 'rename') {
		const name = this.getNodeParameter('newName', i) as string;
		const response = (await smartsheetApiRequest.call(this, 'PUT', `/folders/${folderId}`, {
			name,
		})) as { result?: IDataObject };
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	if (operation === 'delete') {
		await smartsheetApiRequest.call(this, 'DELETE', `/folders/${folderId}`);
		return toExecutionData({ success: true, folderId: Number(folderId) }, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown folder operation "${operation}"`);
}
