import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { getLocatorId } from '../shared/context';
import { returnAllProperties, sheetLocator } from '../shared/descriptions';
import { smartsheetApiRequest, smartsheetApiRequestAllItems } from '../shared/transport';
import { toExecutionData } from '../shared/utils';

const show = (...operations: string[]) => ({ resource: ['comment'], operation: operations });

export const commentDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['comment'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Add a comment',
				description: 'Start a new comment thread on a row or sheet, or reply to an existing one',
			},
			{ name: 'Delete', value: 'delete', action: 'Delete a comment' },
			{ name: 'Get', value: 'get', action: 'Get a comment' },
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many comments',
				description: 'List the comments on a sheet or row',
			},
			{
				name: 'Get Thread',
				value: 'getDiscussion',
				action: 'Get a comment thread',
				description: 'Get a discussion (thread) with all of its comments',
			},
		],
		default: 'create',
	},
	{ ...sheetLocator, displayOptions: { show: { resource: ['comment'] } } },
	{
		displayName: 'Attached To',
		name: 'attachTo',
		type: 'options',
		options: [
			{ name: 'Row', value: 'row' },
			{ name: 'Sheet', value: 'sheet' },
		],
		default: 'row',
		displayOptions: { show: show('getAll', 'create') },
	},
	{
		displayName: 'Row ID',
		name: 'rowId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { ...show('getAll', 'create'), attachTo: ['row'] } },
	},
	{
		displayName: 'Comment Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: { show: show('create') },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('create') },
		options: [
			{
				displayName: 'Reply to Thread ID',
				name: 'discussionId',
				type: 'string',
				default: '',
				description: 'ID of an existing discussion to reply to. Leave empty to start a new thread.',
			},
		],
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
				displayName: 'Flatten to Comments',
				name: 'flatten',
				type: 'boolean',
				default: true,
				description:
					'Whether to return one item per comment (with its thread details) instead of one item per thread',
			},
		],
	},
	{
		displayName: 'Comment ID',
		name: 'commentId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('get', 'delete') },
	},
	{
		displayName: 'Thread (Discussion) ID',
		name: 'discussionId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('getDiscussion') },
	},
];

export async function executeComment(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const sheetId = getLocatorId(this, 'sheetId', i);

	if (operation === 'getAll') {
		const attachTo = this.getNodeParameter('attachTo', i) as string;
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const endpoint =
			attachTo === 'row'
				? `/sheets/${sheetId}/rows/${String(this.getNodeParameter('rowId', i)).trim()}/discussions`
				: `/sheets/${sheetId}/discussions`;
		const discussions = await smartsheetApiRequestAllItems.call(this, endpoint, {
			include: 'comments',
		});
		let items: IDataObject[];
		if (options.flatten !== false) {
			items = [];
			for (const discussion of discussions) {
				const { comments, ...thread } = discussion as IDataObject & { comments?: IDataObject[] };
				for (const comment of comments ?? []) {
					items.push({
						...comment,
						discussionId: thread.id,
						discussionTitle: thread.title,
						parentType: thread.parentType,
						parentId: thread.parentId,
					});
				}
			}
		} else {
			items = discussions;
		}
		if (!returnAll) items = items.slice(0, this.getNodeParameter('limit', i) as number);
		return toExecutionData(items, i);
	}

	if (operation === 'create') {
		const text = this.getNodeParameter('text', i) as string;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		if (options.discussionId) {
			const response = (await smartsheetApiRequest.call(
				this,
				'POST',
				`/sheets/${sheetId}/discussions/${String(options.discussionId).trim()}/comments`,
				{ text },
			)) as { result?: IDataObject };
			return toExecutionData(response.result ?? (response as IDataObject), i);
		}
		const attachTo = this.getNodeParameter('attachTo', i) as string;
		const endpoint =
			attachTo === 'row'
				? `/sheets/${sheetId}/rows/${String(this.getNodeParameter('rowId', i)).trim()}/discussions`
				: `/sheets/${sheetId}/discussions`;
		const response = (await smartsheetApiRequest.call(this, 'POST', endpoint, {
			comment: { text },
		})) as { result?: IDataObject };
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	if (operation === 'getDiscussion') {
		const discussionId = String(this.getNodeParameter('discussionId', i)).trim();
		const discussion = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/discussions/${discussionId}`,
			undefined,
			{ include: 'comments,attachments' },
		)) as IDataObject;
		return toExecutionData(discussion, i);
	}

	const commentId = String(this.getNodeParameter('commentId', i)).trim();

	if (operation === 'get') {
		const comment = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/comments/${commentId}`,
		)) as IDataObject;
		return toExecutionData(comment, i);
	}

	if (operation === 'delete') {
		await smartsheetApiRequest.call(this, 'DELETE', `/sheets/${sheetId}/comments/${commentId}`);
		return toExecutionData({ success: true, commentId: Number(commentId) }, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown comment operation "${operation}"`);
}
