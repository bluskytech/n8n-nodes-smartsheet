import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { smartsheetApiRequest } from '../shared/transport';
import { toExecutionData } from '../shared/utils';

const show = (...operations: string[]) => ({ resource: ['search'], operation: operations });

export const searchDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['search'] } },
		options: [
			{
				name: 'Search Everything',
				value: 'all',
				action: 'Search everything',
				description: 'Full text search across all sheets, reports, folders and workspaces',
			},
		],
		default: 'all',
	},
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		default: '',
		required: true,
		description: 'Text to search for. Use double quotes for an exact phrase.',
		displayOptions: { show: show('all') },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('all') },
		options: [
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Modified Since',
				name: 'modifiedSince',
				type: 'dateTime',
				default: '',
				description: 'Only match items modified at or after this time',
			},
			{
				displayName: 'Personal Workspace Only',
				name: 'personalWorkspace',
				type: 'boolean',
				default: false,
				description: 'Whether to search only items in your own Home area',
			},
			{
				displayName: 'Scopes',
				name: 'scopes',
				type: 'multiOptions',
				options: [
					{ name: 'Attachments', value: 'attachments' },
					{ name: 'Cell Data', value: 'cellData' },
					{ name: 'Comments', value: 'comments' },
					{ name: 'Folder Names', value: 'folderNames' },
					{ name: 'Report Names', value: 'reportNames' },
					{ name: 'Sheet Names', value: 'sheetNames' },
					{ name: 'Sight (Dashboard) Names', value: 'sightNames' },
					{ name: 'Summary Fields', value: 'summaryFields' },
					{ name: 'Template Names', value: 'templateNames' },
					{ name: 'Workspace Names', value: 'workspaceNames' },
				],
				default: [],
				description: 'Limit the search to these object types (all when empty)',
			},
		],
	},
];

export async function executeSearch(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'all') {
		const query = this.getNodeParameter('query', i) as string;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const qs: IDataObject = { query };
		const scopes = (options.scopes as string[]) ?? [];
		if (scopes.length) qs.scopes = scopes.join(',');
		if (options.modifiedSince) {
			qs.modifiedSince = new Date(options.modifiedSince as string).toISOString();
		}
		if (options.personalWorkspace) qs.location = 'personalWorkspace';
		const response = (await smartsheetApiRequest.call(this, 'GET', '/search', undefined, qs)) as {
			results?: IDataObject[];
			totalCount?: number;
		};
		const limit = (options.limit as number) ?? 50;
		return toExecutionData((response.results ?? []).slice(0, limit), i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown search operation "${operation}"`);
}
