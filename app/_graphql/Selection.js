import {genFailedMutation} from './_helper.js'
import * as selectionApi from '../selection/selection.js'
import * as productApi from '../product/product.js'

// Website selections ("paniers"), reached by the Nuxt server only (@service):
// the visitor is identified by his session token (customer) or his anonymous
// key. Without _id, a mutation works on the active selection.

const Selection = `
  type Selection {
    _id: String
    key: String
    name: String
    _request: String
    _source: String
    count: Int
    items: [SelectionItem]
    createdAt: Date
    updatedAt: Date
  }
`

const SelectionItem = `
  type SelectionItem {
    _product: String
    quantity: Int
    addedAt: Date
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

// Resolver of a mutation returning a selection
function mutation(run){
	return async (obj, args, context) => {
		try {
			const selection = await run(args)
			return {success: true, selection}
		} catch(err) {
			return genFailedMutation(err, context)
		}
	}
}

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
    siteSelections(token: String!): [Selection] @service
	`,

	QueryResolvers: {
		siteSelection: (obj, {token, key}) => selectionApi.find({token, key}),
		siteSelections: (obj, {token}) => selectionApi.list(token),
	},

	//--

	Resolvers: {
		// Products removed from the catalogue are left out
		Selection: {
			name: obj => obj.name || selectionApi.DEFAULT_NAME,
			items: obj => selectionApi.existingItems(obj.items),
			count: async obj => (await selectionApi.existingItems(obj.items)).length,
		},

		SelectionItem: {
			quantity: obj => obj.quantity || 1,
			product: obj => productApi.getById(obj._product),
		},
	},

	//--

	Mutation: `
		siteSelectionAdd(token: String key: String _product: String! quantity: Int): SelectionMutation @service
		siteSelectionQuantity(token: String key: String _product: String! quantity: Int!): SelectionMutation @service
		siteSelectionRemove(token: String key: String _product: String!): SelectionMutation @service
		siteSelectionAttach(token: String! key: String): SelectionMutation @service
		siteSelectionDetach(token: String!): SelectionMutation @service

		siteSelectionCreate(token: String! name: String!): SelectionMutation @service
		siteSelectionRename(token: String! _id: String! name: String!): SelectionMutation @service
		siteSelectionActivate(token: String! _id: String!): SelectionMutation @service
		siteSelectionDelete(token: String! _id: String!): SelectionMutation @service
	`,

	MutationResolvers: {
		siteSelectionAdd: mutation(({token, key, _product, quantity}) => selectionApi.add({token, key}, _product, quantity ?? 1)),
		siteSelectionQuantity: mutation(({token, key, _product, quantity}) => selectionApi.setQuantity({token, key}, _product, quantity)),
		siteSelectionRemove: mutation(({token, key, _product}) => selectionApi.remove({token, key}, _product)),
		siteSelectionAttach: mutation(({token, key}) => selectionApi.attach(token, key)),

		// A revision in progress becomes a new request
		siteSelectionDetach: mutation(({token}) => selectionApi.detach({token})),

		siteSelectionCreate: mutation(({token, name}) => selectionApi.create(token, name)),
		siteSelectionRename: mutation(({token, _id, name}) => selectionApi.rename(token, _id, name)),
		siteSelectionActivate: mutation(({token, _id}) => selectionApi.activate(token, _id)),

		// Returns the active selection afterwards
		siteSelectionDelete: mutation(({token, _id}) => selectionApi.removeSelection(token, _id)),
	}
}
