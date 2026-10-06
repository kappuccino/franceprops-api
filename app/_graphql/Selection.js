import {genFailedMutation} from './_helper.js'
import * as selectionApi from '../selection/selection.js'
import * as productApi from '../product/product.js'

// Website selection, reached by the Nuxt server only (@service): the visitor is
// identified by his session token (customer) or his anonymous key

const Selection = `
  type Selection {
    _id: String
    key: String
    count: Int
    items: [SelectionItem]
    updated: Date
  }
`

const SelectionItem = `
  type SelectionItem {
    _product: String
    added: Date
    product: Product
  }
`

const SelectionMutation = `
  type SelectionMutation{
    success: Boolean
    message: String
		stack: [String]
    selection: Selection
  }
`

// --

export default {
	TypeDefs: [
		Selection,
		SelectionItem,

		SelectionMutation
	],

	//--

	Query: `
    siteSelection(token: String key: String): Selection @service
	`,

	QueryResolvers: {
		siteSelection: (obj, {token, key}) => selectionApi.find({token, key}),
	},

	//--

	Resolvers: {
		// Products removed from the catalogue are left out
		Selection: {
			items: obj => selectionApi.existingItems(obj.items),
			count: async obj => (await selectionApi.existingItems(obj.items)).length,
		},

		SelectionItem: {
			product: obj => productApi.getById(obj._product),
		},
	},

	//--

	Mutation: `
		siteSelectionAdd(token: String key: String _product: String!): SelectionMutation @service
		siteSelectionRemove(token: String key: String _product: String!): SelectionMutation @service
		siteSelectionAttach(token: String! key: String): SelectionMutation @service
	`,

	MutationResolvers: {
		siteSelectionAdd: async (obj, {token, key, _product}, context) => {
			try {
				const selection = await selectionApi.add({token, key}, _product)
				return {success: true, selection}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		siteSelectionRemove: async (obj, {token, key, _product}, context) => {
			try {
				const selection = await selectionApi.remove({token, key}, _product)
				return {success: true, selection}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		siteSelectionAttach: async (obj, {token, key}, context) => {
			try {
				const selection = await selectionApi.attach(token, key)
				return {success: true, selection}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},
	}
}
