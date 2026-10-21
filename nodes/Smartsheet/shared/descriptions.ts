import type { INodeProperties } from 'n8n-workflow';

const numericIdValidation = (what: string) => [
	{
		type: 'regex',
		properties: {
			regex: '^[0-9]+$',
			errorMessage: `Must be a numeric Smartsheet ${what} ID`,
		},
	},
];

export const sheetLocator: INodeProperties = {
	displayName: 'Sheet',
	name: 'sheetId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The Smartsheet sheet to work with',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchSheets', searchable: true },
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 1234567890123456',
			validation: numericIdValidation('sheet'),
		},
	],
};

export const destinationSheetLocator: INodeProperties = {
	...sheetLocator,
	default: { mode: 'list', value: '' },
	displayName: 'Destination Sheet',
	name: 'destinationSheetId',
	description: 'The sheet the rows will be copied or moved to',
};

export const folderLocator: INodeProperties = {
	displayName: 'Folder',
	name: 'folderId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchFolders', searchable: true },
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 2345678901234567',
			validation: numericIdValidation('folder'),
		},
	],
};

export const workspaceLocator: INodeProperties = {
	displayName: 'Workspace',
	name: 'workspaceId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchWorkspaces', searchable: true },
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 3456789012345678',
			validation: numericIdValidation('workspace'),
		},
	],
};

export const reportLocator: INodeProperties = {
	displayName: 'Report',
	name: 'reportId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchReports', searchable: true },
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			validation: numericIdValidation('report'),
		},
	],
};

/** "Where to put it" selector shared by sheet/folder create, copy and move. */
export function destinationProperties(
	prefix: string,
	show: { resource: string[]; operation: string[] },
): INodeProperties[] {
	return [
		{
			displayName: 'Destination Type',
			name: `${prefix}Type`,
			type: 'options',
			options: [
				{ name: 'Home (My Sheets)', value: 'home' },
				{ name: 'Folder', value: 'folder' },
				{ name: 'Workspace', value: 'workspace' },
			],
			default: 'home',
			displayOptions: { show },
		},
		{
			...folderLocator,
			displayName: 'Destination Folder',
			name: `${prefix}FolderId`,
			default: { mode: 'list', value: '' },
			displayOptions: { show: { ...show, [`${prefix}Type`]: ['folder'] } },
		},
		{
			...workspaceLocator,
			displayName: 'Destination Workspace',
			name: `${prefix}WorkspaceId`,
			default: { mode: 'list', value: '' },
			displayOptions: { show: { ...show, [`${prefix}Type`]: ['workspace'] } },
		},
	];
}

export const returnAllProperties = (show: {
	resource: string[];
	operation: string[];
}): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { ...show, returnAll: [false] } },
	},
];

export const simplifyProperty = (show: {
	resource: string[];
	operation: string[];
}): INodeProperties => ({
	displayName: 'Simplify',
	name: 'simplify',
	type: 'boolean',
	default: true,
	description:
		'Whether to return rows as flat objects keyed by column title instead of the raw Smartsheet cells array',
	displayOptions: { show },
});

export const copyIncludeOptions = [
	{ name: 'Attachments', value: 'attachments' },
	{ name: 'Cell Links', value: 'cellLinks' },
	{ name: 'Data (Rows)', value: 'data' },
	{ name: 'Discussions (Comments)', value: 'discussions' },
	{ name: 'Filters', value: 'filters' },
	{ name: 'Forms', value: 'forms' },
	{ name: 'Rule Recipients', value: 'ruleRecipients' },
	{ name: 'Rules (Automations)', value: 'rules' },
	{ name: 'Shares', value: 'shares' },
];
