import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { attachmentDescription, executeAttachment } from './resources/attachment';
import { columnDescription, executeColumn } from './resources/column';
import { commentDescription, executeComment } from './resources/comment';
import { executeFolder, folderDescription } from './resources/folder';
import { executeReport, reportDescription } from './resources/report';
import { executeRow, rowDescription } from './resources/row';
import { executeSearch, searchDescription } from './resources/search';
import { executeSheet, sheetDescription } from './resources/sheet';
import { executeUser, userDescription } from './resources/user';
import { executeWorkspace, workspaceDescription } from './resources/workspace';
import { ExecutionCache } from './shared/context';
import { toNodeError } from './shared/transport';
import {
	getColumnsOptions,
	getRowMappingColumns,
	searchFolders,
	searchReports,
	searchSheets,
	searchWorkspaces,
} from './shared/methods';

export class Smartsheet implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Smartsheet',
		name: 'smartsheet',
		icon: {
			light: 'file:../../icons/smartsheet.svg',
			dark: 'file:../../icons/smartsheet.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Work with Smartsheet sheets, rows, columns, attachments, comments, folders and workspaces',
		defaults: { name: 'Smartsheet' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'smartsheetApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Attachment', value: 'attachment' },
					{ name: 'Column', value: 'column' },
					{ name: 'Comment', value: 'comment' },
					{ name: 'Folder', value: 'folder' },
					{ name: 'Report', value: 'report' },
					{ name: 'Row', value: 'row' },
					{ name: 'Search', value: 'search' },
					{ name: 'Sheet', value: 'sheet' },
					{ name: 'User', value: 'user' },
					{ name: 'Workspace', value: 'workspace' },
				],
				default: 'row',
			},
			...rowDescription,
			...sheetDescription,
			...columnDescription,
			...attachmentDescription,
			...commentDescription,
			...folderDescription,
			...workspaceDescription,
			...reportDescription,
			...searchDescription,
			...userDescription,
		],
	};

	methods = {
		listSearch: { searchSheets, searchFolders, searchWorkspaces, searchReports },
		loadOptions: { getColumns: getColumnsOptions },
		resourceMapping: { getRowMappingColumns },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const cache = new ExecutionCache();

		for (let i = 0; i < items.length; i++) {
			try {
				let result: INodeExecutionData[];
				switch (resource) {
					case 'row':
						result = await executeRow.call(this, operation, i, cache);
						break;
					case 'sheet':
						result = await executeSheet.call(this, operation, i, cache);
						break;
					case 'column':
						result = await executeColumn.call(this, operation, i, cache);
						break;
					case 'attachment':
						result = await executeAttachment.call(this, operation, i);
						break;
					case 'comment':
						result = await executeComment.call(this, operation, i);
						break;
					case 'folder':
						result = await executeFolder.call(this, operation, i);
						break;
					case 'workspace':
						result = await executeWorkspace.call(this, operation, i);
						break;
					case 'report':
						result = await executeReport.call(this, operation, i);
						break;
					case 'search':
						result = await executeSearch.call(this, operation, i);
						break;
					case 'user':
						result = await executeUser.call(this, operation, i);
						break;
					default:
						throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`);
				}
				returnData.push(...result);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw toNodeError(this.getNode(), error, i);
			}
		}
		return [returnData];
	}
}
