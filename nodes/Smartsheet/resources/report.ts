import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { getLocatorId } from '../shared/context';
import { reportLocator, returnAllProperties } from '../shared/descriptions';
import { smartsheetApiRequest, smartsheetApiRequestAllItems } from '../shared/transport';
import { toExecutionData } from '../shared/utils';

const show = (...operations: string[]) => ({ resource: ['report'], operation: operations });

export const reportDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['report'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get a report',
				description: 'Get a report with its rows',
			},
			{ name: 'Get Many', value: 'getAll', action: 'Get many reports' },
		],
		default: 'get',
	},
	{ ...reportLocator, displayOptions: { show: show('get') } },
	...returnAllProperties(show('getAll')),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show('get') },
		options: [
			{
				displayName: 'Max Rows',
				name: 'pageSize',
				type: 'number',
				default: 0,
				description: 'Limit the number of rows returned (0 returns all rows)',
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description: 'Whether to return rows as flat objects keyed by column title',
			},
		],
	},
];

interface ReportColumn {
	virtualId: number;
	title: string;
}

interface ReportRow extends IDataObject {
	cells?: Array<{ virtualColumnId: number; value?: unknown; displayValue?: string }>;
}

export async function executeReport(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const reports = await smartsheetApiRequestAllItems.call(this, '/reports', {}, limit);
		return toExecutionData(reports, i);
	}

	if (operation === 'get') {
		const reportId = getLocatorId(this, 'reportId', i);
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const qs: IDataObject = {};
		if (options.pageSize) {
			qs.pageSize = options.pageSize;
			qs.page = 1;
		} else {
			qs.pageSize = 10000;
		}
		const report = (await smartsheetApiRequest.call(
			this,
			'GET',
			`/reports/${reportId}`,
			undefined,
			qs,
		)) as IDataObject & { columns?: ReportColumn[]; rows?: ReportRow[] };
		if (options.simplify !== false) {
			const titles = new Map<number, string>();
			for (const column of report.columns ?? []) titles.set(column.virtualId, column.title);
			report.rows = (report.rows ?? []).map((row) => {
				const { cells, ...rest } = row;
				const flat: IDataObject = { ...rest };
				for (const cell of cells ?? []) {
					const key = titles.get(cell.virtualColumnId) ?? String(cell.virtualColumnId);
					flat[key] = (cell.value ?? cell.displayValue ?? null) as IDataObject[string];
				}
				return flat;
			}) as ReportRow[];
		}
		return toExecutionData(report, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown report operation "${operation}"`);
}
