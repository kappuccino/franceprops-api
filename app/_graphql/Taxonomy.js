import {genFailedMutation} from './_helper.js'
import * as taxonomyApi from '../taxonomy/taxonomy.js'

// --

const Taxonomy = `
  type Taxonomy {
    _id: String
    taxonomy: String
    _parent: String
    order: Int

    nameFR: String
    nameEN: String

    createdAt: Date
    updatedAt: Date
  }
`

const TaxonomyMutation = `
  type TaxonomyMutation{
    success: Boolean
    message: String
		stack: [String]
    taxonomy: Taxonomy
  }
`

const TaxonomiesMutation = `
  type TaxonomiesMutation{
    success: Boolean
    message: String
		stack: [String]
    taxonomies: [Taxonomy]
  }
`

// --

export default {
	TypeDefs: [
		Taxonomy,

		TaxonomyMutation,
		TaxonomiesMutation
	],

	//--

	// Read by every user (product forms), written by admins only
	Query: `
    getAllTaxonomies(taxonomy: [String]): [Taxonomy]
	`,

	QueryResolvers: {
		getAllTaxonomies: (obj, args) => taxonomyApi.getAll(args),
	},

	//--

	Resolvers: {
	},

	//--

	Mutation: `
		createTaxonomy(data: JSONObject!): TaxonomyMutation @admin
		updateTaxonomy(_id: String! data: JSONObject!): TaxonomyMutation @admin
		updateTaxonomies(data: [JSONObject]!): TaxonomiesMutation @admin
		removeTaxonomies(_ids: [String]!): GenericMutation @admin
		sortTaxonomies(taxonomy: String! _ids: [String]!): TaxonomiesMutation @admin
	`,

	MutationResolvers: {
		createTaxonomy: async (obj, {data}, context) => {
			try {
				const taxonomy = await taxonomyApi.create(data)
				return {success: true, taxonomy}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		updateTaxonomy: async (obj, {_id, data}, context) => {
			try {
				const taxonomy = await taxonomyApi.update(_id, data)
				return {success: true, taxonomy}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		updateTaxonomies: async (obj, {data}, context) => {
			try {
				const taxonomies = await taxonomyApi.batchUpdate(data)
				return {success: true, taxonomies}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		removeTaxonomies: async (obj, {_ids}, context) => {
			try {
				await taxonomyApi.remove(_ids)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		sortTaxonomies: async (obj, {taxonomy, _ids}, context) => {
			try {
				const taxonomies = await taxonomyApi.sort(taxonomy, _ids)
				return {success: true, taxonomies}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},
	}
}
