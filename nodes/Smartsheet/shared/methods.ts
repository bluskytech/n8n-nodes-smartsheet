import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { smartsheetApiRequest, smartsheetApiRequestAllItems } from './transport';
import type { SmartsheetColumn } from './utils';
import { isReadOnlyColumn } from './utils';

function filterByName(items: IDataObject[], filter?: string): IDataObject[] {
	if (!filter) return items;
	const needle = filter.toLowerCase();
	return items.filter((item) =>
		String(item.name ?? '')
			.toLowerCase()
			.includes(needle),
	);
}

function toSearchResult(items: IDataObject[], urlKey = 'permalink'): INodeListSearchResult {
	return {
		results: items
			.sort((a, b) => String(a.name).localeCompare(String(b.name)))
			.map((item) => ({
				name: String(item.name),
				value: String(item.id),
				url: item[urlKey] ? String(item[urlKey]) : undefined,
			})),
	};
}

export async function searchSheets(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const sheets = await smartsheetApiRequestAllItems.call(this, '/sheets');
	return toSearchResult(filterByName(sheets, filter));
}

export async function searchReports(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const reports = await smartsheetApiRequestAllItems.call(this, '/reports');
	return toSearchResult(filterByName(reports, filter));
}

export async function searchWorkspaces(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const workspaces = await smartsheetApiRequestAllItems.call(this, '/workspaces');
	return toSearchResult(filterByName(workspaces, filter));
}

/**
 * Folders have no flat list endpoint. Without a filter we show Home folders and
 * the top-level folders of every workspace; with a filter we use Smartsheet
 * search across all folder names.
 */
export async function searchFolders(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	if (filter) {
		const response = (await smartsheetApiRequest.call(this, 'GET', '/search', undefined, {
			query: filter,
			scopes: 'folderNames',
		})) as { results?: IDataObject[] };
		const items = (response.results ?? [])
			.filter((r) => r.objectType === 'folder')
			.map((r) => ({ id: r.objectId, name: r.text }));
		return toSearchResult(items);
	}

	const items: IDataObject[] = [];
	const home = await smartsheetApiRequestAllItems.call(this, '/home/folders');
	items.push(...home.map((f) => ({ ...f, name: `Home / ${f.name as string}` })));

	const workspaces = await smartsheetApiRequestAllItems.call(this, '/workspaces');
	for (const workspace of workspaces) {
		const folders = await smartsheetApiRequestAllItems.call(
			this,
			`/workspaces/${workspace.id as number}/folders`,
		);
		items.push(
			...folders.map((f) => ({ ...f, name: `${workspace.name as string} / ${f.name as string}` })),
		);
	}
	return toSearchResult(items);
}

async function currentSheetId(this: ILoadOptionsFunctions): Promise<string> {
	const sheetId = this.getNodeParameter('sheetId', undefined, {
		extractValue: true,
	}) as string;
	if (!sheetId) {
		throw new NodeOperationError(this.getNode(), 'Select a sheet first');
	}
	return sheetId;
}

export async function fetchColumns(
	this: ILoadOptionsFunctions,
	sheetId: string,
): Promise<SmartsheetColumn[]> {
	const columns = (await smartsheetApiRequestAllItems.call(
		this,
		`/sheets/${sheetId}/columns`,
	)) as unknown as SmartsheetColumn[];
	return columns;
}

export async function getColumnsOptions(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const sheetId = await currentSheetId.call(this);
	const columns = await fetchColumns.call(this, sheetId);
	return columns.map((column) => ({
		name: `${column.title}${column.primary ? ' (primary)' : ''}`,
		value: String(column.id),
		description: column.type,
	}));
}

const typeMap: Record<string, ResourceMapperField['type']> = {
	TEXT_NUMBER: 'string',
	CHECKBOX: 'boolean',
	DATE: 'dateTime',
	DATETIME: 'dateTime',
	ABSTRACT_DATETIME: 'dateTime',
	PICKLIST: 'options',
	MULTI_PICKLIST: 'array',
	CONTACT_LIST: 'string',
	MULTI_CONTACT_LIST: 'array',
	DURATION: 'string',
	PREDECESSOR: 'string',
};

/** Resource mapper schema: one field per column, plus a synthetic Row ID. */
export async function getRowMappingColumns(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const sheetId = await currentSheetId.call(this);
	const columns = await fetchColumns.call(this, sheetId);

	const fields: ResourceMapperField[] = [
		{
			id: '__rowId',
			displayName: 'Row ID',
			required: false,
			defaultMatch: true,
			canBeUsedToMatch: true,
			display: true,
			type: 'string',
		},
	];
	for (const column of columns) {
		if (isReadOnlyColumn(column)) continue;
		const field: ResourceMapperField = {
			id: String(column.id),
			displayName: column.title,
			required: false,
			defaultMatch: false,
			canBeUsedToMatch: true,
			display: true,
			type: typeMap[column.type] ?? 'string',
		};
		if (column.type === 'PICKLIST' && column.options?.length) {
			field.options = column.options.map((o) => ({ name: o, value: o }));
		}
		fields.push(field);
	}
	return { fields };
}
