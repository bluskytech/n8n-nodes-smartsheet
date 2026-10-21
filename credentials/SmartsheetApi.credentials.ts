import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SmartsheetApi implements ICredentialType {
	name = 'smartsheetApi';

	displayName = 'Smartsheet API';

	icon: Icon = {
		light: 'file:../icons/smartsheet.svg',
		dark: 'file:../icons/smartsheet.dark.svg',
	};

	documentationUrl =
		'https://developers.smartsheet.com/api/smartsheet/guides/basics/authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Personal API access token. In Smartsheet open Account > Apps & Integrations > API Access > Generate new access token.',
		},
		{
			displayName: 'Region',
			name: 'region',
			type: 'options',
			options: [
				{ name: 'Global (api.smartsheet.com)', value: 'https://api.smartsheet.com/2.0' },
				{ name: 'EU (api.smartsheet.eu)', value: 'https://api.smartsheet.eu/2.0' },
				{
					name: 'US Government (api.smartsheetgov.com)',
					value: 'https://api.smartsheetgov.com/2.0',
				},
			],
			default: 'https://api.smartsheet.com/2.0',
			description: 'The Smartsheet API host your account lives on',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.region}}',
			url: '/users/me',
			method: 'GET',
		},
	};
}
