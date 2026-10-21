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

const show = (...operations: string[]) => ({ resource: ['attachment'], operation: operations });

const attachToProperty = (operations: string[]): INodeProperties[] => [
	{
		displayName: 'Attached To',
		name: 'attachTo',
		type: 'options',
		options: [
			{ name: 'Row', value: 'row' },
			{ name: 'Sheet', value: 'sheet' },
		],
		default: 'row',
		displayOptions: { show: show(...operations) },
	},
	{
		displayName: 'Row ID',
		name: 'rowId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { ...show(...operations), attachTo: ['row'] } },
	},
];

export const attachmentDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['attachment'] } },
		options: [
			{
				name: 'Add Link',
				value: 'addLink',
				action: 'Attach a URL',
				description: 'Attach a web link to a sheet or row',
			},
			{ name: 'Delete', value: 'delete', action: 'Delete an attachment' },
			{
				name: 'Download',
				value: 'download',
				action: 'Download an attachment',
				description: 'Download the attachment file as binary data',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get an attachment',
				description: 'Get attachment metadata including a temporary download URL',
			},
			{ name: 'Get Many', value: 'getAll', action: 'Get many attachments' },
			{
				name: 'Upload File',
				value: 'upload',
				action: 'Upload a file',
				description: 'Attach a file from binary data to a sheet or row',
			},
		],
		default: 'getAll',
	},
	{ ...sheetLocator, displayOptions: { show: { resource: ['attachment'] } } },
	...attachToProperty(['getAll', 'upload', 'addLink']),
	...returnAllProperties(show('getAll')),
	{
		displayName: 'Attachment ID',
		name: 'attachmentId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show('get', 'download', 'delete') },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the input binary field containing the file to upload',
		displayOptions: { show: show('upload') },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
		displayOptions: { show: show('download') },
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com/document',
		displayOptions: { show: show('addLink') },
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		description: 'Display name for the link (defaults to the URL)',
		displayOptions: { show: show('addLink') },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('upload') },
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				description: 'Override the file name taken from the binary data',
			},
		],
	},
];

function attachmentsEndpoint(ctx: IExecuteFunctions, sheetId: string, i: number): string {
	const attachTo = ctx.getNodeParameter('attachTo', i) as string;
	if (attachTo === 'row') {
		const rowId = String(ctx.getNodeParameter('rowId', i)).trim();
		return `/sheets/${sheetId}/rows/${rowId}/attachments`;
	}
	return `/sheets/${sheetId}/attachments`;
}

export async function executeAttachment(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const sheetId = getLocatorId(this, 'sheetId', i);

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const attachments = await smartsheetApiRequestAllItems.call(
			this,
			attachmentsEndpoint(this, sheetId, i),
			{},
			limit,
		);
		return toExecutionData(attachments, i);
	}

	if (operation === 'upload') {
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
		const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
		const fileName = (options.fileName as string) || binaryData.fileName || 'file';
		const response = (await smartsheetApiRequest.call(
			this,
			'POST',
			attachmentsEndpoint(this, sheetId, i),
			buffer,
			{},
			{
				json: false,
				headers: {
					'Content-Type': binaryData.mimeType || 'application/octet-stream',
					'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
					'Content-Length': String(buffer.length),
				},
			},
		)) as string | { result?: IDataObject };
		const parsed = typeof response === 'string' ? (JSON.parse(response) as IDataObject) : response;
		return toExecutionData((parsed.result as IDataObject) ?? parsed, i);
	}

	if (operation === 'addLink') {
		const url = this.getNodeParameter('url', i) as string;
		const name = (this.getNodeParameter('name', i, '') as string) || url;
		const response = (await smartsheetApiRequest.call(
			this,
			'POST',
			attachmentsEndpoint(this, sheetId, i),
			{ name, attachmentType: 'LINK', url },
		)) as { result?: IDataObject };
		return toExecutionData(response.result ?? (response as IDataObject), i);
	}

	const attachmentId = String(this.getNodeParameter('attachmentId', i)).trim();

	if (operation === 'get') {
		const attachment = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/attachments/${attachmentId}`,
		)) as IDataObject;
		return toExecutionData(attachment, i);
	}

	if (operation === 'download') {
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
		const attachment = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/sheets/${sheetId}/attachments/${attachmentId}`,
		)) as { name: string; url?: string; mimeType?: string; attachmentType?: string };
		if (!attachment.url) {
			throw new NodeOperationError(
				this.getNode(),
				`Attachment "${attachment.name}" has no downloadable URL (type ${attachment.attachmentType ?? 'unknown'})`,
				{ itemIndex: i },
			);
		}
		const buffer = (await this.helpers.httpRequest({
			method: 'GET',
			url: attachment.url,
			encoding: 'arraybuffer',
			json: false,
		})) as Buffer;
		const binary = await this.helpers.prepareBinaryData(
			Buffer.from(buffer),
			attachment.name,
			attachment.mimeType,
		);
		return [
			{
				json: attachment as unknown as IDataObject,
				binary: { [binaryPropertyName]: binary },
				pairedItem: { item: i },
			},
		];
	}

	if (operation === 'delete') {
		await smartsheetApiRequest.call(
			this,
			'DELETE',
			`/sheets/${sheetId}/attachments/${attachmentId}`,
		);
		return toExecutionData({ success: true, attachmentId: Number(attachmentId) }, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown attachment operation "${operation}"`);
}
