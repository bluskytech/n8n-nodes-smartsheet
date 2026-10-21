import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../shared/descriptions';
import { smartsheetApiRequest, smartsheetApiRequestAllItems } from '../shared/transport';
import { toExecutionData } from '../shared/utils';

const show = (...operations: string[]) => ({ resource: ['user'], operation: operations });

export const userDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['user'] } },
		options: [
			{
				name: 'Get Current User',
				value: 'getMe',
				action: 'Get the current user',
				description: 'Get the user that owns the access token',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many users',
				description: 'List users in the organization (requires system admin)',
			},
		],
		default: 'getMe',
	},
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
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				description: 'Comma-separated list of email addresses to look up',
			},
		],
	},
];

export async function executeUser(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getMe') {
		const me = (await smartsheetApiRequest.call(this, 'GET', '/users/me')) as IDataObject;
		return toExecutionData(me, i);
	}
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const qs: IDataObject = {};
		if (options.email) qs.email = String(options.email).replace(/\s/g, '');
		const users = await smartsheetApiRequestAllItems.call(this, '/users', qs, limit);
		return toExecutionData(users, i);
	}
	throw new NodeOperationError(this.getNode(), `Unknown user operation "${operation}"`);
}
