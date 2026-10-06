import {genFailedMutation} from './_helper.js'
import * as settingsApi from '../settings/settings.js'

// --

const Settings = `
  type Settings {
		_id: String
		slug: String

		brandName: String
		brandShort: String

		mailCopy: [String]
		mailSubjectPrefix: String
  }
`

// Subset readable without authentication (login pages)
const PublicSettings = `
  type PublicSettings {
		brandName: String
		brandShort: String
  }
`

const SettingsMutation = `
  type SettingsMutation{
    success: Boolean
    message: String
		stack: [String]
    settings: Settings
  }
`

// --

export default {
	TypeDefs: [
		Settings,
		PublicSettings,

		SettingsMutation
	],

	//--

	Query: `
    getSettings(slug: String): Settings
    getPublicSettings: PublicSettings
	`,

	QueryResolvers: {
		getSettings: (obj, {slug='default'}) => settingsApi.getBySlug(slug),
		getPublicSettings: () => settingsApi.getDefault()
	},

	//--

	Resolvers: {
		Settings: {
		}
	},

	//--

	Mutation: `
		updateSettings(slug:String data:JSONObject!): SettingsMutation @admin

	`,

	MutationResolvers: {
		updateSettings: async (obj, {slug='default', data}, context) => {
			try {
				const settings = await settingsApi.update(slug, data)
				return {success: true, settings}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		}
	},
}
