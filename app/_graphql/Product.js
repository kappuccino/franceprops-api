import {canAccessTenant, unauthorized} from './_helper.js'
import * as productApi from '../product/product.js'

// --

const Product = `
  type Product {
    _id: String
    _tenant: String
    ref: String
    title: String

    created: Date
    updated: Date
  }
`

const ProductSearch = `
  type ProductSearch {
    total: Int
    limit: Int
    skip: Int
    data: [Product]
  }
`

const ProductSearchParams = `
  input ProductSearchParams {
    _tenant: String!
    limit: Int
    skip: Int
    sort: JSONObject
    search: String
  }
`

// --

export default {
	TypeDefs: [
		Product,
		ProductSearch,
		ProductSearchParams
	],

	//--

	Query: `
    searchProduct(params: ProductSearchParams!): ProductSearch
	`,

	QueryResolvers: {
		searchProduct: (obj, {params}, context) => {
			if(!canAccessTenant(context, params._tenant)) unauthorized()
			return productApi.aggregate(params)
		},
	},

	//--

	Resolvers: {
	},

	//--

	Mutation: ``,

	MutationResolvers: {},
}
